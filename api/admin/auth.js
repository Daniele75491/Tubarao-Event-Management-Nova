const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {authRoute} = require('../../server/admin-auth');
module.exports = endpoint(['GET','POST'], (req,res) => authRoute(serverSupabase(),req,res));
