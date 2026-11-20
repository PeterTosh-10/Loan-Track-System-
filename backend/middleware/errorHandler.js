const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

// Single place where every error becomes a structured JSON response.
// Unexpected errors (database failures, bugs) are logged but NEVER shown to the user.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'TOO_LARGE', message: 'Request body is too large.' } });
  }
  if (process.env.NODE_ENV !== 'test') console.error('[unexpected error]', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } });
}

module.exports = { notFoundHandler, errorHandler };
