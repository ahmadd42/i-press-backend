const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const fileRoutes = require("./routes/files");


app.use(express.json());
app.use("/files", fileRoutes);
app.use(cors({
  origin: 'https://gopress.it.com',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
})); //Allow requests only from gopress front-end app

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
