# Demo runbook · Python + Streamlit version

Use this script to show Tubarão live, from a guest's booking to the door. Any teammate should be able to follow it, even without reading the code. Every step was tested on 23 November 2026 (see [QA-FINAL.md](QA-FINAL.md)).

The course requires the demo to run **live at the deployed URL**; slides or videos do not count. Rehearse it once on the deployed app before presenting.

## Before you start

| What | Detail |
| --- | --- |
| The app | The deployed URL, or locally: in `streamlit-app/`, run `uv run streamlit run app.py` and open http://localhost:8501 |
| Organizer code (`SUPER_ADMIN`) | From whoever ran `seed.py`, or the hosting secret `TUBARAO_ORGANIZER_CODE`. Never show it on screen. |
| Door code (`ADMIN`) | `TUBARAO_DOOR_CODE`, same rule |
| Second device (optional) | A phone, to scan the QR with a real camera |
| Data | Only the made-up demo data from `seed.py`. Use `@example.test` emails. |

**Screens.** The left sidebar has four pages: **Tickets** (`/`), **Door check-in** (`/checkin`), **Organizer** (`/admin`) and **Privacy notice** (`/privacy`).

**Staff sign-in.** Moving between pages with the **sidebar keeps you signed in**. Reloading the page or typing an address signs you out, which is how the app works. The organizer code also works on the door screen, so one presenter can do every step.

**The 20-minute timer.** A reservation is held for 20 minutes. Make the live reservation **during** the demo, not before.

### What the demo database contains

`seed.py` creates one active event, **Tubarão Classroom Demo** (capacity 30, MEN cap 12, early price €8, late price €12), and one older inactive event.

| Person | State | Useful for |
| --- | --- | --- |
| Ana Demo (WOMEN) | PAID, already checked in | Shows ALREADY CHECKED IN |
| Bruno Demo (MEN), Carla Demo (WOMEN) | PAID, ticket issued, not inside yet | **Backup tickets** if the live booking fails |
| Diogo Demo (MEN), Eva Demo (WOMEN) | PAYMENT_CLAIMED | **Backup claims** to confirm |
| Filipa Demo | RESERVED (her hold runs out 20 min after seeding) | Shows the timer |
| Gonçalo Demo | EXPIRED | Shows an expired hold |
| Helena Demo | REJECTED | Shows a rejected claim |
| Rui Resident, Tiago Resident, Duarte Invited (MEN), Marta Resident (WOMEN) | Non-paying | Door check-in without a QR |

## The demo, step by step

| # | Who | Do this | You should see |
| --- | --- | --- | --- |
| 1 | Guest | Open **Tickets**. | Hero video, **TUBARÃO CLASSROOM DEMO**, date, EARLY €8 with a countdown, WOMEN and MEN shown as AVAILABLE (never exact numbers). |
| 2 | Guest | Tick **I follow @casitatubarao**. | The tickets unlock. Say: "There is only one live event; the organizer chooses which one." |
| 3 | Guest | On **WOMEN TICKET**, press **GET TICKET →**. Enter `Alex`, `Walkthrough`, `alex.walkthrough@example.test`. Tick **I confirm that I want a WOMEN ticket.** Press **RESERVE MY SPOT**. | **YOUR SPOT IS RESERVED**, WOMEN · €8, the “What's next?” prompt to simulate payment, a countdown from 20:00, and `?booking=…` in the address. |
| 4 | Guest | Press **SIMULATE €8 & CLAIM**. | **DEMO PAYMENT CLAIMED** – awaiting admin review. Say: "No money moves; this is only a claim, not a ticket." |
| 5 | Organizer | Sidebar → **Organizer**. Enter the organizer code and press **ENTER**. | **TUBARÃO · ADMIN**, the KPI cards and PAYMENT VERIFICATION. Write down PAID ATTENDEES and REVENUE. |
| 6 | Organizer | In **TO REVIEW**, tick Alex's row, then press **CONFIRM PAID**. | Alex leaves TO REVIEW. **COMPLETED / TICKETS ISSUED** goes up by one. |
| 7 | Organizer | Open **COMPLETED / TICKETS ISSUED**, tick Alex's row, then press **DOWNLOAD DEMO QR** (it may be shown as "DOWNLOAD …"). | **TICKET ISSUED**. A `tubarao-ticket-Walkthrough.png` file downloads. Say: "The QR holds only a random code; the database stores only its fingerprint." |
| 8 | Door | Sidebar → **Door check-in**, or press **CHECK-IN** on the organizer screen. | **TUBARÃO · CHECK-IN**, with SCAN QR and FIND BY NAME tabs. |
| 9 | Door | Scan the QR with the camera, **or** upload the PNG under "…or upload a photo or screenshot of the QR". | **CHECKED IN · Alex Walkthrough · WOMEN**. LIVE ATTENDANCE goes up by one. |
| 10 | Door | Press **SCAN NEXT** and use the same QR again. | **ALREADY CHECKED IN** with the time of the first check-in. Nobody gets in twice. |
| 11 | Door | **FIND BY NAME** → type `Rui`. **Rui Resident · MEN · NON-PAYING** appears. Press **CHECK IN**. | **CHECKED IN · Rui Resident**. The row now shows "CHECKED IN hh:mm" and no button. Total inside +1, MEN +1. |
| 12 | Organizer | Sidebar → **Organizer** (still signed in), then **REFRESH**. | PAID ATTENDEES +1, REVENUE +€8.00, Live attendance includes Alex and Rui. Admitting Rui adds no revenue. |
| 13 | Organizer | Scroll to **DOWNLOADS** and press **DOWNLOAD GUEST LIST (PDF)**, and optionally **DOWNLOAD EVENT BACKUP (CSV)**. | The PDF lists PAID + non-paying guests, sorted by last name, with no emails. The CSV has one row per booking (filter Status = `PAID` for valid tickets). |

On a disposable local demo, open **PROMO CODES** in Organizer and create a 20% discount. Book an €8 ticket with that code and check that the simulated claim shows €6.40. Confirm it and inspect the dashboard charts. Open **STAFF ACCESS** to demonstrate managing a disposable door account.

Good extra moments if you have time:
- On the door, **FIND BY NAME → Diogo** shows a claimed booking with no check-in button. Only PAID tickets get in.
- Reopen the guest's `?booking=` link in a new tab: the booking comes back with no name or email shown.

## If something goes wrong

| Problem | Do this |
| --- | --- |
| **The camera does not work** (no permission, laptop, projector) | Use **…or upload a photo or screenshot of the QR** with the downloaded PNG. Or open the QR on a phone and photograph it with the laptop camera. Or use **FIND BY NAME** → `Walkthrough` → **CHECK IN**, which follows the same single-use rule. |
| Upload is not possible either | Use **…or paste the ticket code**. The code is the text inside the QR, `TUBARAO:` followed by 43 characters; any QR reader app on a phone can show it. |
| The live reservation fails or the 20 minutes ran out | Use the backups: confirm **Diogo** or **Eva** (already claimed) in step 6. Or download the QR of **Bruno** or **Carla** (already paid) in step 7. |
| "Enter your access code" appears again | You reloaded or typed an address. Sign in again and move with the **sidebar**. |
| "INVALID ACCESS CODE" | Check you are using the right code for the right screen. Both codes work on the door; only the organizer code works on the dashboard. |
| "Men tickets are sold out" / "This event is sold out" | Use a WOMEN ticket, or in **EDIT EVENT** raise the capacity. It cannot be set below places already taken. |
| "This email already has a reservation…" | That email already has a live booking. Use a new made-up email such as `alex2@example.test`. |
| DOWNLOAD DEMO QR is missing and RETRY TICKET is shown | Press **RETRY TICKET**. It makes the same QR again. |
| The dashboard numbers did not change | Press **REFRESH** on the organizer screen. |

## Reset the demo safely

Resetting **deletes every booking** in the demo database. Never do it against data you want to keep.

Locally, in `streamlit-app/`:

1. Stop the app with **Ctrl+C** in its terminal. Do not reseed while it is running (see QA-6 in the QA report).
2. Optionally choose the codes, so you know them in advance:

   ```bash
   export TUBARAO_ORGANIZER_CODE=pick-a-new-code TUBARAO_DOOR_CODE=pick-another-code
   ```

   Each code needs at least 8 characters, and the two must be different.

3. Reset and start again:

   ```bash
   uv run python seed.py
   ```

   It asks before replacing the database: type `y` and press Enter. If anything fails, the old data is kept.

   ```bash
   uv run streamlit run app.py
   ```

4. The codes are printed and saved in `data/ACCESS_CODES.txt`. That folder is never committed.

Keep `data/ticket_secret.txt` (or `TUBARAO_TICKET_SECRET`) unchanged. Changing it makes already issued QR codes stop matching.

On the **deployed** app, the person who owns deployment decides how to reset. The app creates the demo data by itself only when it starts with an empty database **and** both access codes are set as hosting secrets (`bootstrap()` in `app.py`).

## Checklist for the day

- [ ] Deployed URL opens and shows the event
- [ ] Organizer and door codes tested on the deployed app
- [ ] One full rehearsal on the deployed app, including a real phone scan
- [ ] Backup guests (Diogo, Eva, Bruno, Carla) are in the expected states
- [ ] `uv run pytest` is green on `main`
