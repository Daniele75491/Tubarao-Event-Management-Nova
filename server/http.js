'use strict';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function endpoint(method, action, respond = (req,res,result) => res.status(200).json(result)) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const methods = Array.isArray(method) ? method : [method];
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This request method is not supported.');
      }
      if (['POST','PATCH','DELETE'].includes(req.method)) {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Send a JSON request.');
        }
        // No cross-origin writes. Non-browser clients still require all validation/auth.
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'FORBIDDEN', 'Request not allowed.');
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'FORBIDDEN', 'Request not allowed.'); }
          if (origin.host !== req.headers.host) throw new HttpError(403, 'FORBIDDEN', 'Request not allowed.');
        }
      }
      const result = await action(req,res);
      res.setHeader('X-Server-Time', new Date().toISOString());
      return respond(req,res,result);
    } catch (error) {
      const known = error instanceof HttpError;
      // Do not serialize upstream exceptions, SQL details, tokens or environment values.
      return res.status(known ? error.status : 503).json({
        error: known ? error.code : 'SERVICE_UNAVAILABLE',
        message: known ? error.message : 'Temporarily unavailable. Please try again.'
      });
    }
  };
}

function jsonBody(req, allowedKeys) {
  let value = req.body;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 4096) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request is too large.');
    try { value = JSON.parse(value); } catch { throw new HttpError(400, 'INVALID_INPUT', 'Check your details and try again.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 4096 || Object.keys(value).some(key => !allowedKeys.includes(key))) {
    throw new HttpError(400, 'INVALID_INPUT', 'Check your details and try again.');
  }
  return value;
}

module.exports = {HttpError, endpoint, jsonBody};
