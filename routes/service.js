const r2 = require("../r2/client");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require('fs');
const path = require('path');
//const pdf = require('pdf-poppler');
//const ffmp = require('fluent-ffmpeg');
const xml2js = require('xml2js');
const { fromPath } = require("pdf2pic");

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

/*
 * Converts the first page of a PDF to JPG without "-1"/"-01" suffix.
 * @param {string} pdfPath      Path to the PDF file
 * @param {string} outputPath   Desired output JPG file path
 * @returns {Promise<string>}   Final JPG file path
 */
/*async function generatePdfPreview(pdfPath, outputPath) {
  try {
    const outDir = path.dirname(outputPath);
    const desiredBase = path.basename(outputPath, path.extname(outputPath)); // e.g. "preview"
    const desiredExt = (path.extname(outputPath).replace(".", "") || "jpg").toLowerCase();

    // Ensure output directory exists
    await fs.promises.mkdir(outDir, { recursive: true });

    // Step 1: Convert PDF to JPG (Poppler will add "-1" or "-01")
    await pdf.convert(pdfPath, {
      format: "jpeg",
      out_dir: outDir,
      out_prefix: desiredBase,
      page: 1,
    });

    // Step 2: Find the generated file
    const files = await fs.promises.readdir(outDir);
    const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`^${escapeRegex(desiredBase)}-\\d+\\.jpe?g$`, "i");
    const generatedFile = files.find(f => rx.test(f));

    if (!generatedFile) {
      throw new Error(`Output file not found for prefix "${desiredBase}" in ${outDir}`);
    }

    const from = path.join(outDir, generatedFile);
    const to = path.join(outDir, `${desiredBase}.${desiredExt}`);

    // Step 3: Rename to final desired filename
    if (from !== to) {
      try {
        await fs.promises.rename(from, to);
      } catch (err) {
        if (err.code === "EEXIST") {
          await fs.promises.unlink(to); // remove existing file if any
          await fs.promises.rename(from, to);
        } else {
          throw err;
        }
      }
    }

    return to; // Return the final output path
  } catch (error) {
    console.error("PDF to JPG conversion failed:", error);
    throw error;
  }
}*/

/*
 * Extracts a frame from a video at a given timestamp.
 * @param {string} inputPath - Path to the video file.
 * @param {string} outputPath - Path to save the extracted image.
 * @param {number|string} timestamp - Time in seconds or timestamp string (e.g. '00:00:05').
 * @returns {Promise<void>}
 */
/*function extractVideoFrame(inputPath, outputPath, timestamp = 5) {
  return new Promise((resolve, reject) => {
    ffmp(inputPath)
      .on('end', () => {
        console.log('✅ Frame extracted successfully!');
        resolve();
      })
      .on('error', (err) => {
        console.error('❌ Error:', err);
        reject(err);
      })
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '1280x?' // optional
      });
  });
}*/

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

async function generatepdfpreview2() {
    try {
      const convert = fromPath("uploads/Zac-the-rat.pdf", {
        density: 150,
        saveFilename: "Zac-the-rat",
        savePath: "uploads/",
        format: "jpg"
      });
  
      const result = await convert(1);
      return result.path;
  
    } catch (err) {
      console.error(err);
    }
  
}

module.exports = {
  uploadFile,
  getFileUrl,
  getColumnAliases,
  getCurrentDateTime,
  //generatePdfPreview,
  generatepdfpreview2,
  //extractVideoFrame,
  readSQL,
  loadQueries
};
