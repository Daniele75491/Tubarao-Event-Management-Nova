const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {dashboard} = require('../../server/backend');
module.exports = endpoint('GET', req => dashboard(serverSupabase(),req));
