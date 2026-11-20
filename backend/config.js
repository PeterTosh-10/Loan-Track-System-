// Central place for configuration. Values come from environment variables
// (loaded from .env by dotenv) so no secrets are written in the source code.
require('dotenv').config();
const crypto = require('crypto');

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.startsWith('replace-me')) {
  // Safe fallback: a random secret for this run only. Logins stop working
  // after a restart, which nudges you to run `npm run setup`.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[config] JWT_SECRET not set - using a temporary random one. Run "npm run setup".');
  }
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  dbFile: process.env.DB_FILE || './data/inuka.db',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
};
