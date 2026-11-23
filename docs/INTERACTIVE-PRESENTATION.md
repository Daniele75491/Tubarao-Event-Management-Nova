# Tubarão live presentation

Run a short simulation called **One ticket, two arrivals**. Give the audience one question to answer at each handoff. Use the live website and repository as the two screens for the presentation. [2026 Team Project instructions](https://2477-introduction-programming.gitlab.io/wiki/team-project/)

## Get ready before class

- Open the [public demo](https://tubarao-event-management-nova-gjnjzm2wnuszqjv9ionfjb.streamlit.app/) in a guest window. Open organizer and door screens in two other browser sessions. Enter staff codes off the projector and keep them out of the repository.
- Confirm that one classroom event is active. Have a unique fictional name and an `@example.test` address ready. Ask the audience to make predictions aloud. Let the presenters operate the shared demo.
- Prepare a freshly seeded local copy in case the network or host fails. Use the [README](../README.md#run-the-app-on-your-computer). The local and hosted copies have independent data. Use the [demo walkthrough](DEMO-RUNBOOK.md) for backup guests and screen labels.
- Open `streamlit-app/app.py`, `logic.py`, `db.py`, and Simone’s [QA notes](QA-FINAL.md) in advance. Each teammate should be able to explain the whole flow.

## Live run of about eight minutes

| Time | Presenter | Show and say |
| --- | --- | --- |
| 0:00–1:15 | Daniele Bracciale | Ask, “If someone says they paid, should the door let them in?” Introduce the organizer’s problem. On **Tickets**, confirm the demo follow step, choose a ticket, enter fictional details and press **RESERVE MY SPOT**. Point out the amount and the reservation timer. |
| 1:15–3:00 | Afonso Catarino | On the guest screen, press **SIMULATE … & CLAIM**. Point out that this only requests a review. On **Organizer**, select the exact booking in **TO REVIEW**, press **CONFIRM PAID**, open **COMPLETED / TICKETS ISSUED**, then download the QR. Explain that the QR is an opaque code, meaning it carries no readable guest details. |
| 3:00–5:00 | Francesco Vitale | On **Door check-in**, scan or upload the QR. Ask the audience to predict what happens if the guest comes back. Choose **SCAN NEXT** and use the same QR again. Show **ALREADY CHECKED IN**. Find a seeded non-paying guest by name, admit them once, and show how **LIVE ATTENDANCE** changes. Use the checked release UI and adapt the labels only after reviewing the UX PR. |
| 5:00–8:00 | Simone Cassibba | Return to **Organizer** and refresh to show paid bookings, check-ins and simulated revenue. Open the code and trace one check-in from the screen to the database. Show one workflow test and one rejected or concurrent check. End by stating what was tested and what remains a demo limit. |

If the room is short on time, skip the optional non-paying admission and move straight from duplicate rejection to the dashboard and code.

## What the team can explain

The screens collect input and display the result. The rules decide what is allowed, and the database saves the result so the next device sees the same booking.

| Question | Answer to practise |
| --- | --- |
| Where does a booking go? | `app.py` handles the Streamlit screen. `logic.py` validates the input and applies booking, pricing, and staff rules. `db.py` reads and writes SQLite. SQLite stores the demo in one local file. |
| Why does making a claim leave the guest outside? | A claim moves the booking to `PAYMENT_CLAIMED`. Only an organizer can move it to `PAID` and issue the demo ticket. There is no real payment transfer or outgoing email. |
| Why do two scans admit a guest only once? | The door signs in with a staff code. The app checks the ticket against the active event and saves the check-in inside a database transaction, which groups the check and its update. A second attempt sees the first arrival. |
| What if two guests want the last place? | A SQLite write transaction keeps the capacity calculation and insertion together. The concurrency tests check that only one booking succeeds. |
| What is stored from the QR? | The app signs booking and event identifiers to make a token. The database keeps a hash, a one-way fingerprint of the token. It does not store the QR text or include the guest’s name or email in it. |
| What was verified and what could still go wrong? | The locked tests and synthetic smoke test cover successful and rejected paths, including concurrency and staff access. Rehearse the real camera and deployed browser separately. A direct late claim can delay the stored expiry update, and the suite marks the inactive-event claim bug as an expected failure. Keep one event active during the demo. |
| What happens when the host restarts? | The hosted SQLite file may be lost. The local practice copy can be started with synthetic data, and any change to durable hosted storage would be a future project decision. |

For the architecture in more detail, use the [code walkthrough](CODE-WALKTHROUGH.md). The [test report](FINAL-RELEASE-REPORT.md) explains the exact local checks and the public Cloud check.

## Backup plan

1. If the camera is blocked, upload the downloaded PNG. If upload is unavailable, paste the QR text or use **FIND BY NAME**. Show the stored arrival and duplicate rejection where the chosen path supports it.
2. If the booking is interrupted or times out, use an unclaimed rehearsal identity for a new booking, an existing synthetic payment claim, or an unadmitted seeded ticket. Check the current states against the [demo walkthrough](DEMO-RUNBOOK.md).
3. If Cloud is unavailable, open the prepared local app and repeat the same sequence. Explain the switch to the teaching staff. The live deployed URL is still the primary presentation target.
4. For the code walkthrough, keep the verified checkout and locked test output open locally. Never reset the shared hosted database during the presentation.

## Release checklist when Francesco's PR arrives

- [ ] Open the actual diff against current `main`. Check mobile and desktop screens, the checkout and staff routes, and any configuration or dependencies.
- [ ] Check for conflicts and unintended changes to pricing, capacity, guest access, payment states, or check-in. Confirm only Francesco's intended changes would enter the release. Leave PRs #2, #3, and #4 out.
- [ ] Test the exact merged candidate in isolation using Python 3.12 and `uv run --locked --python 3.12 python -m pytest -q -r a` from `streamlit-app/`. Record the commit and test counts. Rehearse the complete workflow on a disposable SQLite database.
- [ ] Have the team merge Francesco's PR only if the diff and checks are safe. Record the resulting `main` SHA and confirm it is the tested release or repeat the checks on it.
- [ ] Confirm Streamlit is deploying from final `main`. In a signed-out window, open the homepage and verify the classroom event, ticket categories, and staff gates without writing shared data.
- [ ] Confirm the GitHub repository, README, and Python code on `main` open without signing in. Check that the README includes all four names and student numbers, the working live demo URL, and local start and test commands.
- [ ] Have **one** teammate paste the [GitHub repository URL](https://github.com/Daniele75491/Tubarao-Event-Management-Nova) into the Moodle online text field for [Group Project – Git Repository Submission](https://moodle.novasbe.pt/mod/assign/view.php?id=76556) by **November 23, 2026, 23:59 Lisbon time**.
- [ ] Confirm Moodle shows the submitted URL and a successful submission status. Save the confirmation and timestamp for the team.
