// lib/async-handler.js — Express 4 async-rejection safety net (Phase 5)
//
// Express 4 only routes SYNC throws and explicit next(err) to the error
// middleware. An async handler that rejects outside its own try/catch
// reaches the process-level unhandledRejection hook instead — the request
// HANGS until the client times out, and under load those hung sockets
// accumulate. Wrap async route handlers so rejections flow to the Sentry
// error middleware and return a JSON 500.
//
//   router.get('/x', asyncHandler(async (req, res) => { ... }));
//
// Express 5 does this natively; delete this module on upgrade.

export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
