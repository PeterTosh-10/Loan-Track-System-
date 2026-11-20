// One error class for every "expected" failure. The error handler turns it into JSON.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const validation = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
const notFound   = (message) => new AppError(404, 'NOT_FOUND', message);
const conflict  = (message) => new AppError(409, 'CONFLICT', message);
const unprocessable = (message) => new AppError(422, 'BUSINESS_RULE_VIOLATION', message);

// True when SQLite rejected an insert because of a UNIQUE constraint on `column` (e.g. "clients.client_number").
const isUniqueViolation = (err, column) =>
  err && err.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(err.message).includes(column);

module.exports = { AppError, validation, notFound, conflict, unprocessable, isUniqueViolation };
