const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {paymentRoutes} = require('../../server/admin-routes');
module.exports = endpoint(['GET','POST'], req => paymentRoutes(serverSupabase(),req), (req,res,result) => {
  if (req.method === 'GET' && req.query?.action === 'ticket-qr') {
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Type','image/png');
    res.setHeader('Content-Disposition','attachment; filename="tubarao-demo-ticket.png"');
    return res.status(200).send(result);
  }
  return res.status(200).json(result);
});
