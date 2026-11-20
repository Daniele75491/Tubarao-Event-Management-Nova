const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('access audit migration validates signatures, roles, grants and atomic duplicate audit',async()=>{
  const db=new PGlite();
  const door='11111111-1111-4111-8111-111111111111',superId='22222222-2222-4222-8222-222222222222',event='33333333-3333-4333-8333-333333333333',ticket='44444444-4444-4444-8444-444444444444';
  const sql=fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations/20260929_admin_access_auth.sql'),'utf8');
  try{
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table admin_access_accounts(id uuid primary key,label text,role text,code_salt text,code_hash text,is_active boolean,last_login_at timestamptz);
      create table admin_sessions(id uuid,account_id uuid,session_token_hash text,created_at timestamptz,last_seen_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
      create table events(id uuid primary key,is_active boolean,sales_mode text,created_at timestamptz);
      create table reservations(id uuid primary key,event_id uuid,status text,first_name text,last_name text,category text,qr_token_hash text,confirmed_by_access_id uuid,checked_in_by_access_id uuid,checked_in_by uuid,checked_in_at timestamptz,updated_at timestamptz);
      create function admin_event_role(p_admin_id uuid,p_super boolean default false) returns void language plpgsql as $$begin return; end;$$;
      create function check_in_ticket(p_qr_token_hash text,p_admin_id uuid) returns text language sql as $$select 'wrong signature'::text$$;
      create function check_in_reservation(p_reservation_id uuid,p_admin_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    `);
    await assert.rejects(db.exec(sql),/Unexpected or missing check-in RPC signature/);
    await db.exec(`rollback; drop function check_in_ticket(text,uuid); create function check_in_ticket(p_qr_token_hash text,p_admin_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$;`);
    await db.exec(sql);
    await db.exec(`insert into admin_access_accounts(id,label,role,is_active) values('${door}','DOOR 1','ADMIN',true),('${superId}','SUPER ADMIN','SUPER_ADMIN',true);
      insert into events values('${event}',true,'OPEN',now());
      insert into reservations(id,event_id,status,first_name,last_name,category,qr_token_hash) values('${ticket}','${event}','PAID','Test','Guest','MEN','${'a'.repeat(64)}');`);
    await assert.rejects(db.query('select admin_event_role($1,false)',[door]),/FORBIDDEN/);
    await db.query('select admin_event_role($1,false)',[superId]);
    const first=(await db.query('select check_in_ticket($1,$2) result',['a'.repeat(64),door])).rows[0].result;
    assert.equal(first.result,'CHECKED_IN');
    const duplicate=(await db.query('select check_in_reservation($1,$2) result',[ticket,superId])).rows[0].result;
    assert.equal(duplicate.result,'ALREADY_CHECKED_IN');assert.equal(duplicate.checked_in_at,first.checked_in_at);
    const row=(await db.query('select * from reservations')).rows[0];
    assert.equal(row.checked_in_by_access_id,door);assert.equal(row.checked_in_by,null);
    await db.exec(`update reservations set checked_in_by='${superId}';`);
    await db.query('select check_in_reservation($1,$2)',[ticket,door]);
    assert.equal((await db.query('select checked_in_by from reservations')).rows[0].checked_in_by,superId);
    await db.exec("update reservations set status='REJECTED'");
    assert.equal((await db.query('select check_in_reservation($1,$2) result',[ticket,door])).rows[0].result.result,'INVALID');
    await db.exec(`update admin_access_accounts set is_active=false where id='${door}'`);
    await assert.rejects(db.query('select check_in_reservation($1,$2)',[ticket,door]),/FORBIDDEN/);
    for(const role of ['anon','authenticated','service_role']){
      assert.equal((await db.query("select has_function_privilege($1,'check_in_ticket(text,uuid)','EXECUTE') ok",[role])).rows[0].ok,role==='service_role');
      assert.equal((await db.query("select has_table_privilege($1,'admin_sessions','SELECT') ok",[role])).rows[0].ok,role==='service_role');
    }
    assert.ok((await db.query("select relrowsecurity from pg_class where relname in ('admin_sessions','admin_access_accounts')")).rows.every(r=>r.relrowsecurity));
  }finally{await db.close();}
});
