# Nova SBE demo isolation

20 November 2026 · Introduction to Programming

**The reviewed source set is suitable for a private GitHub repository.** Share only files eligible under `.gitignore`. The copy has no Git history, remote, Vercel project link or Supabase CLI link. This step created no Git metadata, commit, repository or deployment. Production applications, databases, payment services and email services were untouched.

## Demo behavior

The browser submits a normal reservation and displays its database-locked amount and deadline. **SIMULATE … & CLAIM** calls the existing claim endpoint. It starts no transfer and uses no payment URL. The original reservation and claim expiry, capacity, category, pricing and recovery rules apply.

A signed-in `SUPER_ADMIN` can confirm or reject the claim. Confirmation persists `PAID`, records the authenticated actor and issues a demo QR locally. Completed payments offer **DOWNLOAD DEMO QR** for issued, current-event paid tickets. The authenticated endpoint returns a private, non-cacheable PNG after reproducing the opaque token and checking its stored hash. A failed issuance can be retried by `SUPER_ADMIN`. Checkout never displays the QR. The existing door roles, current-event restrictions and atomic check-in RPCs still apply, including duplicate-scan handling.

The database schema and existing RPC signatures were preserved. Historical field names such as `ticket_sent_at`, `ticket_email_attempts` and `ticket_email_sent` now describe local issuance in this copy. The existing `resend-ticket` action is presented as **RETRY TICKET** and uses the same deterministic QR. The ticket template remains available as a local preview fixture. It has a classroom footer and no private map links or outbound mail transport.

## Local configuration

| Setting | Required value |
| --- | --- |
| `DEMO_MODE` | Set explicitly to `local`. Blank in the template. |
| `DEMO_SUPABASE_URL` | Exact loopback API origin `http://127.0.0.1:54321`. Use a disposable local database at this address. |
| `DEMO_SUPABASE_SECRET_KEY` | Service-role credential from that local stack. Blank in the template. |
| `DEMO_TICKET_SIGNING_SECRET` | New stable, high-entropy demo secret of at least 32 UTF-8 bytes. Blank in the template. |

API requests with incomplete or invalid configuration return `503 DEMO_SETUP_REQUIRED` before a database request. The server rejects hosted database URLs, Vercel runtime configuration and production mode. Database requests are confined to the loopback origin and deny redirects. The former production environment variable names have no effect. The local Node runner binds to `127.0.0.1:3000`, serves `dist/` and the existing handlers, and requires no account or project link.

Full-stack operation requires a disposable Supabase instance with a reviewed schema-only baseline. The seven migrations assume legacy tables, grants and RPC definitions that are absent from this copy. Apply them in filename order to the local baseline and preserve the access-auth preflight. Seed a fictional active event and synthetic role accounts and guests. The automated tests use mocked flows and PGlite fixtures. They do not supply that baseline.

## Files changed

| Area | Files and changes |
| --- | --- |
| Payment and QR backend | Removed the payment URL builder `server/payments.js` and URL fields from `server/backend.js` and `server/domain.js`. Added authenticated QR download dispatch in `api/admin/payments.js`, `server/admin-routes.js`, `server/backend.js`, `server/validation.js` and `server/ticket-delivery.js`. Local issuance is shared by normal confirmation, recovery and retry. Removed the outbound transport and venue links from `server/tickets.js`. |
| Frontend | Updated `checkout.html`, `checkout.js`, `admin.html`, `admin.js`, `ticket.html` and `privacy.html` for simulated payments and local ticket issuance. In `index.html` and `app.js`, preserved the self-confirmation gate and brand handle with a local demo action. Existing styles, layout and brand assets are preserved. |
| Local infrastructure | Guarded database configuration in `server/supabase.js`. Added `.env.example` and `scripts/dev.cjs`. Updated `.gitignore` to allow only the root environment template and to allow the sanitized diagnostic. Adjusted the `scripts/build.cjs` success output for local use. |
| Diagnostic and dependencies | Replaced hardcoded event/reservation IDs with empty UUID inputs in `scripts/diagnose-payment-reservation.sql`. Removed the Resend SDK and its four exclusive transitive packages from `package.json` and `pnpm-lock.yaml`. Kept all other pinned dependency versions. Added the local runner command to `package.json`. |
| Tests | Added `tests/demo-isolation.test.cjs`. Updated `tests/admin.test.cjs`, `tests/api-routing.test.cjs`, `tests/backend.test.cjs`, `tests/checkout.test.cjs`, `tests/prelaunch.test.cjs`, `tests/pricing.test.cjs`, `tests/prototype.test.cjs` and `tests/tickets.test.cjs`. Replaced provider-only assertions with checks for no outbound activity, local issuance, access controls and duplicate admission. Kept the existing pricing, capacity, SQL and check-in coverage. |
| Documentation | Updated `README.md` and `AGENTS.md` for the classroom workflow. Marked `docs/PRODUCT.md`, `docs/TECHNICAL.md` and `docs/NOVA-PROJECT-AUDIT.md` as historical and removed copied live configuration details where found. Added this isolation record. |

## Verification and limitations

- The eligible file set was checked for credential signatures, hosted Supabase connection strings, payment destinations, venue links, operator UUIDs, Vercel identifiers and guest data. The known payment recipient, venue URLs and diagnostic IDs were also scanned across the workspace, including ignored artifacts. No matches remained. No guest roster or actual guest records were found. The original logo and 11 sampled video frames showed only brand artwork. The video retains existing provenance metadata.
- **230 tests passed.** The fixture workflow covers reserve, claim, admin confirmation, QR issuance and download, check-in and duplicate admission. The public build passed. The local runner's request handler passed an in-process smoke check for the homepage, unconfigured read and write responses, private-file exclusion and host validation.
- Registry requests failed in this environment. The frozen dependency install succeeded from the copied cache using pnpm's hoisted linker and the existing pinned lockfile. This offline run skipped fresh registry trust checks. The live localhost socket probe was blocked by the sandbox, so the tests did not verify a running Supabase instance, real database contention over separate connections or a physical camera scan.
- Keep the ignored preview screenshots, package caches, test installs, build outputs and synthetic exports out of the upload. The lexical scan does not establish what every ignored image contains. The private repository should contain the reviewed source set only.
