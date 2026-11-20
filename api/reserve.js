const {endpoint} = require('../server/http');
const {serverSupabase} = require('../server/supabase');
const {reserve} = require('../server/backend');
module.exports = endpoint('POST', req => reserve(serverSupabase(),req));
