'use strict';
const {createClient} = require('@supabase/supabase-js');
const {HttpError} = require('./http');

const localOrigin = 'http://127.0.0.1:54321';

function serverSupabase(env = process.env) {
  const key = env.DEMO_SUPABASE_SECRET_KEY?.trim();
  if (env.DEMO_MODE !== 'local' || env.VERCEL || env.NODE_ENV === 'production' || env.DEMO_SUPABASE_URL !== localOrigin || !key
      || !env.DEMO_TICKET_SIGNING_SECRET?.trim() || Buffer.byteLength(env.DEMO_TICKET_SIGNING_SECRET) < 32) {
    throw new HttpError(503,'DEMO_SETUP_REQUIRED','Configure the local classroom demo before using the API.');
  }
  return createClient(localOrigin, key, {
    auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
    global: {fetch: (input, options) => {
      const target = new URL(input instanceof Request ? input.url : input);
      if (target.origin !== localOrigin) throw new Error('Only the local demo database is allowed.');
      return fetch(input,{...options,redirect:'error'});
    }}
  });
}

module.exports = {serverSupabase};
