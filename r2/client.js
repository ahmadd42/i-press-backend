const { S3Client } = require("@aws-sdk/client-s3");
require("dotenv").config();

const r2 = new S3Client({
  region: "auto",
  //endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    tokenValue: process.env.TOKEN_VALUE,
  },
});

module.exports = r2;
