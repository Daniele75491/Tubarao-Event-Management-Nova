# Tubarão technical history

> These notes preserve past design and rollout decisions for the original app. Use the [Developer Guide](TECHNICAL.md) for the current classroom app. Its local setup, demo payments, and QR downloads supersede the rollout and provider instructions here.

## Access authentication migration and session security

Apply `supabase/migrations/20260929_admin_access_auth.sql` AFTER `20260928_admin_event_management.sql` and before deploying the matching application. This is one new migration; existing migrations, historical Auth users and audit columns remain. The supplied existing tables/columns are prerequisites. Preflight verifies check_in_ticket(text,uuid) and check_in_reservation(uuid,uuid), their parameter names and scalar jsonb return types before any mutation. Stop and inspect live definitions if preflight fails; do not bypass the guard. Live function bodies were not available for independent comparison.

The migration restricts account/session tables to service-role access and enables RLS. It updates admin_event_role to require active SUPER_ADMIN accounts and check-in functions to require active ADMIN/SUPER_ADMIN accounts. Check-in locks the reservation row, rechecks current-event PAID state and preserves the first checked_in_at/checked_in_by_access_id on duplicates. Historical checked_in_by is never rewritten. PostgreSQL tests verify execution, audit, rejection and privileges; simultaneous scans must still be tested against live Supabase.

server/admin-auth.js derives every active account's code hash with scrypt N=16384, r=8, p=1, key length 32, hex-decoded salt and timingSafeEqual. Leading/trailing whitespace is trimmed; case is preserved. Codes are never logged or persisted by the application. Wrong/inactive codes receive INVALID ACCESS CODE.

Login generates 32 crypto-random bytes, encodes base64url, stores only SHA-256(session token) and sets tubarao_admin_session as HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; Secure in production. The plaintext token appears only in cookie transport, never JSON or browser storage. Sessions expire after 12 hours without sliding extension. Every protected request joins the session to the active account and rejects revoked/expired sessions or disallowed roles. last_seen_at is updated at most once per 15 minutes per session using a conditional update. last_login_at is updated on login. Logout revokes the current hash and expires the cookie. Expired rows remain unusable; no cleanup function or cron is needed.

JSON writes retain Origin/host and Sec-Fetch-Site validation. Deploy over HTTPS; verify cookie flags, login/logout and both roles on the deployed origin. Configure distributed login abuse protection at deployment level. No live secrets, codes, email delivery, DB changes or deployment were used during local verification.

## Scope and authority

The approved static frontend now has Vercel Node.js APIs using the existing Supabase database and RPCs. Supabase is authoritative for price, capacity, reservation deadlines and payment state. The integration is implemented locally; live deployment has not been verified in this workspace. Server-side QR generation and Resend ticket delivery are implemented after PAID. Mobile QR scanning and manual paid-ticket check-in use the supplied service-role RPCs. An additive event-management SQL migration is now included locally but has not been applied to Supabase. It adds service-only transactional functions; the subsequent access-auth migration changes account/session privileges and check-in/event authorization. The pricing migration replaces create_reservation while preserving its signature, locks, expiry, sales and capacity rules; the claim/confirm/reject RPCs and Revolut manual verification remain unchanged; the reservation-recovery migration adds a separate atomic external-confirmation RPC.

BRAND.md and PRODUCT.md remain the visual and business sources of truth. The original shark asset, hero video, typography, colours and responsive CSS remain unchanged.

## Runtime and deployment

- Node.js 24; @supabase/supabase-js, resend and qrcode pinned in package.json and pnpm-lock.yaml.
- Install with `pnpm install --frozen-lockfile`; run `pnpm test` and `pnpm build`.
- Vercel uses the root api directory for functions. vercel.json builds the public allowlist into dist; server code, documents, tests and environment files are not copied into public output.
- scripts/build.cjs excludes the browser Supabase SDK and removes stale vendor/supabase.js output. Supabase remains a server dependency; the scanner stays bundled locally.
- Vercel environment: SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY, EMAIL_FROM, TICKET_SIGNING_SECRET. All these values remain server-only and excluded from frontend builds and responses.
- Opening HTML with file:// no longer provides a working checkout. Use Vercel or a local Vercel development server with private environment configuration. Never commit environment files.

## Server modules and routes

server/supabase.js creates a stateless service client with session persistence and token refresh disabled. server/http.js enforces methods, JSON writes, same-origin browser writes, no-store responses and sanitized errors. server/validation.js validates names, email, UUIDs, categories and allowed request fields. server/domain.js implements read-only expiry/availability projection. server/backend.js queries the known schema and calls the supplied RPC signatures.

| Route | Access / behaviour |
| --- | --- |
| GET/POST /api/admin/auth | Session identity / action=login / action=logout |
| GET /api/event-state | Public event data and qualitative availability; no guest data or exact capacity |
| POST /api/reserve | Validated identity; resumes matching active reservation, otherwise calls create_reservation |
| POST /api/claim-payment | Reservation UUID plus matching normalized email; calls claim_payment |
| POST /api/reservation-state | Same UUID/email credentials; read-only refresh recovery; no guest details returned |
| GET /api/admin/dashboard | Verified SUPER_ADMIN session; current event, reservations, non-paying attendees and KPIs |
| POST /api/admin/payments?action=confirm-payment | Verified SUPER_ADMIN; calls confirm_payment, records actor, creates QR and attempts email after PAID |
| POST /api/admin/payments?action=resend-ticket | Verified SUPER_ADMIN; PAID only; same deterministic QR, explicit email retry |
| POST /api/admin/payments?action=reject-payment | Verified SUPER_ADMIN; calls reject_payment(p_reservation_id) |

All customer writes are same-origin. The reservation-state read uses POST so email/UUID do not enter URLs. No endpoint exposes the full reservation table publicly. Admin projections exclude qr_token_hash and admin_note. Reservation lists are paginated internally to avoid silently reaching the database response limit.

Errors EVENT_SOLD_OUT, MEN_SOLD_OUT, SALES_CLOSED and ACTIVE_RESERVATION_EXISTS return clean 409 responses. Missing event/reservation returns 404; invalid input returns 400; missing/invalid session returns 401; non-admin returns 403. Internal SQL errors, stack traces and credentials never enter API responses. Responses include X-Server-Time for countdown clock alignment.

## Current event and public availability

Pre-launch public presentation uses the server event name and starts_at, formatted consistently in Europe/Lisbon as Sunday, 4 October 2026 and 18:00 – 22:30 for the supplied active event. The schema has no end-time field, so TUBARAO_CONFIG.eventClosing holds only the operator-supplied date-specific display end time (2026-10-04 / 22:30). It is not applied to other dates or used for sales/payment logic; revise it for a later event or future end-time field. No public capacity/category limits are hardcoded.

Public price formatting omits .00 (€8) but preserves non-whole backend amounts; admin money formatting remains unchanged. Checkout uses the locked server amount. Reservation copy uses events.reservation_minutes (currently 20), falling back to “Complete your payment before the countdown ends.” when unavailable. The timer always uses reserved_until plus the server clock offset; no static duration sets expiry.

sales_status CLOSED takes priority over category availability in public copy: TICKETS NOT CURRENTLY AVAILABLE / Tickets closed. Public ticket links are removed. Checkout still permits identity-based recovery while sales are closed or full; new reservations remain subject to the backend sales/capacity checks. The backend still independently enforces sales. Existing verified orders remain claimable until their server deadlines. When OPEN, category availability remains AVAILABLE / FEW TICKETS LEFT / SOLD OUT; no exact counts are exposed.

Resolve is_active=true, prefer sales_mode OPEN or SCHEDULED, order by created_at descending then id descending. If there is no preferred event, select the newest active event. No UUID/name is hardcoded.

Public output: event_id, name, starts_at, ticket_price_cents (effective-price compatibility alias), reservation_minutes, sales_status, men_status, women_status, server_now and pricing {phase,current_price_cents,next_price_cents,early_price_ends_at,server_now,show_countdown,show_late_price}. next_price_cents is null when future-price disclosure is off. The deadline is NULL when no automatic Early countdown applies; internal pricing_mode is not published. Statuses are AVAILABLE, FEW_TICKETS_LEFT or SOLD_OUT. Counts are never returned.

Occupied capacity includes PAID; RESERVED with reserved_until in the future; PAYMENT_CLAIMED with claimed_at + claim_hold_hours in the future; and every non-paying attendee. MEN reservations also count against men_paid_cap; non-paying men affect physical attendance/gender composition but not the paid Men cap. WOMEN has only the shared physical limit.

Qualitative thresholds retain the previous UI values (15 total places / 7 Men places), centralized in server/domain.js. They are not price or capacity limits. The current schema has no editable threshold columns.

OPEN bypasses sales timing, never capacity. CLOSED blocks sales. SCHEDULED requires sales_open_at and respects optional sales_close_at. The exact closing timestamp remains allowed, matching the supplied RPC's comparison. Reads calculate effective EXPIRED without mutating rows. The existing RPCs perform database expiry transitions.

## Customer checkout

app.js provides same-origin fetches, public state polling, display formatting and Instagram self-confirmation. index.html uses backend availability and price. Checkout behaviour lives in checkout.js.

1. Select MEN/WOMEN after Instagram self-confirmation; enter first name, last name and email and acknowledge category.
2. POST /api/reserve resolves the event server-side. The database locks capacity and returns reservation_id, status, amount_cents, pricing_tier and reserved_until; the API adds payment_url from the stored amount. Browser price/event/role fields are rejected.
3. Show YOUR SPOT IS RESERVED and a countdown based on the server deadline. reservation_minutes is currently 20. The response clock header aligns the visual countdown; it is not an authorization mechanism.
4. PAY uses the locked amount from the response. The sole recipient/base URL is in server/payments.js. buildRevolutPaymentUrl uses URLSearchParams and reservation.amount_cents; create/recovery/state/claim responses provide payment_url. The browser opens it externally and never derives it from current event pricing. No Revolut API or automatic payment verification is used.
5. I’VE PAID calls claim_payment with the UUID and email. On PAYMENT_CLAIMED show the requested pending-verification copy; no confirmed-payment message or QR is shown for a claim.
6. localStorage retains only reservation_id and email under tubarao_reservation_recovery. On load, checkout starts CHECKING and retrieves server state before enabling actions. Legacy tab-scoped records are projected to these two fields, verified and removed. Invalid or terminal initial recovery clears storage and returns to normal checkout. Network failures retain credentials but block unverified actions. Server category, amount and deadlines always win.
7. Customer state polling observes later admin decisions. PAID displays TICKET CONFIRMED and directs the customer to email or the organizers if the ticket has not arrived, without claiming successful delivery. PAYMENT_CLAIMED retains the pending-verification message. Both states show a secondary spam/junk-folder reminder, also present on the ticket information page. EXPIRED, REJECTED and CANCELLED offer restart. Expiry disables both payment actions.

Availability refreshes on load, after reservation, every 30 seconds while visible, and on focus/visibility changes with throttling. The visual timer ticks once per second without network requests. Request overlap and duplicate form clicks are blocked. Network errors preserve recovery data and never manufacture a paid or claimed state.

## State model and supplied RPC behaviour

RESERVED → PAYMENT_CLAIMED → PAID / REJECTED.

RESERVED expires at reserved_until (currently 20 minutes). PAYMENT_CLAIMED freezes the original reservation countdown and protects the place until claimed_at + events.claim_hold_hours (currently 24 hours), or earlier admin review. It is not an indefinite freeze. Expired holds do not count toward availability. PAID always occupies capacity; REJECTED, EXPIRED and CANCELLED do not.

The supplied claim_payment RPC returns PAYMENT_CLAIMED on retry even if its claim deadline elapsed. The API follows it with an ownership-checked read and projects effective EXPIRED, without changing the RPC. confirm_payment may return EXPIRED; the UI does not report success in that case.

The four original reservation/payment RPCs are service-role-only according to the supplied security setup and remain unchanged. The new event-management functions have their own explicit service-only grants. docs/supabase-contract.sql contains optional read-only metadata queries for checking that deployed setup.

## Admin authentication and dashboard

Access code → server-side scrypt verification → secure HttpOnly session → role authorization. SUPER_ADMIN has full management and check-in access. ADMIN is door/check-in only. Browser-supplied roles are never trusted.

admin.html initially shows only ADMIN ACCESS. GET /api/admin/auth restores identity using the cookie. ADMIN redirects to /checkin.html before any dashboard request. SUPER_ADMIN loads the dashboard and polls every 30 seconds while visible. Login uses POST ?action=login with {code}; logout POST ?action=logout with {} revokes the row and clears the cookie. Private content is cleared on logout/authorization errors; stale responses cannot reopen it. No browser SDK, Bearer token, public-config endpoint or browser session-token storage remains.

The verification table prioritizes claims and shows first/last name, email, category, amount, status and reservation/claim timestamps. CONFIRM PAID and REJECT call authenticated routes and refresh the whole dashboard. The existing RPCs determine payment transitions. After PAID, the shared server ticket-delivery helper handles actor recording, QR generation and email attempts. Unsent paid rows offer RESEND TICKET; successful rows show TICKET SENT.

Revenue sums actual amount_cents for PAID rows only. Paid attendance and gender KPIs exclude holds; total attendance/gender adds all non-paying attendees. The full-width paid master list uses loaded dashboard data for combined first-name/last-name/email searches and category/status filters. admin-attendees.js provides all six name/category/check-in sort directions without mutating input. Paid emails appear as secondary row text. The full-width non-paying accordion follows below; admin-management.js alone renders its names/category/check-in status and existing REMOVE action, with no row email. Its optional-email add form and backend behavior remain unchanged. The redundant general attendee section, filter listener and exclusive rendering function were removed. Empty copy distinguishes no paid attendees from no matching filters. Mobile paid rows wrap into labeled entries without horizontal scrolling; desktop keeps the six-column table. No backend/API, check-in, backup, permissions or Vercel function changes were made.

Event settings, sales controls and non-paying attendees are now editable through authenticated transactional APIs after applying the event-management migration. Existing visual styles are preserved. Old local prototype data is neither imported nor used for totals or availability.

## Ticket generation and Resend delivery

server/tickets.js exposes deriveTicketToken, hashTicketToken, generateQrPng and sendTicketEmail. The token is base64url(HMAC-SHA256(TICKET_SIGNING_SECRET, "tubarao-ticket-v1:" + lowercase reservation UUID + ":" + lowercase event UUID)). The secret must be a high-entropy value of at least 32 UTF-8 bytes, stored only in Vercel/private server environment. Keep it stable and back it up securely. No weak/default secret is used.

The PNG encodes only TUBARAO:<token>. Store SHA-256(token) as hex in qr_token_hash; never store plaintext tokens. Tokens and PNGs exist briefly in server memory and in the intended recipient's email. Gmail/mailboxes necessarily retain the delivered message; the no-plaintext-storage rule concerns application persistence. Resend regenerates the same token and uses a timing-safe comparison against an existing valid hash. A mismatch blocks delivery with a safe error and never replaces the existing hash. Secret rotation needs a deliberate migration/versioning plan; changing the environment value alone breaks resends for existing tickets.

server/ticket-delivery.js is shared by confirm and resend. On confirm, first authenticate/authorize, invoke the existing RPC and inspect its returned status. Only PAID proceeds. Write confirmed_by_access_id from the authenticated access account only if both it and historical confirmed_by are empty, retaining the first recorded actor on retries. If the RPC returns EXPIRED, do not create or send a ticket.

Delivery reads the PAID reservation. A conditional UPDATE matching id, PAID and the prior ticket_email_attempts increments the count, writes ticket_email_last_attempt_at and a safe in-progress marker. Only one concurrent request acquires that attempt. A two-minute lease blocks concurrent explicit resends; the Resend HTTP request is bounded to 20 seconds and the consolidated Vercel payments function allows 60 seconds. Customer request deadlines remain unchanged; admin delivery requests allow 60 seconds.

After acquiring the attempt, derive/verify the token, persist qr_token_hash and qr_created_at if missing, generate the PNG and send through the official Resend Node SDK. RESEND_API_KEY and EMAIL_FROM are server-only and required; the sender comes directly from EMAIL_FROM. Subject remains Your Tubarão ticket. The HTML and text fallback are unchanged byte-for-byte. The delivery query includes last_name and events.name; no schema or RPC change is required.

The English text/HTML email uses the stored category, actual amount with two decimal places, full guest name and event name; dynamic HTML text is escaped. A fluid, maximum-600px table layout uses inline styles, a dark header with the original logo and YOU’RE IN., a bone-white ticket card, restrained blue accents, the QR and a Carcavelos footer. Outlook receives a conditional fixed-width wrapper. The PNG is 500×500, error-correction level M, six-module quiet zone, pure black modules on white, displayed at up to 280px. Token derivation and payload are unchanged.

Both images are inline CID attachments with base64 raw content, explicit filenames, contentType and matching contentId fields. The server reads the unchanged assets/tubarao-logo.jpeg from its fixed local path, and the consolidated Vercel payments function explicitly bundles this asset. The logo displays at its original aspect ratio. Only local image bytes are attached; no URL or attachment path is submitted; there are no external image or CSS dependencies. Plain text includes confirmation, category, price, event and door/privacy instructions. Browser previews verify layout, but actual email clients can suppress inline images, alter dark-mode colors or vary typography; live Gmail, Apple Mail and Outlook rendering is not verified by local tests.

Successful Resend acceptance sets ticket_sent_at and clears ticket_email_error. Failure records a fixed, safe description, never a raw provider exception or credentials; PAID is never reverted. Previously successful ticket_sent_at is preserved if an explicit later resend fails. A database failure after Resend acceptance reports uncertain delivery; it cannot be made atomic with Resend. ticket_sent_at means Resend accepted the message, not verified inbox receipt.

Repeated confirmation returns the existing sent state without sending again. Any earlier failed/uncertain attempt requires explicit RESEND TICKET rather than automatic retry on confirm. Resend is SUPER_ADMIN-only and rejects non-PAID reservations. It increments attempts and regenerates the same QR. Final updates are conditional on the acquired attempt number/timestamp so an old worker cannot overwrite a later result. An abandoned attempt can be explicitly retried after its two-minute lease; confirm alone does not retry it.

The dashboard projection includes qr_created_at, ticket_sent_at, ticket_email_attempts and sanitized ticket_email_error. Neither public endpoints nor the dashboard expose qr_token_hash or plaintext tokens. Unknown historical error strings are replaced by a safe generic message. Failed audit/delivery database writes after successful confirmation return PAID plus a safe delivery warning; when the database itself is unavailable, attempt metadata cannot be guaranteed persisted.

Email-provider and database commits cannot provide exactly-once delivery together. Concurrent/ordinary repeated confirms are guarded, but a process termination or lost provider response may require manual reconciliation and an explicit resend. Such a resend can duplicate the email, always with the same ticket token. Review the inbox before retrying an uncertain attempt. No background worker, queue, automatic retry service or new schema is introduced.

Before deployment verify the five supplied delivery columns exist, service-role UPDATE permissions allow their use, the Resend domain is Verified and RESEND_API_KEY/EMAIL_FROM are configured, and TICKET_SIGNING_SECRET meets the strength requirement. Perform a controlled live send and verify the CID QR in Gmail/mobile mail clients; no live mail was sent by local tests.

## Remaining production checks and limits

- Verify deployed event settings and the configured Revolut/Instagram links. The schema has starts_at only; the supplied 22:30 end time is date-specific public presentation configuration, not a database timestamp or sales transition.
- Ensure Vercel uses this project root, Node 24, the supplied build/output configuration and all required environment variables for each intended environment. Build/deploy and run a real customer/admin smoke test; no deployment was performed here.
- Verify active admin_access_accounts and admin_sessions, then apply the access-auth migration below. Historical Auth users and admin_profiles remain unused. Confirm RPC EXECUTE privileges are service-only and RLS grants no public guest access. RLS and grants were described by the user, not independently inspected against the live project.
- Add deployment-level abuse protection/rate limits for public reservation and claim requests and access-code login. In-memory function counters would not provide distributed enforcement and are not presented as protection.
- UUID + matching email is the supplied customer capability. Do not expose reservation IDs in URLs or analytics. A lost create response or a new browser can recover through reserve with matching normalized first name, last name, email and category. A mismatch returns only the generic conflict. These identity fields are not strong authentication; distributed abuse protection remains necessary.
- The supplied confirm_payment RPC does not populate confirmed_by. This implementation performs the requested server-side follow-up write only where confirmed_by_access_id and historical confirmed_by are null. RPC and audit write are not a single transaction: a database failure can leave PAID without an actor. A repeated authenticated confirm can repair it; strict transactional actor attribution still requires a future RPC change.
- Use the transactional event-management APIs for capacity/non-paying edits. Direct Supabase table edits bypass those safeguards and must not be used for concurrent operations.
- Database lock/concurrency behaviour and privileges need live verification. Mocked tests confirm our contract and authorization logic, not production database isolation.
- Refunds remain unimplemented. Verify the supplied check-in RPCs return the documented result object, atomically require PAID and unused status, preserve the original check-in time/actor on duplicates, and record checked_in_by_access_id. Test simultaneous scans from two devices against the real database. Token possession alone must not bypass payment/cancellation checks.

## Verification

Run `node --test tests/*.test.cjs` or `pnpm test`, then `pnpm build`. Tests cover expiry boundaries, 24-hour claims, capacity/gender rules, current-event selection, exact RPC parameters, input validation, cookie/session/role authorization, clean errors, safe public fields, checkout refresh/claim/expiry failure paths, attendance filtering and revenue. Build checks ensure only allowed public files and the scanner publish, with no browser Supabase SDK. Ticket tests additionally cover deterministic tokens, PNG payload, CID email composition, provider failure, concurrent/repeated confirmation, admin auditing, resend counters, secret mismatch and uncertain persistence. Live browser, Gmail and Supabase checks must be distinguished from these local tests.

Official references: [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js), [Node crypto](https://nodejs.org/api/crypto.html).

Email/QR references: [Resend Node SDK](https://resend.com/docs/send-with-nodejs), [Resend CID attachments](https://resend.com/docs/dashboard/emails/embed-inline-images), [node-qrcode](https://github.com/soldair/node-qrcode).

## Mobile admin check-in

GET /api/admin/check-in?action=presence extends the existing function. Both active ADMIN and SUPER_ADMIN access-code sessions are authorized before reads. Current-event queries select only first_name, last_name, category and checked_in_at, filter checked_in_at IS NOT NULL, and additionally require reservations.status=PAID. Both sources paginate in 500-row pages with stable ID ordering, without projecting IDs. Response: generatedAt, stats {total, men, women, menPercentage, womenPercentage}, attendees [{firstName,lastName,category,type,checkedInAt}]. No event/attendee IDs, emails, QR material, payment amounts or admin metadata are returned. Percentages use total arrivals, rounded to one decimal; empty percentages are zero. No writes or migration are introduced.

checkin-presence.js owns the independent panel, client-side sorting/filtering and five-second visible-page polling. It allows one in-flight read; a successful check-in during that read queues one fresh read afterward. Filters/sort persist, KPIs use the full response, unchanged rows are not rebuilt, and refresh never focuses or scrolls. Backgrounding cancels the timer; visibility return refreshes immediately. Logout/pagehide clears attendance, cancels timers, removes filter listeners and invalidates late responses; pageshow restarts for an authorized page. Temporary errors retain old data and show a non-blocking warning. Auth failures clear presence data without disabling scanner/search; those operations retain their own existing authorization handling.

Presence is a polling snapshot, not a transactional headcount or exit-tracking system. Separate source queries can straddle a concurrent check-in; the next refresh reconciles it. Existing checked-in non-paying records are included, but no non-paying check-in or departure mutation is added. Event activation and all management permissions are unchanged. Function count remains 10.

`checkin.html` shares the HttpOnly session cookie with `admin.html` and displays the verified account label. The interface remains hidden until an authenticated search request authorizes the user server-side. No browser role is trusted; all three routes use `requireAdmin` and the existing secret-key server helper.

- `POST /api/admin/check-in`: accepts only `{qr_payload}`. Requires the exact `TUBARAO:` prefix and existing 43-character base64url token format. The server computes SHA-256(token), checks the current-event PAID row, then calls `check_in_ticket(p_qr_token_hash, p_admin_id)` with the verified actor.
- `POST /api/admin/check-in?action=manual`: accepts only `{reservation_id}`, checks current-event PAID status, then calls `check_in_reservation(p_reservation_id, p_admin_id)`. The RPC must recheck payment and unused status atomically; no client or follow-up UPDATE sets check-in state.
- `GET /api/admin/check-in?q=...`: verifies admin before reading data. Empty search returns only the current event context and no guests. Literal case-insensitive matching on first name, last name, full name and email reads paginated current-event rows server-side and returns at most 30 matches plus a refinement indicator. Search is limited to 100 characters; only reservation ID, names, email, category, status and checked_in_at are returned. This simple server-side search suits the small event size.

RPC response contract: JSON object `{result: "CHECKED_IN" | "ALREADY_CHECKED_IN", first_name, last_name, category, checked_in_at}` or `{result: "INVALID"}`. Output is strictly projected; hashes, actor IDs and DB errors are never exposed. Unknown/malformed RPC results become a sanitized service error. Current-event selection reuses the existing newest-active OPEN/SCHEDULED preference; verify the correct event is active before doors open.

Scanner: pinned `qr-scanner` 1.4.2, locally bundled ES module and decoder worker with its license. It uses rear-camera preference, eight scans/second and a worker fallback where native detection is unavailable. Camera opens only on an explicit button; backgrounding, logout, search or a scan stops it. A synchronous submission latch blocks overlapping/repeated callbacks until SCAN NEXT. No scanned token is stored or logged. A failed/uncertain network request never grants entry: retry explicitly to recover the authoritative original check-in result. Results/search responses arriving after logout or a newer query are discarded.

Use HTTPS (localhost is allowed for development), grant camera permission and test in current iPhone Safari and Android Chrome. In-app browsers, low light, camera hardware and OS permission settings can prevent scanning; use manual lookup. There is no offline admission or non-paying QR/check-in implementation. Local mocks do not prove live RPC locking, grants, RLS or physical-camera compatibility.

Production checks: confirm service-only RPC privileges, active access accounts, the documented response shape and atomic PAID/single-use enforcement; test duplicate/concurrent scans, original timestamps and checked_in_by_access_id persistence; perform physical-phone tests in low light over the deployed HTTPS origin. Existing payment, ticket token and email/resend logic is unchanged.

Scanner reference: https://github.com/nimiq/qr-scanner

## Event-management migration and APIs

Concrete database gap: separate PostgREST writes cannot atomically switch active events, and read-count-then-write code can oversell during concurrent reservations. The unapplied additive migration `supabase/migrations/20260928_admin_event_management.sql` provides admin_update_event, admin_create_event, admin_activate_event, admin_add_non_paying and admin_remove_non_paying. Apply the whole migration in Supabase before deploying the new routes. Missing functions return SETUP_REQUIRED; no unsafe fallback writes are attempted. There are no new columns/tables and no changes to existing payment, reservation or check-in RPCs.

All management routes require SUPER_ADMIN cookie sessions server-side. After the access-auth migration, the event RPC helper checks the actor against active SUPER_ADMIN admin_access_accounts. Public/anon/authenticated EXECUTE is revoked, service_role alone receives the mutation grants, and internal helpers are not callable by browser roles. PATCH/DELETE receive the same JSON and same-origin enforcement as POST.

| Route | Behavior |
| --- | --- |
| PATCH /api/admin/events | Validated partial current-event update; returns event |
| GET /api/admin/events | Authenticated paginated historical event list and verified role |
| POST /api/admin/events | SUPER_ADMIN; creates inactive event |
| POST /api/admin/events?action=activate | SUPER_ADMIN; atomic active-event switch |
| GET /api/admin/non-paying-attendees | Current-event list |
| POST /api/admin/non-paying-attendees | Validated current-event addition within capacity |
| DELETE /api/admin/non-paying-attendees | Current-event deletion by attendee_id |

The browser sends X-Event-ID for mutations to prevent a stale editor from silently targeting a newly activated event. The server resolves the current event and rejects mismatches. The transaction revalidates that event before editing. Requests without a browser event header still operate only on the server-selected current event.

Lock order: event-management global advisory lock, then create_reservation-compatible per-event advisory lock, then event row lock, then SHARE ROW EXCLUSIVE locks on reservations and non_paying_attendees. The table locks coordinate with existing claim/confirm functions that use reservation-level locks. These brief locks intentionally serialize reservation writes for this small event workload. Activation takes the global advisory lock and an events table lock; both active-flag updates commit or roll back together. Other event data is untouched. The existing active-event selection remains as a legacy fallback if multiple active rows predate the migration; a successful activation leaves exactly one active event. Direct SQL table edits can bypass these operation-level safeguards.

The database checks occupancy under lock using PAID and live deadlines, plus non-paying rows. Updates use the current locked record plus a validated patch, not an earlier server snapshot. Hold-window edits count the greater of old/new claim_hold_hours. Ticket-price changes never rewrite reservation amount_cents. Creation is forced inactive regardless of sales mode. No active event is required to log in, view event history or create the first event.

Admin forms display device timezone, convert datetime-local to ISO timestamps, preserve unsaved current-event edits across background refreshes, and refresh the dashboard/KPIs after writes. Switching events and removal require confirmation. Non-paying emails are included only in authorized dashboard responses. Public design and qualitative inventory remain unchanged.

Verification includes an in-memory PostgreSQL 17 runtime (PGlite, dev-only) that executes the actual migration and tests occupancy errors, roles/grants, add/remove, unchanged historical paid amounts and activation rollback/history. This verifies SQL execution but not live multi-session Supabase locking. Before launch apply the migration, inspect grants, test simultaneous reservation/admin writes and activation on the deployed backend, and test mobile editing in Safari.

## Consolidated Vercel function entry points

`GET /api/admin/events?action=backup` is consolidated into the existing events function. server/event-backup.js authorizes the HttpOnly session as SUPER_ADMIN before event/attendee reads, resolves the current active event server-side and paginates both attendee sources. ADMIN receives 403, unauthenticated callers 401. The HTTP response is a UTF-8 CSV attachment with BOM, CRLF, no-store and nosniff. All cells are quoted with doubled embedded quotes; formula-like prefixes are neutralized with a leading apostrophe. The ASCII filename uses a sanitized bounded event name and its Lisbon date when available. No schema, migration or additional function is required.

Exact columns: First Name, Last Name, Email, Category, Type, Status, Amount EUR, Checked In, Checked In At. Reservation Type is PAID for all statuses; Status is the stored reservation status and Amount EUR is actual amount_cents / 100 with two decimals. Non-paying rows use NON-PAYING for Type and Status, and 0.00. Checked In is YES/NO; timestamps remain ISO strings. Missing values are empty. No internal IDs, QR tokens/hashes, sessions, codes or credentials are exported. Explicit select/output projections enforce this boundary.

DOWNLOAD EVENT BACKUP appears only inside the SUPER_ADMIN dashboard. The client fetches the CSV with same-origin cookies, downloads a temporary Blob URL and releases it; auth failures use existing handling and responses after logout are discarded. No attendee state is modified. Separate reads produce an operational snapshot, not a transactional database backup. It is an emergency/manual fallback and becomes stale as activity continues. The online QR backend is still required for live duplicate-check protection; Type PAID alone never proves payment. Keep backups private and delete them when no longer needed.

Official Instagram is configured in app.js as @casitatubarao and https://www.instagram.com/casitatubarao/. The approved follow CTA remains external with self-confirmation. privacy.html uses existing brand styling, is explicitly included in the public build and links the same Instagram contact. Checkout links it in a new tab beside reservation submission using acknowledgement copy. No tracking, new collection fields or optional-processing consent is added.

There are exactly 10 deployable JavaScript entry files under api: four public and six admin. Dispatch helpers live in server/admin-routes.js, outside api. Removed entry files must not be retained as forwarding functions. Query actions select existing handlers without altering bodies, headers, role verification, RPCs or response shapes. Unknown actions and method/action combinations are rejected. Non-paying operations already share one function. No schema or migration changes are required for this routing refactor.

| Function route | Methods / operations |
| --- | --- |
| /api/admin/auth | GET identity; POST ?action=login or logout |
| /api/event-state | GET public event/availability |
| /api/reserve | POST reservation |
| /api/claim-payment | POST payment claim |
| /api/reservation-state | POST private order recovery |
| /api/admin/dashboard | GET authorized dashboard |
| /api/admin/events | GET list; GET ?action=backup CSV; PATCH current event; POST create; POST ?action=activate |
| /api/admin/non-paying-attendees | GET list; POST add; DELETE remove |
| /api/admin/payments | POST ?action=confirm-payment, confirm-external-payment, reject-payment or resend-ticket |
| /api/admin/check-in | GET ?q=... search; POST QR; POST ?action=manual |

The payments entry retains maxDuration: 60 and the bundled original logo for both confirmation and resend. Browser confirmation/resend requests retain their 60-second timeout. tests/api-routing.test.cjs guards the exact function inventory, dispatch, authorization and HTTP protections. This inventory is verified locally; a successful Vercel deployment still needs to be checked after deploying.

## Resend transport migration

Pinned resend 6.30.0 replaces Nodemailer/Gmail SMTP. EMAIL_USER and EMAIL_APP_PASSWORD are no longer read. EMAIL_FROM supplies the full configured sender; no sender address or key is embedded in source. Missing configuration fails before submission. The SDK emails.send call must return data.id without error before the existing metadata path records success. Provider errors, malformed acceptance, network failure and the 20-second abort all fail safely; existing PAID and resend metadata semantics remain unchanged. The pinned SDK forwards the AbortSignal request option; a transport-level test verifies this. Its raw development error logger is disabled per client to keep private provider diagnostics out of logs.

Attachments retain ticket-qr@tubarao and tubarao-logo@tubarao Content-IDs, with image/png and image/jpeg content types, matching unchanged HTML references. Tests verify actual SDK JSON serialization using mocked fetch; no emails are sent. Template/fallback SHA-256 regression checks prove the approved content is unchanged. Vercel function count remains 10 and existing payment bundling still includes assets/tubarao-logo.jpeg.

Historical note: external email integration required a verified sender. The classroom copy has no mail transport.


## Reservation recovery and external payment confirmation

POST /api/reserve checks the active event for an existing normalized-email reservation before creation. Names use case-insensitive NFKC and collapsed-whitespace matching; emails retain lowercase/trim normalization; categories must match. Only live RESERVED, live PAYMENT_CLAIMED and PAID resume. Responses allowlist ID, category, status, amount and deadlines, never QR material or internal metadata. Resume neither inserts nor resets deadlines. Elapsed/rejected/cancelled rows use normal capacity-checked creation. A duplicate race from create_reservation retries the matching lookup once.

Browser recovery uses the existing POST /api/reservation-state with UUID/email, including when the old follow session or category URL is absent. New purchases still require the existing gate. Claimed and paid states never offer another payment. No local status or payment proof is stored.

Concrete RPC gap: confirm_payment accepts only claimed payments and cannot atomically restore an expired booking. Apply supabase/migrations/20260930_reservation_recovery.sql after the existing event-management and access-auth migrations, before deploying the updated app. It adds service-only confirm_external_payment(p_reservation_id uuid,p_admin_id uuid); existing schema, configuration and RPC definitions are untouched. Missing RPC fails closed with SETUP_REQUIRED.

POST /api/admin/payments?action=confirm-external-payment verifies the SUPER_ADMIN cookie session and passes the verified actor. SQL independently checks an active SUPER_ADMIN account and current event. RESERVED and EXPIRED rows show CONFIRM PAID with the warning: Confirm only after verifying this payment in Revolut. PAYMENT_CLAIMED keeps normal confirmation and rejection; the new action also accepts it using confirm_payment semantics. REJECTED/CANCELLED cannot resurrect. PAID retries are idempotent.

The new RPC acquires the existing reservation advisory lock before admin_locked_event: global/event advisory locks, event row and occupancy-table write locks, then the reservation row. Capacity is counted under those locks, excluding the target and including all other PAID/live RESERVED/live PAYMENT_CLAIMED rows and every non-paying attendee. MEN additionally uses men_paid_cap. Elapsed holds are persisted as EXPIRED under lock before reclaiming slots, preventing an older transaction clock from reviving an uncounted hold. A conflicting in-flight write may trigger PostgreSQL deadlock rollback; the operation fails safely and can be retried after refresh. EVENT_SOLD_OUT or MEN_SOLD_OUT rolls back confirmation. The active-email unique index prevents restoring a second active booking for the same email.

Payment and confirmed_by_access_id commit atomically for the new action; original access/historical actors remain unchanged. The normal confirmation action retains its existing follow-up audit semantics. Both invoke the same deterministic QR and Resend delivery path after PAID; email failure never rolls back payment, and explicit RESEND TICKET retains the same identity. No email/template/check-in code or Vercel function is added. Function count remains 10.

Classroom recovery verification uses the local baseline and migrations. Test reserved, claimed, expired and paid orders, role denial, and capacity boundaries. PGlite serializes requests, so multi-session behavior still requires a separate local database test.


## Payment dashboard cleanup and delivery audit

POST /api/admin/payments?action=delete-record extends the existing payments function. server/reservation-deletion.js verifies the SUPER_ADMIN session, accepts only reservation_id, loads that exact stored row, and requires RESERVED/REJECTED/EXPIRED plus null paid_at, checked_in_at, qr_token_hash, qr_created_at and ticket_sent_at. Missing safety fields fail closed. The single DELETE repeats the exact ID, loaded status and every null-ticket predicate; a concurrent update is rechecked by PostgreSQL, and zero deleted rows returns a safe 409. No email-targeted deletion, new RPC, schema migration or function is added. The existing service role must have reservation DELETE permission; permission/database failures fail safely.

Dashboard adds can_delete computed from the stored status before effective expiry projection and strips the internally selected QR hash. Thus an elapsed PAYMENT_CLAIMED row displayed as EXPIRED is still protected until persisted expiry; any issued-ticket marker keeps it protected afterward too. Browser visibility is a convenience, never authorization. Deletion has explicit active/permanent warnings and an in-flight latch; failure keeps the row, success removes only the matching ID and refreshes dashboard data.

Payment Verification splits existing data into TO REVIEW and COMPLETED / TICKETS SENT. Only status PAID with non-null ticket_sent_at goes right, newest sent first; all other rows remain left, including paid delivery failures. The native details accordion (not a select) defaults closed, keeps open state across refreshes and clears on logout. Completed rows retain SUPER_ADMIN resend. The separate paid-ticket removal feature below permits explicit deletion only before check-in. Desktop uses approximately 68/32 columns and a 560px completed scroll area; mobile stacks review first, then completed with normal document scrolling. Payment-table mobile cells retain labels and wrap without horizontal scrolling. No per-row fetches are introduced.

Email path audit: normal confirm_payment and recovery confirm_external_payment both enter backend.review and, only after PAID, recordConfirmation then the same deliverTicket. Both use the same versioned HMAC token, generateQrPng, sendTicketEmail, ticketMessage and Resend emails.send(message,{signal}). For identical guest/reservation/event data, tests compare full sender, recipient, subject, HTML, plain text, QR/logo base64 bytes, content types and CIDs. Neither sets Reply-To or extra email headers. All three initial statuses produce byte-identical payloads and identical delivery timestamps/attempt metadata. Overlapping and repeated confirmations elect one submission through the existing compare-and-set lease; failures remain PAID and do not automatically retry. No discrepancy or duplicate-send path was found; template, map links, subject, sender, QR/logo and transport were not changed. This code audit cannot determine why the two observed messages reached spam; that requires their delivered headers/provider events. Provider acceptance and inbox placement remain distinct.

Verification includes server deletion predicates and race simulations, protected states/ticket evidence, auth, exact-ID targeting with shared emails, capacity effects, complete email payload equality and overlapping confirms, split movement/count/sort/state tests, plus local headless browser checks at 320/390/760/1024/1440px with 130 completed rows. No live records were deleted and no real email was sent. Vercel function count remains 10; this cleanup requires no new DB migration.


## Compact SUPER_ADMIN control room

Layout only: CHECK-IN and DOWNLOAD EVENT BACKUP share a compact desktop flex row; the existing backup helper stays with its button. Revenue and the read-only current sales mode share two metric columns, with schedule guidance preserved. Existing m-revenue/manual-sales-label IDs, handlers, calculations and event settings remain unchanged.

EVENTS renders the dashboard-selected current event once in ACTIVE EVENT, with name, date/time and sales mode, without activation controls. The existing event-list request supplies only inactive events to OTHER EVENTS, preserving its newest-created-first ordering and excluding the selected event ID defensively. The details accordion defaults closed, preserves open state on refresh, updates its count and resets on logout. Existing guarded activation buttons and the create-event form remain unchanged; creation now lives inside OTHER EVENTS. Empty active/inactive states are explicit and creation stays available with no current event.

At mobile widths the order is check-in then backup, revenue then sales, and active event then other events. Browser verification covers 320, 390, 760, 1024 and 1440px, including expanded creation and mock activation/creation. No backend, authorization, payment, ticket, check-in, CSV or API changes; function count remains 10.


## Database-authoritative EARLY / LATE pricing

Already applied to production (confirmed by the operator): supabase/migrations/20261001_ticket_pricing.sql. Preserve this migration unchanged; do not reapply it. It adds events.early_price_cents, late_price_cents, early_price_ends_at (timestamptz), pricing_mode (AUTO/EARLY/LATE), and nullable reservations.pricing_tier (EARLY/LATE). Existing event prices backfill both tiers; existing reservation amounts, unknown tiers, QR hashes and payment/check-in state stay untouched. Re-running preserves configured values. An existing event price outside 1..100000 cents stops the migration transaction for operator review, rather than silently repricing it.

Internal event_pricing(events,timestamptz) derives the phase. create_reservation calls it with PostgreSQL NOW() after acquiring the existing event advisory/row locks and enforcing sales/capacity. PostgreSQL NOW() is the transaction timestamp: requests waiting for locks retain that transaction timestamp. At the exact deadline it selects LATE. The amount/tier are inserted together with the reservation; no caller-supplied time/price argument exists. Claim/payment/recovery operations never recalculate the amount.

read_event_pricing(uuid) returns database time and a safe display projection through the existing event-state and admin dashboard functions. It is service-only; its internal helper and validation helper are not browser-executable. Existing SUPER_ADMIN management RPCs are replaced to validate/edit the new settings while retaining transactional occupancy locks. JSON string/fractional/zero/negative/oversized prices fail at the API and SQL boundaries. The browser converts decimal euro text to integer cents by splitting whole/fractional digits. €1,000.00 is the maximum new configured price; valid historical reservation amounts remain usable.

The legacy ticket_price_cents DB column is not a live pricing source. Old price-only admin mutations fail closed after migration. New events retain an initial legacy snapshot for compatibility. The public ticket_price_cents response alias is calculated from database effective pricing for older display clients; it is not read from that legacy column.

The public ticket-pricing.js countdown uses server_now via app.js clock offset, with 30-second visible-page polling, focus/visibility refresh and one immediate refetch when each deadline reaches zero. It never changes phase locally. A failed refresh shows unavailable pricing; the next normal poll retries. Countdown announcements are off; the timestamp remains readable separately. Admin shows configured mode versus current phase/price and asks before switching to a forced mode. Existing price edits never affect outstanding orders. Payment Verification labels the stored amount as EXPECTED AMOUNT.

### Manual rollout order

1. The 20261001 pricing migration is already live. Review/apply ONLY the new 20261002_ticket_pricing_display_controls.sql migration in Supabase SQL Editor before deploying this application. It is transactional and does not configure a price increase for existing events. Avoid event-setting edits during the deployment window: the old price-only form is intentionally rejected.
2. Deploy the matching application through the normal process. No new environment variable or service is needed. Do not configure different tier prices/deadlines until this version is deployed, because old checkout clients used a fixed payment link. Ask customers with an old open checkout to refresh before payment after rollout; manual verification still checks the stored expected amount.
3. In SUPER_ADMIN set the intended Early/Late prices (for example €8/€12), choose the dedicated deadline in the displayed device timezone, and select AUTO. No deadline has been invented or deployed. Existing reservation duration and sales settings are unchanged.
4. Verify roles, price boundaries and multi-session last-slot behavior on a controlled staging event. Local PGlite exercises the actual pricing SQL but serializes connections, so it is not independent proof of production concurrency. The existing locks are retained.

No cron, pricing job, new API function or external service is used. Vercel function count remains 10. Email transport/template, signing, check-in, live attendance, deletion and CSV format remain unchanged.


## Exact-ID hard deletion of duplicate paid tickets

POST /api/admin/payments?action=delete-paid-ticket accepts only reservation_id. server/reservation-deletion.js checks the current HttpOnly session using the existing SUPER_ADMIN guard, then performs one conditional PostgREST DELETE equivalent to:

    DELETE FROM reservations WHERE id = :reservation_id
      AND status = 'PAID' AND checked_in_at IS NULL RETURNING id;

Exactly one matching returned ID is required; absent/ineligible/raced rows return a safe 409. Database failures fail closed. No preliminary read authorizes an unconditional delete, no email/name filter is used, and no Resend/QR generation path is called. PostgreSQL row locks and predicate rechecking protect against concurrent check-in: check-in first makes DELETE miss; delete first makes the check-in lookup invalid. PGlite tests exercise both operation orders and the real check-in SQL; separate-connection production races are not simulated.

The native confirmation dialog uses textContent for guest details and the stored amount, focuses CANCEL initially, supports Escape, and closes on logout. The action is available only for SUPER_ADMIN PAID rows with an explicitly null checked_in_at in both completed and unsent operational lists. Confirmation rechecks the latest client state, while the backend remains authoritative. Requests latch against double submission. Success removes that exact ID locally from all derived lists/KPIs, then refreshes the dashboard; failure retains the row and shows the safe error.

No additional migration, column, RPC or Vercel Function is needed: this uses the same existing service-role reservation DELETE permission as delete-record. The latter's original rules are unchanged. Pricing migration 20261001_ticket_pricing.sql is already applied and remains unchanged. The only new migration for this addition is 20261002_ticket_pricing_display_controls.sql; do not rerun already-applied migrations. Deploy the matching local application afterward, then configure pricing. The intended €8/€12 AUTO deadline of 4 October 2026, 12:00 Europe/Lisbon is operator configuration, not a hardcoded application value.

Deletion removes the row from capacity, revenue, attendance, recovery and backup queries naturally. Revenue still sums surviving amount_cents. Previously delivered email copies cannot be recalled, but their deleted ticket identity no longer resolves. A separately started email request may finish after deletion; it cannot restore the deleted row or authorize its QR. No deployment, migration, email or production deletion was performed during local verification.


## EARLY display preferences

Display-controls migration: 20261002_ticket_pricing_display_controls.sql (reported applied by the operator as of the category-correction request). Adds events.show_pricing_countdown and events.show_late_price_before_start, boolean NOT NULL DEFAULT false. It extends only management RPC allowlists, validation and persistence; event_pricing, read_event_pricing and create_reservation definitions are untouched. Existing price/deadline/mode and reservation amounts are unchanged. API and SQL reject strings, numbers and null; existing SUPER_ADMIN authorization and service-only grants remain.

The public pricing projection exposes show_countdown/show_late_price and redacts next_price_cents unless disclosure is enabled. The deadline remains available for authoritative refetch even when its visual countdown is hidden. Both off: active EARLY price and muted LATE TICKETS label only. Countdown only: adds the countdown. Late price only: adds the configured future amount. Both on: both appear. FORCE EARLY has no automatic deadline/countdown; disclosure still controls the future amount. LATE always shows the active price, with neither countdown nor future preview. No display change requires confirmation; forced-mode changes retain their existing confirmation.

Original display-controls rollout (now reported complete): review and manually apply only 20261002 → deploy the matching complete local application (pricing, paid deletion and display controls) → configure SUPER_ADMIN prices/deadline/mode/preferences → smoke-test a controlled event. The intended configuration is €8/€12, AUTO, Sunday 4 October 2026 at 12:00 Europe/Lisbon (11:00 UTC), initially both display flags off; enter it in the admin form's displayed device timezone. None of these settings is hardcoded or applied by this work. Retest old open checkouts after refresh and verify stored expected amounts manually in Revolut. No new environment variables or Vercel Functions.


## Atomic paid category correction (local addition)

MIGRATION REQUIRED: YES — supabase/migrations/20261003_paid_category_correction.sql. Pricing and display controls are now reported live by the operator. After the already-applied migrations through 20261002, manually apply only 20261003, then deploy the matching application and verify using a controlled event. This work does not apply the migration, publish code or touch production attendees. No columns or old migration files change.

POST /api/admin/payments?action=change-category accepts only reservation_id and category (MEN/WOMEN). The existing HttpOnly session, origin/JSON protections and SUPER_ADMIN authorization apply. The service-only admin_change_paid_category(uuid,text,uuid) independently checks the active SUPER_ADMIN access account. Browser roles cannot execute it. No new Vercel Function: total remains 10.

The RPC discovers the event by exact ID, acquires the same event advisory lock as create_reservation, locks the event row, then locks and rechecks the reservation. Event-first ordering avoids inversion with creation/expiry and event-management locks. Only stored PAID with checked_in_at NULL can change. WOMEN → MEN counts PAID plus unexpired RESERVED and PAYMENT_CLAIMED holds using DB NOW() and the event claim_hold_hours; MEN_TICKETS_FULL rejects when full. MEN → WOMEN needs no extra physical place. Same-category is a no-op after eligibility checks. SQL updates only category. Concurrent check-in first makes correction fail; correction first lets check-in read the new category. Deletion first yields not-found; correction first leaves ordinary deletion eligibility intact.

QR audit: deriveTicketToken signs tubarao-ticket-v1 plus reservation/event UUIDs via HMAC-SHA256. Category is absent. Existing QR hash, token, timestamps and reservation identity therefore remain intact. Both check-in RPCs read the current row category. Canonical explicit resend reloads the row and renders the new category with the same deterministic QR. Correction never calls delivery; an email already in flight may still contain its earlier snapshot, so use manual resend after correction when needed.

Tests execute the real SQL with PGlite, including both lock-outcome orders, protected holds, exact-ID duplicate preservation, no-op, roles, amounts/tiers/timestamps, QR lookup and KPI/public availability effects. PGlite serializes connections; true multi-session contention should additionally be verified on a controlled staging event. Existing pricing and deletion regression suites remain required.


## Atomic manual amount adjustment (local addition)

MIGRATION REQUIRED: YES — supabase/migrations/20261004_manual_amount_adjustment.sql. Rollout: verify 20261001/20261002 are already applied; apply 20261003_paid_category_correction.sql only if still pending; then apply 20261004; then deploy the matching application. Never rewrite/reapply applied migrations. No migration, deployment or live data edit is performed by this work.

POST /api/admin/payments?action=adjust-amount accepts only reservation_id and amount_cents (JSON integer 1..100000). Session/origin/JSON protections are inherited from the existing payments endpoint; SUPER_ADMIN authorization runs before validation/database mutation. The service-only admin_adjust_reservation_amount(uuid,jsonb,uuid) RPC independently validates the actor through admin_event_role and checks JSON numeric/integer/range constraints before conversion. JSONB prevents SQL argument coercion from accepting arbitrary strings/fractions. The browser splits decimal euro digits to integer cents. No new Vercel Function; total stays 10.

The RPC locks the exact reservation row, checks stored RESERVED/PAYMENT_CLAIMED/PAID, then inserts the audit and updates only amount_cents within one transaction. Any error rolls back both. Same amount returns changed:false without history. Row locking serializes corrections and concurrent payment/category/check-in/deletion operations. No event/pricing/capacity lock is needed because neither category, state nor occupancy changes. Normal expiry and recovery rules remain in force.

Private reservation_amount_adjustments stores UUID id, reservation_id snapshot, previous_amount_cents, new_amount_cents, adjusted_at, adjusted_by_access_id (FK to admin_access_accounts), and fixed reason MANUAL_ADJUSTMENT. RLS is enabled with no public policies/grants; service_role has SELECT, while inserts occur via the security-definer RPC. The reservation_id deliberately has no FK: existing hard deletion must neither erase immutable history nor become blocked. History retains no guest contact details or QR material and is excluded from public APIs and the normal CSV.

Pricing tier, category, identity, deadlines and payment/email/check-in timestamps are not written. Revenue, CSV, recovery and payment links already derive from the stored amount. The HMAC identity contains only reservation/event IDs, so neither QR regeneration nor invalidation is needed. Canonical manual resend reloads the current amount. An email already in progress may contain its pre-adjustment snapshot; a later explicit resend uses the corrected value. No automatic sending or Revolut API action is introduced.

Tests cover API/SQL authorization, exact identity, no-op, strict input types, atomic rollback on audit or reservation write failure, private permissions, price/tier/state/timestamp invariance, unchanged counts/caps, downstream amount reads, category correction, audit retention after deletion and UI request latching. PGlite executes real SQL but serializes requests; it is not a substitute for multi-session staging contention tests.
