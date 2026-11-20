// `npm run create-user -- <username> <password>` - creates a staff login (password is bcrypt-hashed).
const config = require('../backend/config');
const { openDatabase } = require('../backend/db/database');
const { createUser } = require('../backend/services/authService');
const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: npm run create-user -- <username> <password>   (password: min 8 characters)');
  process.exit(1);
}
try {
  createUser(openDatabase(config.dbFile), username, password);
  console.log(`User "${username}" created. You can now log in.`);
} catch (e) {
  console.error('Could not create user:', e.message);
  process.exit(1);
}
