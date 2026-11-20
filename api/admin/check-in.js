const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {checkinRoutes} = require('../../server/admin-routes');
module.exports = endpoint(['GET','POST'], req => checkinRoutes(serverSupabase(),req));
