# Tubarão Nova final release report

**Recommendation — READY WITH LIMITATIONS.** The tested release ran locally and completed the classroom demo from booking to check-in. The team can present the single-event demo using synthetic data. The deployed URL still needs an automated availability check before relying on it for the presentation.

## What was tested

The release was tested from a separate checkout so the team's working branch could stay intact.

| Item | Result |
| --- | --- |
| Date | November 23, 2026, Lisbon time |
| Repository | `Daniele75491/Tubarao-Event-Management-Nova` |
| Exact GitHub `main` commit | `3dd9f291903691b1f82914adb003849bab12dbf4` |
| PRs included | PR #1 (`21dd584b113ae6e0f3533916d97dc5b6f652c277`) and PR #5 (`25b2fd21bfd6391e8c113518a336d5164a23dbc4`). Both were verified as merged and as ancestors of the tested commit. |
| Environment | Windows, CPython 3.12.10, uv 0.12.10. A fresh virtual environment installed from the committed `uv.lock` without overrides. |
| Application files | `streamlit-app/app.py`, `streamlit-app/pyproject.toml`, `streamlit-app/uv.lock`, and `streamlit-app/.streamlit/config.toml` were present. |
| Test data | New disposable SQLite files and synthetic accounts and guests. |

## Automated test results

The full suite, including Simone's QA tests, checks that the rules still work as the app moves from one step to the next. It also checks what happens when several guests or door staff act at the same time.

| Passed | Failed | Skipped | Expected failures | Unexpected passes | Duration |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 273 | 0 | 0 | 1 | 0 | 102.11 seconds |

Run from the repository root to repeat the locked check:

```powershell
cd streamlit-app
uv run --locked --python 3.12 python -m pytest -q -r a
```

The suite covered booking validation, overall capacity and the MEN cap, early and late pricing, simulated claims, organizer confirmation and rejection, QR generation and decoding, duplicate check-in, non-paying admission, staff roles and session expiry and revocation, event management, booking and database persistence, safe initialization, exports, and concurrent bookings and check-ins. The expected failure was `test_a_booking_of_an_event_that_is_no_longer_active_cannot_be_claimed`.

## Automated demo walkthrough

Streamlit AppTest runs the application's screens in Python. The walkthrough used AppTest for the guest and staff screens, and application-level calls for operations such as generating exports.

| Step | Result |
| --- | --- |
| Start on a new database | Created both demo staff roles and an active demo event. Repeating setup preserved existing rows. |
| Book and claim | A fictional guest reserved a place and made a simulated payment claim on the guest screen. The expected status was stored after each step. |
| Confirm and issue a QR | Signed in as `SUPER_ADMIN`, confirmed the claim, generated the QR PNG, decoded it, and matched it to the issued ticket. The code contained no guest details or plaintext booking or event ID. |
| Admit the paid guest | Signed in separately as `ADMIN` and pasted the decoded QR text into the door screen. The first attempt admitted the guest. The second displayed `ALREADY CHECKED IN`. |
| Admit a non-paying guest | Used the door's name search and check-in button. Live attendance increased by two across the paid and non-paying admissions, and the screen and database agreed. |
| Export the lists | Parsed the backup CSV and confirmed the paid guest's details, status, and check-in. Generated a PDF from the names-only guest list and checked its file signature and end marker. Attendance stayed unchanged. |
| Enforce staff roles | Tested anonymous and revoked-session denial across all 23 operations that use the shared role check. The door role was refused for all 18 organizer-only operations. The full suite also covered session expiry. |
| Launch the real entry point | Started `streamlit-app/app.py` from the repository root. The local health endpoint and page shell returned HTTP 200. The test server was stopped afterward. |

Real camera capture, browser uploads and downloads, browser layout, and the rendered PDF layout were outside these automated checks. QR decoding was verified from generated image bytes.

## Security and regression findings

The demo uses SQLite and simulated payments. The checks examined the tested release and exercised the staff permissions with made-up data.

- **Critical:** No critical issue was found in the tested single-event workflow.
- **Major — Claims can still be made for inactive events.** After switching events, a guest can claim an old booking, but the organizer is blocked from confirming it. This is the expected failure in the suite and was reproduced separately. Keep one event active throughout the presentation. Fix the claim rule before using the demo across event switches.
- **Minor — A direct late claim delays the stored expiry update.** The application correctly refuses the claim, but the row stays `RESERVED` until a booking read saves `EXPIRED`. Correct that transaction in a later fix.
- **Stable booking IDs and safe setup passed.** Selection tests covered reordering and removal of bookings. Setup tests covered invalid configuration, an injected failure, and preservation of pre-existing data on failed setup. No shared or deployed database was reset.
- The scan of 147 tracked paths found no recognizable production credentials, production database or Vercel endpoints, real payment links, private map links, guest data files, or non-fixture email addresses. The seven Python runtime modules showed no payment, email, or production database client integration. No production service was accessed.

## Cloud availability and presentation readiness

The Cloud dashboard shows that this app runs from the university repository's `main` branch at `streamlit-app/app.py`. Startup logs showed that Streamlit used the committed `uv.lock` and started the server. The Cloud logs did not identify the exact running commit.

The hosted classroom event and ticket categories rendered in an authorized browser, and the runtime health check returned `ok`. The organizer and door pages both required an app access code. A fresh anonymous session was redirected to Streamlit authorization in the access check before the public release.

Keep one event active throughout the presentation. Have the verified local demo available as a fallback. If the camera fails, door staff can use name search or paste the decoded ticket text.
