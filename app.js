const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const fileRoutes = require("./routes/files");


app.use(express.json());
app.use("/files", fileRoutes);
app.use(cors()); // allow all origins

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
