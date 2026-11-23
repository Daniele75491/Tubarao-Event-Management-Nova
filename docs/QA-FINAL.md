# QA report · Python + Streamlit version

23 November 2026 · Simone, QA and demo validation · branch `simo-qa-demo`

This report says what was tested in the Python version of Tubarão, what passed, what is broken and what nobody has checked yet. It is written so that any teammate can repeat every check.

**Short answer: the app is ready to demo.** The complete booking-to-door workflow worked by hand and in automated tests. One real bug was found (QA-BUG-1, medium). It does not block the demo if you follow the [demo runbook](DEMO-RUNBOOK.md).

## What was tested

| Item | Value |
| --- | --- |
| Code under test | Branch `python-streamlit` (PR #1) at commit `21dd584b113ae6e0f3533916d97dc5b6f652c277`, "Fix review findings: expiry, safe setup, sessions, ID selection, QR scanning, Windows docs" |
| Why that commit | It was the latest PR #1 commit on GitHub on 23 November. The tests were written against the previous commit (`d925261`) and then rerun on `21dd584` with no changes needed. **If Afonso pushes again, rerun the tests on the new code.** |
| Folder | `streamlit-app/` |
| Computer | macOS (Apple Silicon), Python 3.14.0, SQLite 3.50.4, Streamlit 1.67.0, uv 0.13.9 |
| Dependencies | Installed exactly from `uv.lock` with `uv sync --locked`. Nothing was upgraded or overridden. |
| Data | Only made-up people with `@example.test` emails, in temporary databases. The production website and its services were never contacted. |

## Automated test results

All commands run inside `streamlit-app/`.

| Command | Result |
| --- | --- |
| `uv run --locked pytest` without the QA files | **229 passed**, 0 failed, 0 warnings |
| `uv run --locked pytest` (with the new tests) | **273 passed, 1 xfailed**, 0 failed, 0 warnings, about 50 s |
| `uv run --locked pytest tests/test_qa_workflow.py tests/test_qa_rules.py tests/test_qa_concurrency.py` | **44 passed, 1 xfailed** |
| `uv run --locked pytest tests/test_qa_concurrency.py`, run 3 times in a row | 5 passed each time (no flaky results) |

"xfailed" means "expected to fail". That one test describes the correct behaviour for QA-BUG-1, which the app does not have yet. It is marked `xfail(strict=True)`. When Afonso fixes the bug, pytest will report it as XPASS and the run will fail on purpose, so nobody forgets to remove the mark.

No existing test was changed, skipped or deleted. No application file was changed by this QA work.

### Do the new tests really catch mistakes?

A test that never fails proves nothing. To check this, I broke the app on purpose, in memory only, and ran the new tests against each broken version:

| Deliberate mistake | New tests that went red |
| --- | --- |
| Remove the database lock in `db.transaction` | 6 |
| Let a ticket be used twice (ignore `checked_in_at`) | 3 |
| Treat door staff like the organizer in `require_role` | 1 |
| Ignore capacity in `logic.occupancy` | 4 |

Every mistake was caught. The patches were applied only while those test runs were happening; no file was edited.

## New test files

| File | What it checks |
| --- | --- |
| `tests/test_qa_workflow.py` | The whole demo on a **real database file**. Each step closes the database and opens it again, like a new browser or phone would. This covers reservation, claim, organizer confirmation, QR download and scan, single use, live attendance, dashboard, CSV and guest list, plus persistence after reopening. |
| `tests/test_qa_rules.py` | Business rules and edge cases that the original tests did not cover, listed scenario by scenario below. |
| `tests/test_qa_concurrency.py` | Several people acting **at the same moment**: 8 threads, each with its own connection to the same file. |
| `tests/qa_support.py` | Helpers only: creates a demo database file with fake staff codes. |

### Scenario coverage

Letters follow the QA assignment. "Existing" means the original suite already covered it and I only added what was missing.

| | Scenario | Where it is tested |
| --- | --- | --- |
| A | Valid reservation | `test_one_ticket_goes_from_booking_to_the_door…` (price EARLY €8, status RESERVED) + existing |
| B | Refused when the event is full | `test_every_kind_of_place_counts_until_the_event_is_full` (non-paying + paid + claim + hold together), `test_the_last_place_can_be_taken_but_not_one_more`, `test_a_full_event_also_refuses_external_confirmation…`, race test with 8 guests |
| C | Category (MEN) limit | `test_men_holds_and_claims_use_the_men_cap…` (holds and claims count, an expired hold frees the place), `test_moving_a_paid_ticket_into_men_counts_live_men_holds`, MEN race test |
| D | Simulated payment claim | workflow test (new connection, guest view) + existing |
| E | Invalid claims refused | another guest's booking, unknown or bad references (`None`, `42`, empty string, unknown UUID), already REJECTED, already PAID; **QA-BUG-1** (xfail) |
| F | Organizer confirms | workflow test using a real signed-in session; `test_the_confirming_organizer_is_recorded` |
| G | Others cannot confirm | door staff refused for 12 organizer actions (reject, external confirm, retry ticket, QR download, amount, category, deletions, guest list, events); nobody signed in; made-up account; deactivated organizer |
| H | Valid QR ticket | QR image is decoded back with the real scanner code; only `TUBARAO:` + 43 characters; database holds only the SHA-256 hash, never the token; two tickets never share a QR |
| I, J | One check-in, repeat refused | workflow test (two connections); 8 door phones scanning the same QR at once → exactly one CHECKED_IN |
| K | Non-paying guest admitted once | workflow test; 4 phones at once → exactly one CHECKED_IN |
| L | Attendance totals agree | `test_live_attendance_and_the_dashboard_tell_the_same_story`: paid arrivals + non-paying arrivals = live total; revenue only from PAID; no emails or IDs in live attendance |
| M | Data survives reopening | booking keeps status, deadline, price (even after the organizer switches to LATE); QR and check-in survive; same details resume one booking; logout survives reopening |
| N | Exports | CSV has no IDs, QR hashes, access codes, salts or session hashes; downloading changes nothing in the database; guest list only has PAID + non-paying people, first and last name only |
| O | Invalid tickets refused | by-name check-in refused for RESERVED, PAYMENT_CLAIMED, REJECTED, expired hold, expired claim; QR signed with another secret; paid ticket of a previous event; deactivated door account |

## Manual demo results

The app was run with `streamlit run app.py` against a throwaway database seeded by `seed.py`, and clicked through in a browser. This was done on commit `d925261`, before Afonso's review fixes. The fixes change no step of this walkthrough, and the screen tests in `test_app.py` pass on `21dd584`, but the click-through was not repeated on that commit.

| # | Step | Result |
| --- | --- | --- |
| 1 | Open the landing page | ✅ Hero video, event name, EARLY €8 with countdown |
| 2 | Select an event | ✅ with a note: guests never pick an event. The page always shows the single **active** event. The organizer chooses which one is active. |
| 3 | Reserve (Alex Walkthrough, WOMEN) | ✅ "YOUR SPOT IS RESERVED", 20-minute countdown, `?booking=` added to the address |
| 4 | SIMULATE €8 & CLAIM | ✅ "DEMO PAYMENT CLAIMED" (see QA-2 for a wording problem) |
| 5 | Organizer sign-in | ✅ |
| 6 | CONFIRM PAID | ✅ The row moved to COMPLETED / TICKETS ISSUED |
| 7 | QR ticket | ✅ "TICKET ISSUED" and the DOWNLOAD DEMO QR button appeared. The same QR was produced with `logic.ticket_qr` (the function behind the button), because the test browser could not save and re-upload files. |
| 8 | Door sign-in | ✅ The camera was blocked in the test browser, as expected |
| 9 | Admit the guest | ✅ "CHECKED IN · Alex Walkthrough · WOMEN" using **paste the ticket code** |
| 10 | Same code again | ✅ "ALREADY CHECKED IN · First check-in at 13:18" |
| 11 | Dashboard | ✅ Paid 3→4, revenue €24→€32, "paid checked in" 1→2. Live attendance 3 = 2 paid + 1 resident. |
| 12 | Guest list export | ✅ CSV and PDF built with the same functions as the buttons. The PDF lists 8 guests (PAID + non-paying), sorted by last name, with no emails. |
| + | Non-paying guest | ✅ FIND BY NAME "Rui" → NON-PAYING → CHECK IN → live total 3, MEN 1. The row then shows "CHECKED IN 13:19" and no button. |

## Bugs and findings

Severity scale: **High** = breaks the demo or a core rule. **Medium** = a rule is wrong in a less common case. **Low** = confusing or cosmetic. **Info** = worth knowing, not a bug.

### QA-BUG-1 · Medium · A booking of an old event can still be claimed but never confirmed

`logic.claim_payment` does not check that the booking belongs to the **active** event. Every organizer action does check it (`_current_event_row` raises `EVENT_CHANGED`).

Steps to reproduce (automated as `test_a_booking_of_an_event_that_is_no_longer_active_cannot_be_claimed`):

1. With event A active, a guest reserves.
2. The organizer creates event B and activates it.
3. The guest opens their booking link and presses SIMULATE & CLAIM.

- **Expected:** the claim is refused.
- **Actual:** the booking becomes PAYMENT_CLAIMED and the guest sees "awaiting admin review". The organizer cannot confirm it (`EVENT_CHANGED`) and does not see it in the dashboard, which only lists the active event. It stays stuck until the review window expires.

The money side is safe: no ticket can be issued for the old event (`test_after_switching_events_an_old_claim_cannot_be_confirmed`).

Suggested owner: Afonso (application logic). A small fix is to compare `row["event_id"]` with `current_event(conn)["id"]` inside `claim_payment`. Not changed here, by design.

### QA-2 · Low · The guest screen mentions email that is never sent

`app.py` line 463 tells guests who claimed: "Can't find your ticket later? Check your spam or junk folder too." The classroom app sends no email. This could confuse the audience during the demo. Suggest removing the line.

### QA-3 · Low · Organizer buttons are cut off on a laptop screen

At about 1024 px wide, the action buttons show "DOWNLOAD …", "RE-ISSUE (sa…" and "ADJUST AMO…". They still work. Suggest shorter labels or a wider layout for the selected-row panel (`reservation_actions` in `app.py`).

### QA-4 · Low · "Paid checked in" sits under the MEN CAP card

In `kpi_panel` (`app.py`), the MEN CAP card's small text shows "N paid checked in", which is unrelated to the MEN cap. People reading the dashboard may think it is the number of men inside. Suggest giving it its own card.

### QA-5 · Info · The backup CSV lists every booking, not only valid tickets

`event_backup_csv` writes every reservation of the event, including REJECTED, EXPIRED and still-RESERVED ones. All of them have Type `PAID`. Since `21dd584`, holds that ran out are saved as EXPIRED before the file is written, so the Status column is correct. Times are UTC in ISO format. The file name starts with `Tubarao_Tubarao_` when the event name contains "Tubarão".

This copies the original JavaScript version exactly (`server/event-backup.js` on `main`), so it was **not** treated as a bug. At the door, filter the Status column to `PAID`. Use the PDF guest list for a clean list of who may enter.

### QA-6 · Info · Reseeding while the app is running

`seed.py` now asks before replacing `data/tubarao.db` and builds the new file separately, so a failure keeps the old data. A running Streamlit app still keeps its connection to the old file, though. **Always stop the app (Ctrl+C) before running `seed.py`, then start it again.** The runbook includes this.

### QA-7 · Info · Door staff can download the live attendance table

Streamlit adds a "Download as CSV" button to every table. On the door screen, that table only holds names, category, type and arrival time (no emails), so no rule is broken. It is still worth knowing.

## Known limitations (by design, documented in the README)

- Reloading a staff page signs the person out. The session lives in the browser tab, not in a cookie. The 12-hour limit and LOG OUT still work.
- The camera takes a **photo** of the QR; it does not scan continuously. Upload and paste are alternatives.
- One SQLite file on one computer. The concurrency tests prove that threads on one machine cannot overbook or double-admit. They say nothing about several servers sharing a database.
- Refunds, editable FEW TICKETS LEFT thresholds and editing the Instagram handle are not built. They are open decisions.

## Verification gaps (not tested)

| Gap | Why | What to do |
| --- | --- | --- |
| Real phone camera scan | The test browser blocks the camera | Before the presentation, scan a downloaded QR with a phone on the **deployed** app |
| The deployed app | Deployment belongs to another teammate and was out of scope | Run the [runbook](DEMO-RUNBOOK.md) on the public URL |
| Data on the hosting service | The app saves to a local SQLite file. Whether that file survives a restart depends on the host. | Restart the deployed app once and check that bookings are still there |
| PDF text content in tests | No PDF reader is in the locked dependencies, so tests check the guest-list data, not the PDF text | The manual check confirmed the PDF content |
| Phone-sized layout, other browsers | Not clicked through | Open the public URL on a phone before the demo |
| Manual click-through on `21dd584` | Done on `d925261`, before the review fixes | Rehearse the runbook once on the final code |
| PR #1 changes after `21dd584` | Not yet written when this report was made | Rerun `uv run pytest` after pulling |

## Demo readiness

| Course criterion | Status |
| --- | --- |
| It works | ✅ Every workflow in the runbook works locally. ⚠️ Not yet checked on the deployed URL. |
| User interface | ✅ Clear results and errors. ⚠️ QA-2, QA-3 and QA-4 are small fixes worth making. |
| Scope and ambition | ✅ Many integrated features: pricing, capacity, roles, QR, door, exports |
| Verification | ✅ 273 tests, including rejected actions, edge cases, persistence and concurrency, all passing. Remember: the course wants them passing **on main**. |
| Security | ✅ Roles and sessions are checked against the database on every action; codes and tokens are stored only as hashes; dependencies are pinned in `uv.lock`; `data/` and secrets are git-ignored |
| Walkthrough | See [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md) for likely questions and answers |
