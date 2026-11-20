const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serverSupabase}=require('../server/supabase');

const config={
  DEMO_MODE:'local',
  DEMO_SUPABASE_URL:'http://127.0.0.1:54321',
  DEMO_SUPABASE_SECRET_KEY:'test-only-no-service-key',
  DEMO_TICKET_SIGNING_SECRET:'fixture only, never use as a live signing key'
};

test('missing classroom settings and external Supabase URLs fail before API network activity',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('An invalid demo configuration attempted network activity'));
  const badConfigurations=[
    {},
    {SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'unused',TICKET_SIGNING_SECRET:config.DEMO_TICKET_SIGNING_SECRET},
    {...config,DEMO_MODE:''},
    {...config,VERCEL:'1'},
    {...config,NODE_ENV:'production'},
    {...config,DEMO_SUPABASE_SECRET_KEY:' '},
    {...config,DEMO_TICKET_SIGNING_SECRET:'short'},
    ...['https://example.invalid','http://localhost:54321','http://127.0.0.1:54322','http://127.0.0.1:54321@example.invalid']
      .map(DEMO_SUPABASE_URL=>({...config,DEMO_SUPABASE_URL}))
  ];
  for(const env of badConfigurations) assert.throws(()=>serverSupabase(env),{status:503,code:'DEMO_SETUP_REQUIRED'});
});

test('the Supabase client restricts its request to loopback and refuses redirects',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',(input,options)=>{
    calls.push([String(input),options.redirect]);
    return Promise.resolve(new Response('[]',{headers:{'Content-Type':'application/json'}}));
  });
  const result=await serverSupabase(config).from('events').select('id');
  assert.equal(result.error,null);
  assert.deepEqual(calls,[['http://127.0.0.1:54321/rest/v1/events?select=id','error']]);
});
