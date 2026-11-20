# Developer Guide

This guide explains how to run the classroom app, where to make changes, and how to check your work. For a walkthrough of what guests and staff do, start with the [Project Overview](PROJECT-OVERVIEW.md).

## Run the automated checks

You can check the code before setting up an event. The tests use made-up records and test versions of external dependencies. The build copies the files that a browser needs into the `dist/` folder.

Use Node.js 24, which runs JavaScript on your computer, and pnpm, which installs the libraries the project uses. Open a terminal in the project folder and run the commands in order.

If you still need a copy of the project, follow the [Team Handbook](CONTRIBUTING.md#get-your-own-copy) first.

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
node --test tests/*.test.cjs
node scripts/build.cjs
```

The `--frozen-lockfile` option installs the versions listed in `pnpm-lock.yaml` and reports a mismatch with `package.json`. Keep both files together when changing dependencies. The tests and build require neither a running Supabase database nor an access code.

## Run the whole app locally

Checkout, the dashboard, and the door screen need a database so they can all agree on the same event and tickets. The classroom app runs on your own computer, with made-up records and a local database.

### Set up the database

The database needs a starting layout before it can accept bookings. **The starting layout is missing from this repository.** Ask the project maintainer for the reviewed schema-only baseline, meaning the definitions for the tables, database functions, and permissions, without any guest records.

1. Prepare a fresh local Supabase setup with made-up data. Supabase provides PostgreSQL, the database used by the app. It also provides an **API**, or a set of requests other programs can make, at `http://127.0.0.1:54321`.
2. Load the baseline into that local database. The [schema reference query](supabase-contract.sql) only describes an existing database. Test files set up smaller databases for specific checks.
3. Apply the [migrations](../supabase/migrations) in filename order, from `20260928_admin_event_management.sql` through `20261004_manual_amount_adjustment.sql`. A migration is a file that makes a versioned change to the database. The access-code migration checks for the existing account tables, audit columns, and check-in function signatures. If it stops, correct the local baseline and rerun the migration with the check in place.
4. Add an active fictional event with sales open, or create and activate one from the dashboard after setting up a `SUPER_ADMIN`. Create separate active accounts for `SUPER_ADMIN` and `ADMIN`. Use distinct local access codes and made-up guest details such as `alex@example.test`.

For account setup, the server stores a **hash**, a one-way result calculated from an access code, and a **salt**, random bytes used in that calculation. In `admin_access_accounts`, set a label, role, and `is_active=true`, and store `code_salt` and `code_hash` as hex strings. Calculate the 32-byte hash with Node’s `scrypt` using the trimmed, case-sensitive code, the salt bytes, and `N=16384`, `r=8`, `p=1`. Generate a fresh salt for each account. Keep the code itself private and let the app create session records when someone signs in. [Access-code implementation](../server/admin-auth.js)

### Configure and start the website

The server reads its local settings from a private file named `.env`. Copy [the environment template](../.env.example) to that filename in the project folder. Git, the tool that tracks shared changes to files, ignores the private file.

| Setting | What to enter |
| --- | --- |
| `DEMO_MODE` | `local` |
| `DEMO_SUPABASE_URL` | `http://127.0.0.1:54321`, the exact address on this computer |
| `DEMO_SUPABASE_SECRET_KEY` | The service-role key from your local Supabase stack. This gives the server privileged access to that database. |
| `DEMO_TICKET_SIGNING_SECRET` | A fresh random value of at least 32 UTF-8 bytes. Keep the same value while using tickets issued by this database. |

To generate a random signing secret, run the following command and copy its output into your local `.env`.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start the local runner, then open `http://127.0.0.1:3000` in your browser. Keep the terminal open while you work. Press **Ctrl+C** in the terminal when you want to stop the app.

```sh
node --env-file-if-exists=.env scripts/dev.cjs
```

Use `/admin.html` for organizers and `/checkin.html` for the door screen. Use a camera on the computer running the demo or try manual check-in. The server listens only on this computer. The database connection also stays on this computer and refuses redirects. Hosted database addresses, Vercel runtime settings, and production mode are rejected. [Local runner](../scripts/dev.cjs) · [Database connection checks](../server/supabase.js)

## Find the code behind a screen

The browser shows the pages and sends requests. The app server checks those requests and talks to the database. The database saves shared information and decides whether changes such as a booking or check-in are allowed.

```text
Browser page → /api request → server code → local Supabase database
             ← result or error ←
```

A **route** is the address for a request. A **handler** is the code that responds. A **database function**, also called an RPC in the source, is a named operation that runs inside PostgreSQL.

| You want to change… | Start with… |
| --- | --- |
| The public home page and shared browser behavior | [index.html](../index.html) and [app.js](../app.js) |
| What guests see and do during checkout | [checkout.html](../checkout.html) and [checkout.js](../checkout.js) |
| Organizer tools or event settings | [admin.js](../admin.js) and [admin-management.js](../admin-management.js) |
| The scanner and arrival list | [checkin.js](../checkin.js) and [checkin-presence.js](../checkin-presence.js) |
| Which requests the app accepts | [api/](../api) and [server/admin-routes.js](../server/admin-routes.js) |
| How a booking, ticket, or check-in works | [backend.js](../server/backend.js), [ticket-delivery.js](../server/ticket-delivery.js), and [checkin.js](../server/checkin.js) in `server/` |
| Data layout, database rules, and tests | [Migrations](../supabase/migrations) and [tests/](../tests) |

The browser uses HTML for page structure, CSS for appearance, and JavaScript for interactions. The [build allowlist](../scripts/build.cjs) lists the public files to copy. The browser uses same-origin requests, meaning the pages and their API are served from the same address. The privileged Supabase key stays in the server process. Shared [request handling](../server/http.js) checks methods and write requests and returns safe errors.

## Follow the reservation rules

A reservation protects both the guest’s place and the quoted price. The database makes the final decision when people compete for the last place. The page shows the result and the time left.

| Stored state | What it means |
| --- | --- |
| `RESERVED` | The guest has a temporary hold. It expires at `reserved_until`. |
| `PAYMENT_CLAIMED` | The guest submitted a pretend claim. Its hold lasts until review or `claimed_at + claim_hold_hours`. |
| `PAID` | An organizer confirmed the claim. The reservation counts toward confirmed attendance and demo revenue. |
| `REJECTED` or `EXPIRED` | The place is released. An elapsed hold can be shown as expired even before the stored state is updated. |

- **Capacity.** Count confirmed tickets, active reservation and claim holds, and non-paying attendees against the physical limit. The `MEN` paid cap also applies to active reservation and claim holds and paid tickets in that category. The public API reports availability without giving exact counts.
- **Prices.** `create_reservation` selects the price using database time and saves `amount_cents` and `pricing_tier`. In `AUTO` mode, the exact early-price deadline selects `LATE`. An empty early-price deadline keeps `EARLY`. Forced modes select the named tier for new bookings. Sales closing time is independent. Display options change what the browser shows. An explicit admin amount correction is the audited exception to price locking.
- **Recovery.** A fresh submission can resume a matching name, surname, email, and category for the active event. A returning browser can use the saved reservation ID and email to ask the server for current state. Recovery preserves the original deadlines and price. The separately authorized `confirm-external-payment` action is a classroom recovery option backed by `confirm_external_payment`, with capacity and role checks in the database.
- **Event selection.** The server looks for an active `OPEN` or `SCHEDULED` event first, then any active event. It prefers the newest by creation time, with ID breaking ties. Event changes and non-paying attendee updates use database functions so capacity checks and writes run together.

## Protect staff actions and tickets

Staff permissions matter because confirming a claim and admitting a guest change what someone can do at the event. The server checks the signed-in role each time. Door staff can check in guests, and organizers can also change event and payment records.

When a staff member signs in, the server verifies the access code and starts a **session**, a temporary record of that sign-in. The browser receives an `HttpOnly` cookie, which it can send with requests and page scripts cannot read. The database stores only the session token’s hash. A session lasts 12 hours and logout revokes it. Every protected route checks the session and active account. `ADMIN` can search, check in, and view live arrivals. `SUPER_ADMIN` also manages events, claims, QR downloads, and exports.

Ticket issuance starts after the reservation becomes `PAID`. The server uses HMAC-SHA256, a method that combines a private signing secret with the reservation and event IDs to reproduce a unique token. The QR contains only `TUBARAO:<token>`. The database keeps a SHA-256 hash of the token. Retry and download reproduce the same token and check it against that hash. An issuance failure leaves the reservation `PAID`. The historical `ticket_sent_at` field records local issuance, and **RETRY TICKET** calls the existing `resend-ticket` action. The classroom app sends no email.

For scanning, the server hashes the token and checks that it belongs to a paid reservation for the current event. `check_in_ticket` or `check_in_reservation` then records the admission and staff account in one database operation. This keeps two scans of the same ticket from both admitting the guest. The presence view lists arrivals and excludes their emails. It can refresh without interrupting the scanner. [Ticket code](../server/ticket-delivery.js) · [Check-in code](../server/checkin.js)

## Look up an API route

Use this table to find the server entry point for a browser action. `GET` reads data. `POST` submits an action or a private lookup. `PATCH` updates specific fields, and `DELETE` removes an eligible record.

| Route | Methods and purpose |
| --- | --- |
| `/api/event-state` | GET public event, price, and availability |
| `/api/reserve` | POST create or resume a reservation |
| `/api/reservation-state` | POST look up a reservation using its ID and email |
| `/api/claim-payment` | POST claim a simulated payment using reservation ID and email |
| `/api/admin/auth` | GET identity, POST login or logout |
| `/api/admin/dashboard` | GET organizer dashboard |
| `/api/admin/events` | GET list or download a backup CSV or guest-list PDF, POST create or activate, PATCH update the active event |
| `/api/admin/non-paying-attendees` | GET list, POST add, DELETE remove |
| `/api/admin/payments` | GET `ticket-qr` for an issued current-event ticket. POST confirm, recover, reject, retry, correct category or amount, or remove eligible records. |
| `/api/admin/check-in` | GET search or `presence`, POST scan or manual check-in |

Several routes use `?action=...` to choose the operation. Read the handler to see exactly which fields it accepts. For example, QR download uses `?action=ticket-qr&reservation_id=<id>` and requires a `SUPER_ADMIN` session. [Action names and dispatch](../server/admin-routes.js) · [Staff sign-in actions](../server/admin-auth.js)

## Understand what the database stores

The data is split into **tables**, like named sheets with a consistent set of columns. Each row represents one event, reservation, account, or related record.

| Table | What it stores |
| --- | --- |
| `events` | Event settings, active status, capacity, sales times, and pricing |
| `reservations` | Guest details, the event and ticket category, stored price, status and deadlines, QR hash, issuance, and check-in |
| `non_paying_attendees` | Named guests who count toward event capacity without adding to paid revenue |
| `admin_access_accounts` and `admin_sessions` | Staff roles, access-code hashes, and temporary sign-ins |
| `reservation_amount_adjustments` | Previous and new amounts, time, and actor. This audit record survives reservation deletion. |

Reservations and non-paying attendees refer to the event they belong to. Important changes run inside **transactions**, groups of database operations that succeed or fail together. Database permissions and row-level security, which controls which rows a database role can access, keep private data out of browser-facing access. Preserve the checks inside the existing database functions and the exact deletion conditions in the server. [Schema and database changes](../supabase/migrations) · [Repository rules](../AGENTS.md)

Ordinary reservation deletion targets an exact ID and requires an eligible unpaid state with no payment, ticket, or check-in markers. A separate action can delete an accidentally issued paid duplicate before check-in. The server repeats eligibility checks in the deletion itself so a concurrent admission or payment cannot slip through. [Deletion rules](../server/reservation-deletion.js)

## Test a change and troubleshoot

Start with the smallest check that covers the change, then run the whole suite. A test **fixture** supplies predictable data, such as a fictional event or reservation. A **mock** stands in for a dependency so the test can control its behavior.

```sh
node --test tests/checkout.test.cjs
node --test tests/demo-isolation.test.cjs
node --test tests/*.test.cjs
node scripts/build.cjs
```

Tests cover browser behavior, server requests, PDF output, and database rules. Some tests run SQL using PGlite, a local PostgreSQL engine embedded in the test process. Those tests are useful for migration behavior and access rules. Checking real simultaneous requests or a camera still requires a running local demo.

| What you see | What to check |
| --- | --- |
| The home page loads, but API requests show `DEMO_SETUP_REQUIRED`. | Check the four `DEMO_` settings and restart the runner. Use the exact database address and a fresh local key and signing secret. |
| The server shows `SERVICE_UNAVAILABLE`. | Check whether the local database is running and whether its schema is ready. The API hides raw database errors. |
| Staff actions return `401` or `403`. | For `401`, sign in again and check that the local account is active. For `403`, check whether the action requires `SUPER_ADMIN`. |
| A guest sees closed or unavailable tickets. | Check the active event, sales setting and time, and capacity in the organizer dashboard. |
| A confirmed claim has no download. | Check completed payments for the current event, or use **RETRY TICKET** if issuance failed. If the hash mismatches, restore the signing secret used for that local dataset. |
| The camera is unavailable. | Check browser camera permission on the host computer, or search by name and check the guest in manually. |

## Known limits and next ideas

Some checks can run on any teammate’s computer. Others need a complete local database or a physical camera. The table explains which limits you may run into and what a future task could improve.

| Current limit | Possible next step |
| --- | --- |
| A fresh clone cannot run the full booking flow with the migrations alone. It needs the missing [database baseline](#set-up-the-database). | Prepare and review the table and function definitions and add a repeatable way to load a fictional event and staff accounts. |
| The classroom runner is available only on the computer that starts it. A phone on the same Wi-Fi cannot open that address. | Plan a separate, isolated device test for the scanner. For the default setup, use the computer’s camera or manual check-in. |
| The automated SQL tests exercise rules in PGlite, which runs requests in sequence. They do not prove what happens when two database connections compete for the last place or scan at the same time. | Add a local test using two independent database connections. |
| Events have a start time. The public page has one historical end-time value tied to a specific date, so a new event cannot have its own configurable end time. | Discuss an editable end time before proposing a database change. [Browser date formatting](../app.js) |
| Door check-in supports paid tickets. A non-paying guest can appear in live arrivals if the record is already marked as checked in, but the door screen has no action to check in a non-paying guest. | Decide whether the classroom project needs that workflow before changing access rules. |

The repository has no maintained list of confirmed open bugs. The limits above come from the current code and recorded checks. If you find a repeatable problem, use the [bug report steps](CONTRIBUTING.md#report-a-problem). The ideas are starting points for team discussion.

## Read past decisions

Older documents explain how the original app evolved. Use this guide for the classroom app today.

- [Original product requirements](PRODUCT.md) and [technical history](TECHNICAL-HISTORY.md)
- [Initial classroom audit](NOVA-PROJECT-AUDIT.md), [demo isolation and verification record](NOVA-DEMO.md), and [access-code change record](ACCESS_AUTH_CHANGELOG.md)
- [Brand guide](BRAND.md) for visual and writing choices
