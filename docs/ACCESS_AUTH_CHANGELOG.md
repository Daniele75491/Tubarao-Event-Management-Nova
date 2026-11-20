# Access-code authentication change report

This historical record explains the change from account passwords to staff access codes. It records the original implementation and checks. Use the [Developer Guide](TECHNICAL.md) for current classroom setup and the [demo isolation record](NOVA-DEMO.md) for local ticket issuance. The original access-code work was checked locally without a deployment or live database changes.

## Files

Paths are relative to the repository root. Existing migrations were not edited.

| File | Change |
| --- | --- |
| api/admin/auth.js | Added one consolidated login, identity and logout function. |
| server/admin-auth.js | Added scrypt verification, hashed sessions, cookie transport and reusable role authorization. |
| supabase/migrations/20260929_admin_access_auth.sql | Added guarded migration for access-account authorization and atomic check-in audit; retains historical columns/users. |
| api/public-config.js | Removed obsolete browser-auth configuration endpoint. |
| server/http.js | Pass response object to handlers for Set-Cookie; retain existing request protections. |
| server/backend.js | Replace Bearer/profile authorization and use access-account confirmation actor. |
| server/events.js | Require SUPER_ADMIN and pass access-account actor to transactional RPCs. |
| server/checkin.js | Permit ADMIN/SUPER_ADMIN sessions and pass access-account actor to check-in RPCs. |
| server/ticket-delivery.js | Record confirmed_by_access_id while preserving first and historical actors. |
| server/supabase.js | Remove public browser-auth config export; keep service client server-only. |
| scripts/build.cjs | Stop publishing the browser Supabase SDK and remove stale SDK output. |
| app.js | Remove Bearer-token request support; retain same-origin cookie requests. |
| admin.html | Replace email/password form with ADMIN ACCESS and a single password-type code input. |
| admin.js | Cookie login/logout and identity restoration; redirect door accounts before dashboard requests. |
| checkin.html | Matching access-code form and subtle account label. |
| checkin.js | Cookie authorization, identity label and logout; retain scanner/search/manual workflow. |
| tests/admin-auth.test.cjs | Added real scrypt/session/cookie/role/rotation/HTTP-origin tests with generated test credentials. |
| tests/access-audit-sql.test.cjs | Added PostgreSQL migration preflight, audit, duplicate, role and grant tests. |
| tests/session-fixture.cjs | Added reusable ephemeral session fixture. |
| tests/admin.test.cjs | Cookie UI and door redirect coverage. |
| tests/api-routing.test.cjs | Exact 10-function inventory and management permission coverage. |
| tests/backend.test.cjs | Replace old auth fixtures and enforce SUPER_ADMIN management access. |
| tests/build.test.cjs | Assert browser SDK and old login dependencies are absent. |
| tests/checkin-ui.test.cjs | Cookie identity, labels and both authorized roles. |
| tests/checkin.test.cjs | Session-based scan/search/manual authorization. |
| tests/events.test.cjs | Access-account actor and SUPER_ADMIN-only mutations. |
| tests/tickets.test.cjs | New confirmation audit and historical actor preservation. |
| AGENTS.md | Current authentication, permissions and migration rules. |
| README.md | Setup, session security, migration order and API inventory. |
| docs/PRODUCT.md | Final role model, access flow and audit behavior. |
| docs/TECHNICAL.md | Implementation, security, database prerequisites and deployment checks. |
| docs/ACCESS_AUTH_CHANGELOG.md | This complete change report. |

Ignored local browser verification artifacts were created under `.pnpm-cache/auth-preview/`; generated public output is in ignored `dist/`. Neither is committed source. Public design, hero video, price and reservation logic remain unchanged.

## Authentication, permissions and audit

Code → server scrypt verification (N=16384, r=8, p=1, 32 bytes, hex salt, timingSafeEqual) → 12-hour HttpOnly session → server role authorization. Whitespace is trimmed; codes remain case-sensitive. No production codes are embedded in source. Wrong/inactive credentials return INVALID ACCESS CODE.

Sessions use 32 random bytes with only SHA-256 stored in the database. Cookie: tubarao_admin_session, Path=/, HttpOnly, SameSite=Lax, Secure in production, Max-Age=43200. Every protected request verifies expiry, revocation, active account and allowed role. last_seen_at writes are throttled to 15 minutes. Logout revokes the row and expires the cookie. No session token enters JSON, URLs, localStorage or sessionStorage.

SUPER_ADMIN has full dashboard, events, sales, payments, non-paying management, attendee list, KPIs/revenue and check-in. ADMIN has only QR scanning, attendee search and manual check-in. Management routes reject ADMIN server-side. admin.html redirects door accounts without loading dashboard data. Check-in displays the account label, representing the door/device/shift.

New confirmations record confirmed_by_access_id through the existing conditional server follow-up write. Historical confirmed_by and first recorded actors are preserved. Confirmation and audit remain separate writes: a failure can leave PAID awaiting audit repair by a repeated authorized confirmation. New check-ins atomically write checked_in_by_access_id under the reservation row lock. Duplicate scans retain the original time and actor; historical checked_in_by remains intact.

## Remaining Vercel functions: exactly 10

Four public functions and six admin functions:

1. /api/event-state
2. /api/reserve
3. /api/claim-payment
4. /api/reservation-state
5. /api/admin/auth
6. /api/admin/dashboard
7. /api/admin/events
8. /api/admin/non-paying-attendees
9. /api/admin/payments
10. /api/admin/check-in

## Verification and deployment

- All 102 tests pass, including execution of the new SQL in local PostgreSQL/PGlite.
- Build passes. All 44 JavaScript source/test files pass syntax checks. Git diff checks pass.
- Headless Edge at 390px passes login, role redirect, dashboard isolation, both-role check-in labels, logout, overflow and JavaScript-error checks. APIs were mocked; this does not verify live authentication or physical cameras.
- Manually apply `supabase/migrations/20260929_admin_access_auth.sql` AFTER `20260928_admin_event_management.sql` and BEFORE deploying this application version. Existing account/session tables, access audit columns and documented check-in signatures are prerequisites. No account seeds or historical-user deletion are included.
- Preflight stops on missing/incompatible check-in signatures. Live RPC bodies were not supplied for comparison; review deployed definitions before application and never bypass the guard.
- After applying, verify service-only grants and account/session RLS, HTTPS cookie flags, both roles, expired/revoked sessions, payment/email/resend, and simultaneous scans preserving original audit on real Supabase. Test physical iPhone/Android cameras separately. Configure deployment-level login abuse protection.
