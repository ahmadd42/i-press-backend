const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const fileRoutes = require("./routes/files");
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10
});

app.use(express.json());
app.use("/files", fileRoutes);
app.use("/files/login", loginLimiter);
app.use(cors());

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
