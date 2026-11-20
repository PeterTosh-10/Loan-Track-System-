const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('../utils/errors');

// Requires header:  Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please log in.'));
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    if (!req.user.role) req.user.role = 'admin'; // Existing staff sessions predate role claims.
    next();
  } catch {
    next(new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please log in again.'));
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    next();
  };
}

function requirePasswordChangeComplete(req, res, next) {
  if (req.user.must_change_password) {
    return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing.'));
  }
  next();
}

module.exports = { requireAuth, requireRole, requirePasswordChangeComplete };
