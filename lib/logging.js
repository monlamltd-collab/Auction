// lib/logging.js — Structured logging & SSE helpers

export function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg: message, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
log.info = (msg, meta) => log('info', msg, meta);
log.warn = (msg, meta) => log('warn', msg, meta);
log.error = (msg, meta) => log('error', msg, meta);

/** SSE helper for streaming progress events */
export function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Express middleware factory for request logging.
 * @param {Function} getClientIP — function(req) → IP string
 */
export function requestLoggerMiddleware(getClientIP) {
  return (req, res, next) => {
    if (req.path === '/health') return next();
    const start = Date.now();
    res.on('finish', () => {
      log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, ip: getClientIP(req) });
    });
    next();
  };
}
