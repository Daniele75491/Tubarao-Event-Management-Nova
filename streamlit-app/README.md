# Tubarão in Python + Streamlit

This folder is the Python version of Tubarão, rebuilt so it fits the Nova SBE *Introduction to Programming* course. It does the same job as the JavaScript app in the rest of this repository: guests hold a place, organizers check payments, and door staff let people in. It uses the same structure as the course apps (`app.py`, `logic.py`, `db.py`, tests with `pytest`).

The classroom rules still apply. Use made-up names and `@example.test` emails. Payments are pretend, and the app sends no emails.

## Try it on your computer

You need [uv](https://docs.astral.sh/uv/), the same tool the course uses. Open a terminal in this `streamlit-app` folder and run:

```
uv run python seed.py
uv run streamlit run app.py
```

The first command creates a demo database with a party, four residents and made-up guests. It prints two **access codes**, one for the organizer and one for the door. They are also saved in `data/ACCESS_CODES.txt`. The second command opens the app in your browser.

To run the automated checks:

```
uv run pytest
```

To start again from a clean demo at any time, run `uv run python seed.py` again.

## Follow one ticket from booking to the door

1. **Guest** (Tickets screen). Tick *I follow @casitatubarao*, pick a ticket, and reserve with a made-up name. Press **SIMULATE €8 & CLAIM**. This tells the organizer you did the pretend payment.
2. **Organizer** (Organizer screen, organizer code). Under **PAYMENT VERIFICATION**, select the guest's row and press **CONFIRM PAID**. Open **COMPLETED / TICKETS ISSUED**, select the row again and press **DOWNLOAD DEMO QR**.
3. **Door** (Door check-in screen, door code). Upload the QR image, or point the camera at it. You will see **CHECKED IN**. Try the same QR again to see **ALREADY CHECKED IN**.

The guest's screen updates by itself when the organizer decides, without reloading. The booking's link (the page address after reserving) reopens it after a reload or in a new tab.

## Where everything lives

| File | What it does |
| --- | --- |
| `app.py` | **The screens.** One function per screen: `page_tickets`, `page_door`, `page_organizer`, `page_privacy`. Screens show things and collect clicks; they never decide rules. |
| `logic.py` | **The rules.** Prices, capacity, the MEN cap, holds and deadlines, who may confirm a payment, single-use check-in, corrections, sign-in. Every action the screens offer is a function here. |
| `db.py` | **The storage.** Creates the tables in one SQLite file (`data/tubarao.db`) and reads/saves rows. |
| `tickets.py` | **The QR code.** Makes the secret ticket token, draws the QR image and reads QR photos. |
| `guest_list_pdf.py` | Draws the printable guest list. |
| `seed.py` | Resets the database with demo data and access codes. |
| `specs/` | One short spec (Why / What / Out of scope / Done when) per feature added after the port. |
| `tests/` | About 170 automated checks: one file per area, plus `test_app.py`, which opens the screens and presses buttons. |
| `AGENTS.md` | The rulebook for AI coding agents working in this folder. |

A button press travels like this: **`app.py` → a function in `logic.py` → `db.py`**. For example, **CONFIRM PAID** calls `logic.confirm_payment()`. That function checks that you are the organizer and that the booking was claimed in time. It then saves `PAID` through `db.py` and calls `logic.issue_ticket()`, which uses `tickets.py`.

## The life of a booking

```text
RESERVED ──guest claims──> PAYMENT_CLAIMED ──organizer confirms──> PAID ──door──> checked in
   │                            │
   └─ hold runs out → EXPIRED   ├─ organizer rejects → REJECTED
                                └─ review window ends → EXPIRED
```

- A **hold** (RESERVED) keeps a place for the event's reservation minutes (20 in the demo).
- A **claim** stops that timer and protects the place for the review window (24 hours in the demo).
- Only an organizer can make a booking **PAID**. A claim alone never lets anyone in.
- Each booking keeps the **price it was created with**, even if the price rises later.

## How it maps to the JavaScript version

| JavaScript app | Python version |
| --- | --- |
| `server/domain.js`, `validation.js`, `backend.js`, `events.js`, `checkin.js`, `admin-auth.js`, `reservation-deletion.js`, `category-correction.js`, `amount-adjustment.js`, `event-backup.js`, `ticket-delivery.js`, `admin-kpis.js` | `logic.py` |
| The Supabase tables and database functions in `supabase/migrations/` | `db.py` (tables) and `logic.py` (the rules those functions enforced, each run as one database transaction) |
| `server/tickets.js` | `tickets.py` |
| `server/guest-list-pdf.js` | `guest_list_pdf.py` |
| `index.html`, `checkout.html`, `checkout.js`, `app.js`, `privacy.html` | `page_tickets` and `page_privacy` in `app.py` |
| `admin.html`, `admin.js`, `admin-management.js`, `admin-attendees.js` | `page_organizer` in `app.py` |
| `checkin.html`, `checkin.js`, `checkin-presence.js` | `page_door` in `app.py` |
| `tests/*.test.cjs` | `tests/test_*.py` |

### What was ported

Everything in the classroom JavaScript app was ported:

- **Guests:** the follow step, AVAILABLE / FEW TICKETS LEFT / SOLD OUT (never exact numbers), EARLY/LATE prices with the optional countdown and late-price preview, the checkout with the category warning, the hold countdown, the simulated claim, and resuming a booking by re-entering the same details.
- **Organizer:**
  - access-code sign-in, KPIs and revenue
  - confirm, reject, and confirm-after-Revolut for reserved or expired bookings (with the capacity re-check)
  - demo QR issue, retry and download, amount adjustment with private history, category correction, and deleting records or duplicate paid tickets
  - event editing (capacity, MEN cap, prices, pricing mode, sales schedule), creating and activating events, and non-paying attendees
  - the CSV backup and the PDF guest list
- **Door:** QR check-in that works only once, name/email search with manual check-in (paid and non-paying guests), and live attendance refreshing every 5 seconds.

### What is different

- **Database.** The JavaScript copy needed a Supabase setup that the repository does not contain, so it could not run end to end. This version keeps everything in one SQLite file and works straight away. The safety rules the Supabase functions enforced now live in `logic.py`, and each runs inside one transaction. Two phones scanning the same ticket at once still cannot both let a guest in.
- **Staff sign-in lasts while the browser tab stays open.** Moving between screens keeps you signed in. Reloading the page asks for the code again, because Streamlit cannot set the secure cookie the original used. Sessions still end after 12 hours, and **LOG OUT** ends them straight away.
- **Finding a booking again.** The original remembered it in browser storage. Here the booking reference goes in the page address (`?booking=...`), so reloading or reopening that link brings the booking back. The link shows no name or email; to claim the payment from a reopened link, the guest types their email once.
- **The camera takes a photo** of the QR code instead of scanning continuously. You can also upload the QR image or paste its code, which is handy for testing on a laptop.
- **Smaller changes.** The landing page plays the original hero video (muted, looping, no controls); the other screens use the original logo unchanged. Fields named after email delivery were renamed, for example `ticket_sent_at` became `ticket_issued_at`. The PDF uses the DejaVu Sans font (included, with its licence in `assets/fonts/`).

### Kept as open decisions, as in the original

Refunds, editable FEW TICKETS LEFT thresholds and editing the Instagram handle are not built. The original product notes list them as future ideas, so they make good next features. Write a spec and tests for each one first.

## Added after the port

- **Remember a booking through its link:** `specs/remember-booking.md`
- **Hero video on the landing page:** `specs/hero-video.md`
- **Check in non-paying guests at the door:** `specs/non-paying-check-in.md`

## Settings

| Setting | What it is |
| --- | --- |
| `TUBARAO_ORGANIZER_CODE`, `TUBARAO_DOOR_CODE` | Access codes for `seed.py`. If unset, random codes are generated. On a hosted copy with an empty database, the app uses these to create the demo data on first start. |
| `TUBARAO_TICKET_SECRET` | The private key that signs QR tickets, at least 32 characters. If unset, one is created once in `data/ticket_secret.txt`. Keep it the same, or existing QR codes stop matching. |
| `TUBARAO_DB` | Where the database file lives (default `data/tubarao.db`). |

When the app is hosted (Block 3), put these in Streamlit's secrets instead of a file. The `data/` folder is never committed to Git.
