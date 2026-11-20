const {endpoint} = require('../../server/http');
const {serverSupabase} = require('../../server/supabase');
const {nonPaying} = require('../../server/events');
module.exports = endpoint(['GET','POST','DELETE'], req => (nonPaying)(serverSupabase(),req));
