const jwt = require("jsonwebtoken");
const config = require("../config");

const ISSUER = "social-poster";
const AUDIENCE = "social-poster-app";

function signSession(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, tv: user.token_version || 0 }, config.auth.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.auth.jwtExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

function verifySession(token) {
  return jwt.verify(token, config.auth.jwtSecret, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
}

// Cookie lifetime mirrors the JWT expiry so both end together.
function sessionMaxAgeMs() {
  const decoded = jwt.decode(jwt.sign({}, "x", { expiresIn: config.auth.jwtExpiresIn }));
  return Math.max(60, decoded.exp - decoded.iat) * 1000;
}

module.exports = { signSession, verifySession, sessionMaxAgeMs };
