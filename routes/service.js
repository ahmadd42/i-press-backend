const r2 = require("../r2/client");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { fromPath } = require("pdf2pic");
const { exec } = require("child_process");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const crypto = require("crypto");
const mailer = require("../emailer/mailer");
const { Resend } = require("resend");

const bucket = process.env.R2_BUCKET;

async function getFileUrl(key) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: "inline" });
  const url = await getSignedUrl(r2, command, { expiresIn: 5 }); // 1 hour
  return url;
}
function getMimeType(ext) {
  switch(ext.toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case '.jpeg':
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".png":
      return "image/png";
    case ".tiff":
      return "image/tiff";
    case ".mp3":
      return "audio/mpeg";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream"; 
  }
}
async function uploadFile(FilePath) {
  const FileName = path.basename(FilePath);
  const MimeType = getMimeType(path.extname(FilePath));
  const FileBuffer = fs.readFileSync(FilePath);
  // Send file to Cloudflare R2
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: FileName,
    Body: FileBuffer,
    ContentType: MimeType,           // Correct MIME type
    }));
  // Delete file from Node js server
    fs.unlink(FilePath, function (err) {
    if (err) throw err;
    });
}

async function getColumnAliases(TableAlias) {
        const schema = JSON.parse(fs.readFileSync("./db_schema.json"));
        const table = schema.Tables.find(t => t.TableAlias === TableAlias);
        if (!table) {
            throw new Error(`Table for "${TableAlias}" not found.`);
        }
        return [table.TableName, table.Columns];
}

function getCurrentDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function readSQL(path) {
      var sql = "";
      try {
      sql = fs.readFileSync(path, "utf8");
      }catch(err) {
        console.log("Error reading file: ", err);
      }
      sql = sql.replace(/\s+/g, ' ').trim();
      return sql;
}

async function loadQueries(filePath) {
  const data = await fs.promises.readFile(filePath, 'utf8');
  const parser = new xml2js.Parser({ trim: true, explicitArray: false });
  const result = await parser.parseStringPromise(data);

  const q = result.Queries;
  const queryMap = {};
  const names = Array.isArray(q.QueryName) ? q.QueryName : [q.QueryName];
  const sqls = Array.isArray(q.QuerySQL) ? q.QuerySQL : [q.QuerySQL];

  names.forEach((name, i) => {
    queryMap[name] = sqls[i];
  });

  return queryMap;
}

async function generatePdfPreview(pdfpath, outputdir, outputfile) {
return new Promise((resolve, reject) => {
    const output = path.join(outputdir, `${outputfile}.jpg`);

const cmd = `
      gm convert
      -density 150
      "${pdfpath}[0]"
      -trim -fuzz 5%
      -gravity center
      +repage
      "${output}"
    `.replace(/\s+/g, " ").trim();

    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve(output);
    });
  });  
}

function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // attach user info
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function verifyTurnstile(token, ip) {
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip
      })
    }
  );

  return response.json();
}

function generateVerificationCode() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/*async function sendEmail(f_name, email, code) {
  await mailer.sendMail({
      from: "goPress<noreply.gopress@gmail.com>",
      to: email,
      subject: "Verify your email",
      html: `
        <p>Congratulations <b>${f_name} !</b></p>
        <p>You have successfully registered your account with goPress. On this platform, you can show your work to the world, like and comment on other's content and much more.</p> 
        <p>Just one more step to go. Enter this code on the verification page to activate your account:</p>
        <p>${code}</p>
      `
    });
}*/

async function sendEmail(f_name, email, code) {
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "goPress<no-reply@gopress.it.com>",
  to: email,
  subject: "Verify your email",
  html: `
        <p>Congratulations <b>${f_name} !</b></p>
        <p>You have successfully registered your account with goPress. On this platform, you can show your work to the world, like and comment on other's content and much more.</p> 
        <p>Just one more step to go. Enter this code on the verification page to activate your account:</p>
        <p>${code}</p>
        <p></p>
        <p>Regards,</p>
        <p>goPress</p> 
  `
});
}


async function resendEmail(email, code) {
  const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
      from: "goPress<no-reply@gopress.it.com>",
      to: email,
      subject: "Verification code",
      html: ` 
        <p>We received a request to reset your account password. To continue, please enter this code on the verification page:</p>
        <p>${code}</p>
        <p>If you didn't initiate this request, please ignore this email.</p>
        <p></p>
        <p>Regards,</p>
        <p>goPress</p> 
      `
    });
}

async function testEmail() {
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "goPress<no-reply@gopress.it.com>",
  to: "ahmad.rasheed5929@outlook.com",
  subject: "Verify your email",
  html: `
        <p>Congratulations <b>Ahmad !</b></p>
        <p>You have successfully registered your account with goPress. On this platform, you can show your work to the world, like and comment on other's content and much more.</p> 
        <p>Just one more step to go. Enter this code on the verification page to activate your account:</p>
        <p>12345678</p>
  `
});
}


module.exports = {
  uploadFile,
  getFileUrl,
  getColumnAliases,
  getCurrentDateTime,
  generatePdfPreview,
  readSQL,
  loadQueries,
  verifyAuth,
  verifyTurnstile,
  generateVerificationCode,
  hashCode,
  sendEmail,
  resendEmail,
  testEmail
};
