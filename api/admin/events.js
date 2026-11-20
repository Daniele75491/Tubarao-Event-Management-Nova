const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {eventRoutes} = require('../../server/admin-routes');
module.exports = endpoint(['GET','PATCH','POST'], req => eventRoutes(serverSupabase(),req), (req,res,result) => {
  if (req.method === 'GET' && req.query?.action === 'guest-list-pdf') {
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="' + result.filename + '"');
    return res.status(200).send(result.pdf);
  }
  if (req.method === 'GET' && req.query?.action === 'backup') {
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="' + result.filename + '"');
    return res.status(200).send(result.csv);
  }
  return res.status(200).json(result);
});
