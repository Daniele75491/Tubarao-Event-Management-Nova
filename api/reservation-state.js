const {endpoint} = require('../server/http');
const {serverSupabase} = require('../server/supabase');
const {ownedReservation} = require('../server/backend');
const {claimInput} = require('../server/validation');
module.exports = endpoint('POST', req => ownedReservation(serverSupabase(),claimInput(req)));
