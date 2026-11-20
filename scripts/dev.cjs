'use strict';
const {createServer} = require('node:http');
const {readFile} = require('node:fs/promises');
const path = require('node:path');

require('./build.cjs');

const host = '127.0.0.1:3000';
const origin = 'http://' + host;
const dist = path.resolve(__dirname,'../dist');
const routes = new Map([
  'event-state','reserve','claim-payment','reservation-state',
  'admin/auth','admin/dashboard','admin/events','admin/non-paying-attendees','admin/payments','admin/check-in'
].map(route => ['/api/' + route,require('../api/' + route)]));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mp4':'video/mp4','.jpeg':'image/jpeg'};

createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control','no-store');
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => res.end(body);
  res.json = body => {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  try {
    if (req.headers.host !== host) return res.status(403).end();
    const url = new URL(req.url,origin);
    if (url.origin !== origin) return res.status(403).end();
    const route = routes.get(url.pathname);
    if (route) {
      req.query = Object.create(null);
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        req.query[key] = values.length === 1 ? values[0] : values;
      }
      if (['POST','PATCH','DELETE'].includes(req.method)) {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req.iterator({destroyOnReturn:false})) {
          bytes += chunk.length;
          if (bytes > 4096) {
            req.resume();
            return res.status(413).json({error:'BODY_TOO_LARGE',message:'Request is too large.'});
          }
          chunks.push(chunk);
        }
        req.body = Buffer.concat(chunks).toString('utf8');
      }
      return await route(req,res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
    const file = url.pathname === '/' ? '/index.html' : url.pathname;
    const type = types[path.extname(file)];
    if (!type || !/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.[a-z0-9]+$/i.test(file)) return res.status(404).end();
    const body = await readFile(path.join(dist,file.slice(1)));
    res.setHeader('Content-Type',type);
    res.setHeader('Content-Length',body.length);
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (!res.headersSent) res.status(error.code === 'ENOENT' ? 404 : 500).end();
    else res.end();
  }
}).listen(3000,'127.0.0.1',() => console.log('Classroom demo listening at '+origin));
