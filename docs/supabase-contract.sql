-- Read-only metadata queries for the disposable local classroom database.
-- Use them to inspect an existing layout. They do not create tables or functions.
-- These do not read guest records, passwords, tokens or project keys.
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('events', 'reservations', 'non_paying_attendees', 'admin_profiles')
order by table_name, ordinal_position;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as returns,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_reservation', 'claim_payment', 'confirm_payment', 'reject_payment');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('events', 'reservations', 'non_paying_attendees', 'admin_profiles');

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('create_reservation', 'claim_payment', 'confirm_payment', 'reject_payment');
