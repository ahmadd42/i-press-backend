const r2 = require("../r2/client");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { fromPath } = require("pdf2pic");
const { exec } = require("child_process");
const jwt = require("jsonwebtoken");

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



module.exports = {
  uploadFile,
  getFileUrl,
  getColumnAliases,
  getCurrentDateTime,
  generatePdfPreview,
  readSQL,
  loadQueries,
  verifyAuth
};
