const {endpoint} = require('../server/http');
const {serverSupabase} = require('../server/supabase');
const {claim} = require('../server/backend');
module.exports = endpoint('POST', req => claim(serverSupabase(),req));
