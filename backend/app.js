const path = require('path');
const express = require('express');
const buildRouter = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// createApp(db) takes the database as a parameter so tests can pass a fresh in-memory one.
function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {            // a few safe browser security headers
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use(express.static(path.join(__dirname, '..', 'frontend')));
  app.use('/api', buildRouter(db), notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
