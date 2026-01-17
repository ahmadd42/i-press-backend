const express = require("express");
const multer = require("multer");
const sv = require("./service");
//const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const con = require("../MySQL/mysql-client");
const bodyParser = require('body-parser');
//const cor = require("cors");
//const crypto = require('crypto');
const r2 = require("../r2/client");
//const pdf = require('pdf-poppler');
//const os = require('os');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
const { PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { exec } = require("child_process");

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // memory storage
const bucket = process.env.R2_BUCKET;
const saltRounds = 10;

var queries = "";

(async () => {
queries = await sv.loadQueries('./Queries.xml');
})();

// Middleware to parse URL-encoded form data
router.use(bodyParser.urlencoded({ extended: false }));
// Middleware to parse JSON data (optional)
router.use(bodyParser.json());

// Manual CORS headers middleware
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', "*");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

/**** Included verifyAuth from service.js module ****/

router.post("/upload", upload.single("file"), sv.verifyAuth, async (req, res) => { // Upload endpoint

/* Prepare new path variables to rename the uploaded file, since multer changes the name of the 
uploaded file as well as removes its extension. The new file name is formed by adding original extension 
to the changed name. The changed name will also be used as Document ID in the database. */
  const base = req.file.filename;
  const userEmail = req.user.email; /***** extracted userEmail from verified loginToken instead of request  ******/
  const ext = path.extname(req.file.originalname);
  const oldPath = path.join('uploads/', `${base}`);
  const newPath = path.join('uploads/', `${base}${ext}`);
  //const newJpgPath = path.join('uploads/', `${base}.jpg`);
  const dt = sv.getCurrentDateTime();

  // Rename the file
    await fs.promises.rename(oldPath, newPath);

    console.log("Renamed:", newPath);

  try {
    if(ext === ".pdf") {
      let outdir = path.join('uploads/');
      await sv.generatePdfPreview(newPath, outdir, base);
      await sv.uploadFile(path.join(outdir, `${base}.jpg`));
    }

    // Send original file to Cloudflare storage
    await sv.uploadFile(newPath);

    // Record basic information about the document into database
    con.connect(function(err) {
    if (err) throw err;
    console.log("Connected!");
    var sql = queries['Add content'].replace(/\s+/g, ' ').trim();
        
    con.query(sql, [base, userEmail, ext, dt], function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
  });
});

    res.json({ message: 'Document uploaded successfully', ContentID: base });

  } catch (err) {
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});


router.get("/download/:filename", async (req, res) => { // Download (signed URL)
  try {
    const url = await sv.getFileUrl(req.params.filename);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate URL", details: err.message });
  }
});

router.get("/getContent/:key/:screensize", async (req, res) => {

  const referer = req.get("referer") || "";

    // ✅ Allow only requests from http://localhost/i-press
/*    if (!referer.startsWith("https://gopress.it.com") && req.params.screensize === "big") {
      return res.status(403).send("Oops! The requested resource could not be fetched");
    }*/

  try {
    const key = req.params.key;

    // Get metadata first (fast, no file download)
    const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const headData = await r2.send(headCmd);

    const fileSize = headData.ContentLength;
    const contentType = headData.ContentType || "application/octet-stream";
    const range = req.headers.range;

    // Handle video/audio streaming if Range header is present
    if ((contentType.startsWith("video/") || contentType.startsWith("audio/")) && range) {
      const CHUNK_SIZE = 10 ** 6; // 1MB per chunk
      const start = Number(range.replace(/\D/g, ""));
      const end = Math.min(start + CHUNK_SIZE, fileSize - 1);

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      });

      const data = await r2.send(command);
      const contentLength = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": contentLength,
        "Content-Type": contentType,
      });

      data.Body.pipe(res);
    } else {
      // For PDFs, images, etc.
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const data = await r2.send(command);

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Accept-Ranges", "bytes");

      data.Body.pipe(res);
    }
  } catch (err) {
    console.error("Error fetching file:", err);
    res.status(500).send("Failed to fetch file");
  }
});

router.post("/getbasicinfo", async(req, res) => {
  const conID = req.body.contentid;
  
  const referer = req.get("referer") || "";

    // ✅ Allow only requests from http://localhost/i-press
    /*if (!referer.startsWith("https://gopress.it.com")) {
    return res.status(403).send("Oops! The requested resource could not be fetched");
    }*/

console.log(conID);

var sql = queries['Get basic info'].replace(/\s+/g, ' ').trim();

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [conID], function (err, result) { 
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});
});

router.post("/getfeeds", async(req, res) => {
  
const referer = req.get("referer") || "";

// ✅ Allow only requests from http://localhost/i-press
/*if (!referer.startsWith("https://gopress.it.com")) {
        return res.status(403).send("Oops! The requested resource could not be fetched");
}*/

var sql = queries['Get feeds'].replace(/\s+/g, ' ').trim();

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, function (err, result) {
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});
});


router.post("/recordmetadata", sv.verifyAuth, async(req, res) => {
  const dt = await sv.getCurrentDateTime();
  const params = [req.body.contentid, req.body.title, req.body.des, req.body.downloadable, req.body.author, req.body.cat, dt, req.body.contentid];

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  
  var sql = queries['Add content metadata'] + '; ' + queries['Update shared on'];
            
  sql = sql.replace(/\s+/g, ' ').trim();

    con.query(sql, params, function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
  });
});

  res.json({ Message: "Document information updated successfully" });
});

router.post('/originname', async(req, res) => {
      const reqOrigin = req.get('origin');
      console.log('Host:', reqOrigin);
      res.send(`The host of this request is: ${reqOrigin}`);
    });

router.post("/hashPwd", async(req, res) => {
  try {
    const password = req.body.password;
    const hash = await bcrypt.hash(password, saltRounds);
    res.json(hash);
  } catch (err) {
    console.error('Error hashing password:', err);
  }
});

// Login endpoint
router.post("/login", async(req, res) => {

  const { email, password } = req.body;
  var sql = queries['Sign in'];
  console.log(sql);
    con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [email], function (err, rows) {
    console.log(rows.length);

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];

    // Compare hashed password from DB with entered password
    const passwordMatch = bcrypt.compareSync(password, user.pwd);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

  /*if (username === "test" && password === "123") {*/
    const loginToken = jwt.sign(
    {
        sub: user.email,        // or user.email if you don’t have numeric ID
        email: user.email
    },
    process.env.JWT_SECRET,
    {
        issuer: "gopress"
    }
  );
    console.log("successfully logged in");
    res.json({loginToken, displayName: user.disp_name}); /**** Removed userdId from response *****/

    //if (err) throw err;
    console.log("Success");
  });
});
});

// Example protected route
router.get("/me", (req, res) => {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ username: payload.username });
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

router.post("/getcomments", async(req, res) => {
  const conID = req.body.contentid;
  
  const referer = req.get("referer") || "";

    // ✅ Allow only requests from http://localhost/i-press
    /*if (!referer.startsWith("https://gopress.it.com")) {
    return res.status(403).send("Oops! The requested resource could not be fetched");
    }*/

console.log(conID);

var sql = queries['Get comments'].replace(/\s+/g, ' ').trim();

     console.log(sql);

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [conID], function (err, result) { 
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});
});

router.post("/postcomment", sv.verifyAuth, async(req, res) => {
  const conID = req.body.contid;
  const dt = sv.getCurrentDateTime();
  const leading = req.body.contid.substring(0, 3);
  const trailing = req.body.contid.substring(29);
  const userid = req.user.email;
  const contid = req.body.contid;
  const comment = req.body.comment;

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  
  var sql = queries['Get comment count'];
            
    con.query(sql, [conID], function (err, result) {
    if (err) throw err;
      const totalcomments = result[0].comments;
      const comid = leading + trailing + ((totalcomments + 1).toString().padStart(6, '0'));
            
  var sql2 = queries['Post comment'].replace(/\s+/g, ' ').trim();

    con.query(sql2, [comid, userid, contid, comment, dt], function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
    res.json("Comment added successfully");
  });


  });
  });
  });

  router.post("/getlikes", async(req, res) => {
    const conID = req.body.contentid;
    var sql = queries['Get likes'].replace(/\s+/g, ' ').trim();

     console.log(sql);

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [conID], function (err, result) { 
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});

});

router.post("/getdislikes", async(req, res) => {
    const conID = req.body.contentid;
    var sql = queries['Get dislikes'].replace(/\s+/g, ' ').trim();

     console.log(sql);

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [conID], function (err, result) { 
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});

});

router.post("/getuserreaction", sv.verifyAuth, async(req, res) => {
    const conID = req.body.contentid;
    const usrID = req.user.email;
    var sql = queries['Get user reaction'].replace(/\s+/g, ' ').trim();

     console.log(sql);

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  con.query(sql, [conID, usrID], function (err, result) { 
  res.json(result);  
    //if (err) throw err;
    console.log("Success");
  });
});

});

router.post("/adddeletereaction", sv.verifyAuth, async(req, res) => {

  const usrid = req.user.email;
  const ctid = req.body.contentid;
  const usr_rct = req.body.reaction;
  const operation = req.body.operation; 

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  
  if(operation === "add") {
  var sql = queries['Add reaction'].replace(/\s+/g, ' ').trim();
    con.query(sql, [usrid, ctid, usr_rct], function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
    res.json("Reaction added/deleted successfully");
  });

  }
  else {
    var sql = queries['Delete reaction'].replace(/\s+/g, ' ').trim();
    con.query(sql, [usrid, ctid], function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
    res.json("Reaction added/deleted successfully");
  });

  }            
  });
  });

router.get("/testpreview", async(req, res) => {
  const img_path = await sv.generatePdfPreview("uploads/Zac-the-rat.pdf","uploads/","Zac-the-rat");
  res.json(img_path);
});

router.post("/adduser", async(req, res) => {
  const usr_email = req.body.email;
  const usr_country = req.body.country;
  const fname = req.body.f_name;
  const lname = req.body.l_name;
  const dispname = req.body.disp_name;
  const captchaToken = req.body.c_token;

  const captcha = await verifyTurnstile(
    captchaToken,
    req.ip
  );

  if (!captcha.success) {
    return res.status(400).json({ error: "Captcha failed" });
  }

  const hash = await bcrypt.hash(req.body.pwd, saltRounds);

  con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
  
  var sql = queries['Add user'].replace(/\s+/g, ' ').trim();

    con.query(sql, [usr_email, usr_country, fname, lname, dispname, hash], function (err, result) {
    if (err) throw err;
    console.log("1 record inserted");
    res.json("User added successfully");
  });

  });
  });

  router.get("/verifyimagemagick", (req, res) => {
    exec("convert -version", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ output: stdout });
  });
});

module.exports = router;
