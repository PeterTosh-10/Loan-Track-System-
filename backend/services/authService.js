const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError, validation, conflict } = require('../utils/errors');
const clients = require('./clientService');

// A throw-away hash so that "unknown user" takes as long as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function createUser(db, username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
    throw validation('Username must be 3-30 characters: letters, numbers, . _ -');
  }
  if (typeof password !== 'string' || password.length < 8) throw validation('Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict('That username is taken.');
  const hash = bcrypt.hashSync(password, 10);   // 10 salt rounds, salt is stored inside the hash
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
}

function validEmail(value) {
  if (typeof value !== 'string') throw validation('Email is required.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validation('Email must be a valid email address.');
  }
  return email;
}

function issueSession(user) {
  const mustChangePassword = Boolean(user.force_password_change);
  const token = jwt.sign({
    sub: user.id,
    username: user.username,
    role: user.role,
    client_id: user.client_id,
    must_change_password: mustChangePassword,
  }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      client_id: user.client_id,
      must_change_password: mustChangePassword,
    },
  };
}

function registerClient(db, input) {
  const email = validEmail(input.email);
  if (typeof input.password !== 'string' || input.password.length < 8) {
    throw validation('Password must be at least 8 characters.');
  }
  const passwordHash = bcrypt.hashSync(input.password, 10);
  let userId;
  const register = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(email)) throw conflict('An account with that email already exists.');
    const client = clients.createClient(db, { full_name: input.full_name, phone: input.phone, email });
    userId = db.prepare(
      'INSERT INTO users (username, password_hash, role, client_id) VALUES (?, ?, ?, ?)'
    ).run(email, passwordHash, 'client', client.id).lastInsertRowid;
  });
  try {
    register();
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('An account with that email already exists.');
    throw err;
  }
  return issueSession(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function login(db, username, password) {
  const user = typeof username === 'string'
    ? db.prepare('SELECT id, username, password_hash, role, client_id, force_password_change FROM users WHERE username = ?').get(username.trim())
    : undefined;
  const ok = bcrypt.compareSync(typeof password === 'string' ? password : '', user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password.');
  return issueSession(user);
}

function changePassword(db, userId, password) {
  if (typeof password !== 'string' || password.length < 8) throw validation('Password must be at least 8 characters.');
  const result = db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), userId);
  if (result.changes !== 1) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again.');
  return issueSession(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

module.exports = { createUser, registerClient, login, changePassword, validEmail };
