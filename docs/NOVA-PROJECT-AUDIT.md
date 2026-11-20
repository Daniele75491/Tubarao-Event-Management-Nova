# Tubarão classroom copy audit

20 November 2026 · Nova SBE Introduction to Programming

> Baseline audit recorded before sanitization. [Nova demo isolation](NOVA-DEMO.md) supersedes the setup and upload status below.

## Verdict

**The copy is independent at the filesystem and Git level. Hold the private GitHub upload and full-stack launch until the production references below are sanitized.** Git found no repository in this folder or its parents. There is no root or nested `.git` metadata, submodule configuration, or remote. The root file named `git` is empty. No Vercel project link or Supabase CLI configuration was found. `vercel.json` describes a build and functions without selecting a project.

The audit was confined to this copy. It changed `.gitignore` and added this report. The offline install attempt created an ignored, incomplete `node_modules/` directory. Application code and behavior were preserved. Production services were untouched. No Git repository, commit or remote was created.

## Findings and sanitization

| Finding | Required before sharing or running |
| --- | --- |
| **Hardcoded Revolut recipient.** `server/payments.js` builds a real-format personal payment URL from the stored reservation amount. The same recipient URL appears in `tests/checkout.test.cjs`. No payment request or transfer was made to verify it. | Remove the recipient from both files in a separate classroom change. Exercise the payment step through a disabled button or a local simulation. Check the checkout URL validation when designing the simulation. A fresh database alone would still expose the copied recipient. |
| **Operator-supplied event and reservation UUIDs.** `scripts/diagnose-payment-reservation.sql` contains two record identifiers associated with a support query. Its output could include private operational metadata if run against the original database. | Keep the script out of Git using the new ignore rule. If a classroom diagnostic is needed, create a version that accepts synthetic IDs as input. |
| **Venue links and production references.** `server/tickets.js` embeds Google and Apple Maps links for the house venue in the email body. `tests/tickets.test.cjs` references those links. The website and documents refer to the real Instagram account, and the README and technical notes refer to the live domain. The product and technical notes contain internal event settings and operational details. | Remove the private venue links from the shareable template, fixtures and previews. Review which brand and historical references the class is authorized to share. Label or rewrite the production setup and rollout instructions for classroom use. The public domain and Instagram references are identifiers without database or deployment privileges. |
| **Provider credentials and connections.** No environment file, project-specific Supabase URL, DB connection string, deploy identifier, live API key, signing secret, access code or session value was identified in the application source. The server reads its configuration from the environment. Broad signatures found matches in the copied dependency store, which is excluded in full. | Supply fresh local configuration as listed below. Never reuse provider environment files, access accounts, session hashes, signing keys, DB credentials or production CLI project links. |
| **Guest data and local artifacts.** No guest roster, database dump, CSV/PDF attendee export or confirmed set of live guest names or emails was found. Source email literals appeared in fixtures. Some fixtures use ordinary-looking domains, so use reserved addresses for manual tests. The copy included three pnpm cache/state/store directories, with 33 preview PNGs, an email HTML preview and helper scripts. | Keep these generated directories out of Git. Do not distribute the screenshots or their email preview. The lexical scan cannot verify text in every image or frame. Confirm classroom sharing rights for the original logo and hero video, and check the video for identifiable people or location details before sharing. |

The updated `.gitignore` excludes environment files, package caches, installed dependencies, build and coverage output, deployment and Supabase link state, common key formats and data exports, the diagnostic SQL and the empty `git` file. It keeps `pnpm-lock.yaml`, source assets and the seven migration files eligible for version control. A local file listing with the updated ignore rules confirmed those exclusions. Before the first commit, review the actual staged file list and run a secret scan on that set. Add files by review rather than uploading a zip of this folder, which would include ignored content.

## Architecture and behavior

- **Browser.** Mobile-first HTML, CSS and vanilla JavaScript serve the landing page, checkout, privacy notice, ticket information, admin dashboard and check-in. The build script copies the public pages, assets and scanner library to `dist/`. Pages use same-origin `/api` endpoints. Checkout recovery stores a reservation ID and email in browser storage and revalidates them on the server.
- **API.** Ten Vercel function entry points cover four public routes (event state, reserve, claim and reservation recovery) and six admin routes (auth, dashboard, events, non-paying attendees, payments and check-in). CommonJS modules in `server/` handle validation, session and role checks, database access and exports. The Supabase client is server-only. The access-code flow uses scrypt and an HttpOnly session cookie. `SUPER_ADMIN` manages events, payments, attendees and exports. Door `ADMIN` has QR and manual paid-ticket check-in, attendee search and arrived-only presence. Both roles can use the door tools.
- **Sales and payment.** Database time and event settings select EARLY/LATE pricing and govern capacity, reservation and claim deadlines. Reservations lock a price. Customers self-confirm their Instagram follow, choose a category, submit their name and email, and reserve. The external Revolut step requires manual staff verification. The customer can claim payment, and staff can confirm or reject it. The backend also supports recovery, audited amount changes, paid category corrections and restricted deletion. Public inventory is qualitative.
- **Tickets and attendance.** After confirmation, the server derives an opaque HMAC ticket token, stores its SHA-256 hash and attempts QR delivery through Resend. Email failure leaves the reservation PAID. Check-in verifies the session and uses atomic database RPCs for current-event, single-use admission. Private management downloads include an event backup CSV and a names-only guest-list PDF.
- **Tooling.** Node.js 24 and pnpm, with locked dependencies. Runtime libraries include the Supabase JS SDK, Resend, `qrcode`, `qr-scanner`, PDFKit and Noto Sans. Node's test runner uses browser/HTTP/database fixtures, injected mail transports, PGlite for isolated SQL tests and PDF.js to inspect generated PDFs. `README.md` is a useful overview but lags the code, including the expanded payment actions, implemented reservation recovery and guest-list PDF. The product and technical specs and current route handlers describe the broader feature set.

### Database structure

| Table | Purpose |
| --- | --- |
| `events` | Event identity and active selection, sales schedule, capacity and category cap, hold durations, EARLY/LATE pricing and display controls. |
| `reservations` | Event-linked guest details, category, locked amount and tier, reservation/payment state and timestamps, QR hash, email attempts and check-in audit. Main states are RESERVED, PAYMENT_CLAIMED, PAID, REJECTED and EXPIRED. |
| `non_paying_attendees` | Event-linked attendees that count toward physical capacity and contribute to presence when already checked in. |
| `admin_access_accounts` and `admin_sessions` | Staff roles and salted access-code hashes, plus hashed session tokens with expiry and revocation. Historical admin profiles and actor columns are compatibility records. |
| `reservation_amount_adjustments` | Private audit table with previous/new amount, actor and reservation ID snapshot. History survives removal of the reservation. |

PostgreSQL RPCs control reservations, claims, payment decisions, event-management mutations and admission. The seven SQL files from `20260928` through `20261004` are incremental migrations. **A complete bootstrap schema is missing.** `docs/supabase-contract.sql` contains read-only catalog queries. PGlite tests build partial fixtures, including simplified RPCs. A disposable Supabase instance still needs a reviewed schema-only baseline with tables, enums, constraints, roles, grants, policies and existing RPC signatures. In particular, the access-auth migration checks for the access tables, audit columns and original check-in signatures. Preserve that preflight.

## Test-only configuration

| Setting | Classroom value or action |
| --- | --- |
| `SUPABASE_URL` | URL of a disposable local Supabase API. With a separately authorized course-only Supabase project, verify its project reference before supplying its URL. |
| `SUPABASE_SECRET_KEY` | Server-only key for the same disposable instance, with the service-role access the code expects. |
| `TICKET_SIGNING_SECRET` | Fresh, high-entropy classroom-only secret of at least 32 UTF-8 bytes. Keep it stable for that dataset if testing same-ticket resends. |
| `RESEND_API_KEY` and `EMAIL_FROM` | Leave both unset for classroom work with real sending disabled. To test delivery and resend behavior, use the test transport or implement a local capture transport in a later change. The current sender calls Resend when configured. Unset config blocks delivery, while confirmation can still persist PAID and attempt metadata. |
| Revolut recipient | A code literal in `server/payments.js`, with no environment override. Disable or simulate the payment action before enabling interactive checkout. |
| Admin access codes and sessions | Provision separate synthetic door and management accounts in the test database. Generate salted scrypt hashes that match the server contract. Let login generate fresh sessions. |
| Development origin and environment | Use a fresh localhost origin and browser profile. `NODE_ENV`, `VERCEL` and the forwarded protocol affect the Secure cookie flag. Use a compatible local origin or HTTPS for cookie and camera tests. Leave `TUBARAO_TEST_PDF_SAMPLE` unset unless intentionally writing a synthetic sample to an ignored path in this copy. |

The legacy `EMAIL_USER` and `EMAIL_APP_PASSWORD` variables are unused. There is no Revolut API key or frontend Supabase key to configure. No environment template or credential placeholder was added.

## Local testing sequence

1. **Run the existing automated tests first.** From this copy, with production environment variables absent, use Node.js 24 and `pnpm install --frozen-lockfile` against the package registry or a complete trusted cache. Run `pnpm test` and `pnpm build`. The automated tests use local fixtures and mocks and need no Supabase or Resend credentials. A static build can verify layout, while a browser alone cannot exercise the API routes.
2. **Prepare a disposable database.** Start an isolated local Supabase stack with the reviewed schema-only baseline, then apply the seven migrations in filename order with their original checks. Seed a fictional active event, distinct test role accounts and synthetic records in the relevant reservation states. Use synthetic emails under a reserved domain such as `example.test`. Verify that public roles cannot read reservations or staff credentials. Use independent database sessions for capacity and duplicate-admission tests, since PGlite serializes requests.
3. **Isolate the browser and API.** Remove the live payment destination, keep real mail disabled, and run the static output and Node handlers behind the same local origin using a local development runner. The copied README proposes Vercel's development server. If it requires account linking or environment sync, use an independent classroom setup or a localhost adapter. Keep the production Vercel project and its environments out of that flow. Permit application traffic only to the local test database and any local test sinks.
4. **Exercise the end-to-end flow.** Test reserve, refresh/recovery, expiry, claim, manual review with simulated payment, locally captured ticket rendering, QR scan and duplicate scan. Test door-role denial of management actions, capacity boundaries, and exports containing only synthetic data. Test camera permissions on an appropriate secure origin.

**Audit verification.** Fifty selected dependency-free UI and checkout tests passed on Node.js 24.22.3. The offline frozen install with pnpm 11.25.0 stopped on missing cached metadata for an optional canvas package during the lockfile policy check. The full suite and production-style build were not verified. No database or external provider was contacted for runtime verification.

## Remaining risks and upload gate

The privileged Supabase key can exercise production reads and writes if someone supplies the wrong URL and key. A configured Resend transport could email real recipients. The current checkout still exposes the copied Revolut recipient once reservations are enabled. The original browser origin may hold recovery data. Private GitHub visibility restricts access but cannot prevent disclosure to collaborators or prevent accidental deployment linkage. The technical docs also identify deployment-level rate limiting, genuine multi-session database verification and physical-device camera checks as open.

**Private GitHub is suitable once the shared file set excludes the operator diagnostic and generated files, the payment recipient and private venue links are removed from source and tests, and the team has cleared the documentation and media for sharing.** The missing database baseline and simulated payment/mail setup remain separate prerequisites for a safe interactive classroom environment.
