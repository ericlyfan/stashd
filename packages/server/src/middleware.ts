import { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does not catch errors thrown or rejected by an async route handler:
// the rejection escapes to the process, and on this Node version an unhandled
// rejection terminates it. wrap() funnels any rejection into next(err) so the
// terminal errorHandler responds instead of the server dying. Apply it to every
// async route handler.
export function wrap(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// The single terminal error middleware — registered last in app.ts, after all
// routes. If the response already started (an SSE stream has flushed headers),
// nothing useful can be written, so hand off to Express's default handler,
// which closes the socket. Otherwise emit a JSON 500. The detail is logged, not
// returned, so an unexpected failure never leaks internals to the client.
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  console.error('Unhandled route error:', err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
}
