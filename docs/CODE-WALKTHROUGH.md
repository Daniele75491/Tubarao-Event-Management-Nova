# Code walkthrough · Python + Streamlit version

This guide prepares the whole team for the repository walkthrough. In it, staff open the code and ask how the project is built, why it is built that way, and what its limits are. **Any member can be asked about any part.** Read this guide once and open each file it mentions.

Every statement points to a file and a function in `streamlit-app/`, so you can show the code when asked.

## The big picture in one sentence

A button press goes **screen → rule → storage**: `app.py` calls a function in `logic.py`, which checks the rules and saves through `db.py` into one SQLite file.

```text
 Browser ──► app.py (screens) ──► logic.py (rules) ──► db.py (storage) ──► data/tubarao.db
                 ▲                      │                                    (one SQLite file)
                 └── result or error ◄──┘
                                        └──► tickets.py (QR codes)  guest_list_pdf.py (PDF)
```

Example: **CONFIRM PAID** in `app.py` calls `logic.confirm_payment()`. That function:
1. checks that the user is the organizer (`require_role`);
2. checks that the booking is PAYMENT_CLAIMED and still inside its review window;
3. saves PAID through `db.update`;
4. calls `logic.issue_ticket()`, which uses `tickets.py`.

## Each Python file, for beginners

| File | Size | What it does | Look at |
| --- | --- | --- | --- |
| `app.py` | ~1,130 lines | **The screens.** Draws the four pages with Streamlit and collects clicks. It never decides a rule and never writes to the database itself. | `page_tickets`, `page_door`, `page_organizer`, `page_privacy`, `main`, `act` |
| `logic.py` | ~1,190 lines | **The rules.** Prices, capacity, the MEN cap, holds and deadlines, sign-in, who may do what, single-use check-in, corrections and exports. If a rule says no, it raises `TubaraoError` with a short code such as `MEN_SOLD_OUT`. | `reserve`, `claim_payment`, `confirm_payment`, `check_in_qr`, `occupancy`, `effective_status`, `require_role` |
| `db.py` | ~290 lines | **The storage.** Creates the tables (`SCHEMA`) in one SQLite file and has small helpers to read and save rows. Its `transaction()` makes several steps all-or-nothing. | `connect`, `transaction`, `SCHEMA` |
| `tickets.py` | 115 lines | **The QR code.** Makes the secret ticket token, draws the QR image and reads QR photos with two OpenCV readers, because one alone misses a few codes. | `derive_ticket_token`, `hash_ticket_token`, `parse_payload`, `decode_qr_image` |
| `guest_list_pdf.py` | 82 lines | Draws the printable guest list with `fpdf2` and the DejaVu font, so accents like "ã" work. | `render` |
| `seed.py` | 214 lines | Asks first, then replaces the demo database with a new one holding made-up data and two access codes. The new file is built separately, so a failure keeps the old data. | `seed`, `check_codes`, `main` |
| `selection.py` | 58 lines | Remembers which organizer table row is selected by its booking ID, never by its position, so a changing list cannot redirect an action. | |
| `tests/` | 18 files | 274 automated checks, run with `uv run pytest`. | `conftest.py` (shared setup), `test_qa_*.py` (QA additions) |

**Streamlit**, in one paragraph: Streamlit reruns the whole page script from top to bottom every time someone clicks. Values that must survive a rerun live in `st.session_state`, which belongs to one browser tab. That is why `app.py` keeps the database connection (`conn()`) and the staff session token (`staff_token`) there. `@st.fragment(run_every="5s")` reruns only one part of the page every few seconds, for example `live_attendance` on the door screen.

## The main data (tables in `db.py`)

| Table | One row is… | Important columns |
| --- | --- | --- |
| `events` | one party | `physical_capacity`, `men_paid_cap`, `early_price_cents`, `late_price_cents`, `pricing_mode`, `sales_mode`, `is_active` |
| `reservations` | one guest booking | name, `email`, `category`, `amount_cents`, `pricing_tier`, `status`, deadlines (`reserved_until`, `claimed_at`), `qr_token_hash`, `checked_in_at` |
| `non_paying_attendees` | a resident or invited guest | name, `category`, `checked_in_at` (no price, no QR) |
| `admin_access_accounts` | a staff code | `role` (`SUPER_ADMIN` or `ADMIN`), `code_salt`, `code_hash`, `is_active` |
| `admin_sessions` | one sign-in | `session_token_hash`, `expires_at`, `revoked_at` |
| `reservation_amount_adjustments` | one manual price correction | previous and new amount, who, when. It has no foreign key on purpose, so the history survives if the ticket is deleted. |

Money is always stored in **cents** as whole numbers (800 = €8.00). This avoids rounding errors with decimals.

## The life of a booking

```text
RESERVED ──guest claims──► PAYMENT_CLAIMED ──organizer confirms──► PAID ──door──► checked in
   │                            │
   └─ 20 min pass → EXPIRED     ├─ organizer rejects → REJECTED
                                └─ review window (24 h) ends → EXPIRED
```

- `reserve` creates RESERVED with `reserved_until = now + reservation_minutes`.
- `claim_payment` moves RESERVED to PAYMENT_CLAIMED and stores `claimed_at`. The claim is protected for `claim_hold_hours`.
- `confirm_payment` (organizer only) moves PAYMENT_CLAIMED to PAID and issues the ticket. `reject_payment` sets REJECTED.
- `confirm_external_payment` is the recovery path, for when the organizer saw the money but the guest never claimed. It can also restore an EXPIRED booking, but only after checking capacity again.
- **Expiry is computed, not scheduled.** No timer runs in the background. `effective_status()` looks at the clock: a RESERVED row past `reserved_until` *is* EXPIRED, even if the database still says RESERVED. `expire_elapsed()` saves that change whenever the active event's bookings are read: public page, booking view, door search, dashboard and backup CSV.

## The rules that matter most

- **Capacity** (`occupancy`). Counts PAID tickets, live holds, live claims and all non-paying guests. A new booking needs `total < physical_capacity`.
- **MEN cap.** Counts only paid-side MEN bookings (holds, claims and PAID); non-paying men do not count.
- **Price lock.** `reserve` stores `amount_cents` and `pricing_tier` when the booking is made, so later price changes never touch it. Only **ADJUST AMOUNT** (`adjust_amount`) changes it, and that change is recorded.
- **Early or late price** (`event_pricing`). In AUTO mode, EARLY applies until `early_price_ends_at`, and LATE applies from that exact moment.
- **Public page** (`public_state`). Only says AVAILABLE, FEW TICKETS LEFT or SOLD OUT, never exact numbers.
- **One live booking per email per event.** Enforced twice: by the code in `reserve` and by the database index `reservations_one_active_email_per_event`.

## How a QR ticket is made and checked

1. **Making it** (`tickets.derive_ticket_token`). An HMAC-SHA256 of `"tubarao-ticket-v1:<reservation id>:<event id>"`, signed with a secret key (`TUBARAO_TICKET_SECRET` or `data/ticket_secret.txt`). The result is 43 random-looking characters.
2. **What the QR contains.** Only `TUBARAO:<token>`: no name, email, price or category.
3. **What the database stores.** Only `hash_ticket_token(token)`, a SHA-256 fingerprint. The token itself is never saved. Someone who copies the database cannot rebuild the QR codes without the secret.
4. **Downloading again** (`logic.ticket_qr`). The app computes the same token from the IDs and the secret, then checks it against the stored fingerprint. If the secret changed, it stops with `TICKET_HASH_MISMATCH` instead of silently making a different QR.
5. **At the door** (`logic.check_in_qr`). `parse_payload` checks the format. The token is hashed and the reservation with that fingerprint is looked up. `_check_in` lets the guest in only if the booking is **PAID**, belongs to the **active event** and has no `checked_in_at` yet. Otherwise the result is INVALID or ALREADY_CHECKED_IN.

## Concurrency (two people at once) and persistence

- **The lock.** `db.transaction()` starts with `BEGIN IMMEDIATE`, which takes SQLite's write lock straight away. Two guests booking the last place, or two phones scanning one ticket, are processed **one after the other**. The second one sees the first one's result, so the event cannot be overbooked and nobody gets in twice. `tests/test_qa_concurrency.py` proves this with 8 threads.
- **All or nothing.** If anything fails inside a transaction, `ROLLBACK` undoes every change in it.
- **WAL mode.** `PRAGMA journal_mode = WAL` lets people read while someone else writes. The `timeout=10` setting makes a connection wait up to 10 seconds for the lock instead of failing.
- **Persistence.** Everything is in `data/tubarao.db` (or the path in `TUBARAO_DB`). Closing and reopening keeps all data; `tests/test_qa_workflow.py` checks this. `data/` is git-ignored, so real data and secrets never reach GitHub.
- **Limit.** This works because there is one SQLite file on one machine. Several servers sharing data would need a database server instead.

## Likely professor questions, with answers

**1. Where is the data stored?**
In one SQLite file, `data/tubarao.db`, created by `db.connect()` with the tables in `db.SCHEMA`. The `TUBARAO_DB` setting can point it elsewhere. The folder is in `.gitignore`.

**2. Why are the screens, rules and storage in separate files?**
So every rule lives in one place and can be tested without a browser. `app.py` only calls `logic.py`, and most tests call `logic.py` directly. The project's `streamlit-app/AGENTS.md` makes this a rule: "`app.py`… never decides a rule and never writes to the database directly."

**3. How do you stop two people buying the last ticket at the same time?**
`reserve` runs inside `db.transaction()`, which uses `BEGIN IMMEDIATE`. The capacity check and the insert happen while holding the write lock, so the second person sees the first booking and gets `EVENT_SOLD_OUT`. This is tested by `test_eight_guests_racing_for_the_last_place_produce_exactly_one_booking`.

**4. How can a ticket be used only once?**
`_check_in` reads `checked_in_at` inside a transaction. If it is already set, the result is ALREADY_CHECKED_IN with the first time. If not, it saves the time and the door account. This is tested by `test_one_ticket_scanned_by_many_door_phones_at_once_lets_one_person_in`.

**5. Could someone fake a QR code?**
Not without the secret. The token is an HMAC of the IDs with `TUBARAO_TICKET_SECRET`. The door only accepts a token whose SHA-256 matches a stored `qr_token_hash` of a PAID, active-event booking. This is tested by `test_a_qr_made_with_a_different_secret_is_invalid`.

**6. What is inside the QR? Is personal data exposed?**
Only `TUBARAO:` plus a 43-character token (`tickets.ticket_payload`). There is no name, email, price or category in it.

**7. How do staff sign in, and how are the codes protected?**
`logic.login` compares the code with every active account using `scrypt` with a random salt (`hash_access_code`). Only the salt and hash are stored. A session token is created and only its SHA-256 is stored in `admin_sessions`. Sessions last 12 hours (`SESSION_HOURS`), and LOG OUT revokes them.

**8. What can door staff do that the organizer cannot, and the other way round?**
Every action calls `require_role`, which reads the role from the database rather than trusting the screen. It also checks that the session still exists and is not revoked or expired, so a window left open after LOG OUT cannot act. `ADMIN` (door) is allowed only in `DOOR_ROLES` actions: check-in, search and live attendance. `SUPER_ADMIN` can do everything. This is tested by `test_door_staff_cannot_use_any_organizer_payment_or_ticket_action`.

**9. Why does a booking keep its price when the price goes up?**
`reserve` copies the current price into the booking's own `amount_cents` and `pricing_tier`. Prices on the event only affect new bookings. This is tested by `test_a_booking_keeps_its_status_deadline_and_price_after_the_database_reopens`.

**10. How do holds expire if nothing runs in the background?**
`effective_status()` compares `reserved_until` (or `claimed_at + claim_hold_hours`) with the current time whenever the booking is read. `expire_elapsed()` then saves EXPIRED, in the same transaction, whenever the active event's bookings are read. So expiry is always correct when it matters, with no scheduler.

**11. What do the tests cover, and what do they not cover?**
274 checks. They cover:
- every rule in `logic.py`, including refused actions such as SOLD_OUT, FORBIDDEN, INVALID and an expired claim;
- the screens, with Streamlit's `AppTest` in `test_app.py`;
- a full booking-to-door run on a real file;
- persistence after reopening, and race conditions with threads.

They do **not** cover a real phone camera, the deployed hosting, or the PDF's text. See [QA-FINAL.md](QA-FINAL.md#verification-gaps-not-tested).

**12. How do you know the tests actually test something?**
We broke the app on purpose (removed the lock, allowed double check-in, gave door staff organizer rights, ignored capacity), and the new tests failed every time. See [QA-FINAL.md](QA-FINAL.md#do-the-new-tests-really-catch-mistakes).

**13. Why is time passed in as `now` instead of read inside the functions?**
So tests can freeze the clock. `conftest.py` uses a fixed `NOW` and can test "21 minutes later" without waiting.

**14. What happens if the camera does not work at the door?**
`scanner` in `app.py` also accepts an uploaded QR image and a pasted code. **FIND BY NAME** (`manual_search` → `check_in_manual`) follows the same single-use and PAID-only rules.

**15. How do non-paying guests work?**
They are in `non_paying_attendees`. They take a physical place (`occupancy`) but not a MEN-cap place, and bring no revenue. They have no QR; the door checks them in by name with `check_in_non_paying`.

**16. What are the known limits, and how could the project change?**
- One SQLite file, so one machine. Several servers would need a database server.
- Staff are signed out when they reload the page, because Streamlit cannot set a secure cookie.
- The camera takes photos instead of scanning continuously.
- Refunds and some settings are not built.
- One known bug: QA-BUG-1, an old-event booking can still be claimed.

Next steps could be the open features (written spec first, then tests) and moving storage to a hosted database.

**17. Why are amounts in cents?**
Whole numbers avoid floating-point rounding (0.1 + 0.2 ≠ 0.3). `euros_to_cents` converts what the organizer types, and `money` formats it back for display.

**18. How do you stop someone injecting formulas into the CSV?**
`csv_cell` adds a `'` in front of text that starts with `=`, `+`, `-` or `@`, so Excel shows it as text. This is tested by `test_backup_neutralises_spreadsheet_formulas`.
