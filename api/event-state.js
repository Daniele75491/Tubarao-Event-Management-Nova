const {endpoint} = require('../server/http');
const {serverSupabase} = require('../server/supabase');
const {eventState} = require('../server/backend');
module.exports = endpoint('GET', () => eventState(serverSupabase()));
