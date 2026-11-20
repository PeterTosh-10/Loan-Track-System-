// `npm run setup` - creates .env with a random JWT secret (only if .env does not exist).
const fs = require('fs');
const crypto = require('crypto');
if (fs.existsSync('.env')) { console.log('.env already exists - nothing changed.'); process.exit(0); }
const text = fs.readFileSync('.env.example', 'utf8')
  .replace('replace-me-with-a-long-random-string', crypto.randomBytes(48).toString('hex'));
fs.writeFileSync('.env', text);
console.log('Created .env with a new random JWT_SECRET.');
