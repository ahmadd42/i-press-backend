const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- CONFIG ---
const ACCESS_TOKEN_SECRET = "super-secret-access";
const REFRESH_TOKEN_SECRET = "super-secret-refresh";

// Access token lasts 15 minutes
const ACCESS_TOKEN_EXPIRY = "15m";

// Refresh token lasts 7 days
const REFRESH_TOKEN_EXPIRY = "7d";

// Example in-memory DB
const users = [
  { id: 1, username: "ahmad", passwordHash: bcrypt.hashSync("123", 10) }
];

// Store refresh tokens (better: use a DB/Redis)
let refreshTokens = [];

// --- HELPERS ---
function generateAccessToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(user) {
  const token = jwt.sign({ id: user.id, username: user.username }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  refreshTokens.push(token); // store server-side
  return token;
}

// --- ROUTES ---

// Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store refresh token in HttpOnly persistent cookie
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,          // use HTTPS in production
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({ accessToken, username: user.username });
});

// Protected route (needs access token)
app.get("/me", (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    res.json({ id: user.id, username: user.username });
  });
});

// Refresh token endpoint
app.post("/refresh", (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken || !refreshTokens.includes(refreshToken)) {
    return res.sendStatus(401);
  }

  jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);

    const newAccessToken = generateAccessToken(user);
    res.json({ accessToken: newAccessToken });
  });
});

// Logout
app.post("/logout", (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  refreshTokens = refreshTokens.filter(t => t !== refreshToken);

  res.clearCookie("refreshToken");
  res.json({ message: "Logged out" });
});

app.listen(3000, () => console.log("✅ Server running on http://localhost:3000"));


FRONT-END

// After login:
localStorage.setItem("accessToken", res.accessToken);
localStorage.setItem("username", res.username);

// Call API
async function fetchUser() {
  let accessToken = localStorage.getItem("accessToken");
  let res = await fetch("/me", {
    headers: { "Authorization": "Bearer " + accessToken }
  });

  if (res.status === 403) {
    // Try refresh
    let r = await fetch("/refresh", { method: "POST", credentials: "include" });
    if (r.ok) {
      let data = await r.json();
      localStorage.setItem("accessToken", data.accessToken);
      return fetchUser(); // retry
    } else {
      // force logout
    }
  }

  return res.json();
}
