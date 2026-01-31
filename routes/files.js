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
    await con.promise().connect();
    var sql = queries['Add content'].replace(/\s+/g, ' ').trim();
    await con.promise().query(sql, [base, userEmail, ext, dt]); 

    res.status(200).json({ message: 'Document uploaded successfully', ContentID: base });

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
  try {
  const conID = req.body.contentid;
  var sql = queries['Get basic info'].replace(/\s+/g, ' ').trim();

  await con.promise().connect(); 
  const [rows] = await con.promise().query(sql, [conID]);  
  res.json(rows);

  } catch (err) {
    res.status(500).json({ error: "Failed to get info", details: err.message });
  }  
  });

router.post("/getfeeds", async(req, res) => {
  try {
  var sql = queries['Get feeds'].replace(/\s+/g, ' ').trim();

  await con.promise().connect(); 
  const [rows] = await con.promise().query(sql);
  res.json(rows);  

} catch (err) {
    res.status(500).json({ error: "Failed to get content feeds", details: err.message });
}  
});

router.post("/recordmetadata", sv.verifyAuth, async(req, res) => {
try {
  const dt = await sv.getCurrentDateTime();
  const params = [req.body.contentid, req.body.title, req.body.des, req.body.downloadable, req.body.author, req.body.cat, dt, req.body.contentid];

  await con.promise().connect();
  var sql = queries['Add content metadata'] + '; ' + queries['Update shared on'];
  sql = sql.replace(/\s+/g, ' ').trim();
  await con.promise().query(sql, params); 
  res.status(200).json({ Message: "Document information updated successfully" });

} catch (err) {
    res.status(500).json({ error: "Failed to get content feeds", details: err.message });
}  
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
try {
  const { email, password, captchaToken } = req.body;

  const captcha = await sv.verifyTurnstile(
  captchaToken,
  req.ip
  );

  if (!captcha.success) {
  return res.status(400).json({ error: "Captcha failed" });
  }

  var sql = queries['Sign in'];
  await con.promise().connect(); 
  const [rows] = await con.promise().query(sql, [email]);

  if (rows.length === 0)    return res.status(401).json({ error: "Invalid credentials" });

  const user = rows[0];
  // Compare hashed password from DB with entered password
  const passwordMatch = bcrypt.compareSync(password, user.pwd);

  if (!passwordMatch)   return res.status(401).json({ error: "Invalid credentials" });

  // if the email of a new user has not been verified yet
  if(user.user_status === "inactive")   return res.status(402).json({ error: "Email not verified", f_name: user.first_name });

  // Generate Login token
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

  res.json({loginToken, displayName: user.disp_name}); /**** Removed userdId from response *****/

  } catch (err) {
    res.status(500).json({ error: "Sign-in failed", details: err.message });
  }  
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
  try {
  const conID = req.body.contentid;
  var sql = queries['Get comments'].replace(/\s+/g, ' ').trim();

  await con.promise().connect();
  const [rows] = await con.promise().query(sql, [conID]); 
  res.json(rows);  

  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve comments", details: err.message });
  }  
  });

router.post("/postcomment", sv.verifyAuth, async(req, res) => {
  try {
  const conID = req.body.contid;
  const dt = sv.getCurrentDateTime();
  const leading = req.body.contid.substring(0, 3);
  const trailing = req.body.contid.substring(29);
  const userid = req.user.email;
  const contid = req.body.contid;
  const comment = req.body.comment;

  await con.promise().connect();  
  var sql = queries['Get comment count'];
            
  const [rows] = await con.promise().query(sql, [conID]);
  const totalcomments = rows[0].comments;
  const comid = leading + trailing + ((totalcomments + 1).toString().padStart(6, '0'));
            
  var sql2 = queries['Post comment'].replace(/\s+/g, ' ').trim();
  await con.promise().query(sql2, [comid, userid, contid, comment, dt]);

  res.status(200).json({message: "Comment added successfully"});

  } catch (err) {
    res.status(500).json({ error: "Failed to post comment", details: err.message });
  }  
  });

  router.post("/getlikes", async(req, res) => {
  try {    
  const conID = req.body.contentid;
  var sql = queries['Get likes'].replace(/\s+/g, ' ').trim();

  await con.promise().connect();
  const [rows] = await con.promise().query(sql, [conID]); 
  res.json(rows);  

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch likes", details: err.message });
  }  
  });

router.post("/getdislikes", async(req, res) => {
  try {
  const conID = req.body.contentid;
  var sql = queries['Get dislikes'].replace(/\s+/g, ' ').trim();

  await con.promise().connect();
  const [rows] = await con.promise().query(sql, [conID]); 
  res.json(rows);  

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dislikes", details: err.message });
  }  
  });

router.post("/getuserreaction", sv.verifyAuth, async(req, res) => {
  try {
  const conID = req.body.contentid;
  const usrID = req.user.email;
  var sql = queries['Get user reaction'].replace(/\s+/g, ' ').trim();

  await con.promise().connect();
  const [rows] = await con.promise().query(sql, [conID, usrID]);
  res.json(rows);  

  } catch (err) {
    res.status(500).json({ error: "Failed to get reaction", details: err.message });
  }  
  });

router.post("/adddeletereaction", sv.verifyAuth, async(req, res) => {
try {
  const usrid = req.user.email;
  const ctid = req.body.contentid;
  const usr_rct = req.body.reaction;
  const operation = req.body.operation; 

  await con.promise().connect();
  
  if(operation === "add") {
    var sql = queries['Add reaction'].replace(/\s+/g, ' ').trim();
    await con.promise().query(sql, [usrid, ctid, usr_rct]);
    res.status(200).json({message: "Reaction added/deleted successfully"});
  }

  else {
    var sql = queries['Delete reaction'].replace(/\s+/g, ' ').trim();
    await con.promise().query(sql, [usrid, ctid]);
    res.status(200).json({message: "Reaction added/deleted successfully"});
  }
  
  } catch (err) {
    res.status(500).json({ error: "Operation failed", details: err.message });
  }  
  });

router.get("/testpreview", async(req, res) => {
  const img_path = await sv.generatePdfPreview("uploads/Zac-the-rat.pdf","uploads/","Zac-the-rat");
  res.json(img_path);
});

router.post("/adduser", async(req, res) => {
  try {
  const usr_email = req.body.email;
  const usr_country = req.body.country;
  const fname = req.body.f_name;
  const lname = req.body.l_name;
  const dispname = req.body.disp_name;

  const hash = await bcrypt.hash(req.body.pwd, saltRounds);
  const code = sv.generateVerificationCode();
  const codeHash = sv.hashCode(code);

  await con.promise().connect(); 
  var sql = queries['Find user'];
  const [rows] = await con.promise().query(sql, [usr_email]);

  if (rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
  }

  var sql2 = queries['Add user'].replace(/\s+/g, ' ').trim();
  await con.promise().query(sql2, [usr_email, usr_country, fname, lname, dispname, hash, 'inactive', codeHash]);
  await sv.sendEmail(fname, usr_email, code);

  res.status(200).json({message: "User added successfully"});

} catch (err) {
    res.status(500).json({ error: "Sign-up failed", details: err.message });
    console.log(err.message);
  }  
  });

  router.get("/verifyimagemagick", (req, res) => {
    exec("convert -version", (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ output: stdout });
  });
});

router.post("/verifyemail", async(req, res) => {
try {
const usr_email = req.body.email;
const code = req.body.vcode;
var sql = queries['Verify user'];

await con.promise().connect();
const [rows] = await con.promise().query(sql, [usr_email]);

if(rows[0].attempts + 1 > 3) {
  return res.status(429).json({ error: "Too many attempts" });
}

if(rows[0].v_code !== sv.hashCode(code)) {
sql = queries['Increase attempts'];
await con.promise().query(sql, [usr_email]);
return res.status(400).json({ error: "Invalid code" });
}

sql = queries['Activate user'];
await con.promise().query(sql, [usr_email]);
res.status(200).json({ message: "Account activated" });

} catch (err) {
    res.status(500).json({ error: "Email verification failed", details: err.message });
}
});

router.post("/resendcode", async(req, res) => {
  try {
  const code = sv.generateVerificationCode();
  const codeHash = sv.hashCode(code);
  const usr_email = req.body.email;
  var sql = queries['Find user'];
  await con.promise().connect();
  const [rows] = await con.promise().query(sql, [usr_email]);
  if (rows.length === 0) {
      return res.status(400).json({ error: "Email not found" });
  }
  var sql2 = queries['Update code'];
  await con.promise().query(sql2, [codeHash, usr_email]);
  await sv.resendEmail(usr_email, code);
  res.status(200).json({ message: "Code sent again" });

  } catch (err) {
    res.status(500).json({ error: "Code sending failed", details: err.message });
  }
});

router.post("/resetpass", async(req, res) => {
  try {
  const usr_email = req.body.email;
  const newpass = req.body.new_pass;
  const hash = await bcrypt.hash(newpass, saltRounds);
  var sql = queries['Reset password'];
  await con.promise().connect();
  await con.promise().query(sql, [hash, usr_email]);
  res.status(200).json({ message: "Password reset" });

  } catch (err) {
    res.status(500).json({ error: "Password reset failed", details: err.message });
  }
});

router.get("/testemail", async(req, res) => {
try {  
  await sv.testEmail();
    res.status(200).json({ message: "Email sent" });
} catch (err) {
    res.status(500).json({ error: "Email sending failed", details: err.message });
  }

});

module.exports = router;
