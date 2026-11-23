# Tubarão · event tickets and door check-in

**Nova SBE · Introduction to Programming · group project**

Tubarão is a web app for running a small paid event, such as a student party. Guests hold a place and claim that they paid, the organizer checks each payment and issues a QR ticket, and door staff scan tickets so each one gets in only once.

The app is written in **Python with Streamlit** and lives in the [`streamlit-app/`](streamlit-app/) folder. That folder is the project we are submitting. The rest of the repository is the original JavaScript version our teammate built before the course. We kept it for reference and ported all of its features to Python.

This is a classroom copy: use made-up names and `@example.test` emails. Payments are pretend, and the app sends no emails.

## Objectives

1. **Solve a real problem.** Small events often run on spreadsheets, bank-transfer screenshots and a printed list at the door. Tubarão puts holds, payment checks, tickets and check-in in one place, so nobody is let in twice and the event never sells more places than it has.
2. **Apply the course.** The app follows the course structure: `app.py` shows the screens, `logic.py` holds every rule, and `db.py` stores the data in SQLite. Each feature started as a short spec, then tests, then code, and was shared as a pull request.
3. **Be safe to use.** Staff sign in with access codes, every staff action is checked against the database, tickets can't be forged, and anything a guest types is shown as plain text (see [Security](#security)).
4. **Be easy to check.** About 340 automated tests cover the rules and click through the screens, so anyone can confirm the app works with one command.

## What it does

- **Guests:** see whether tickets are AVAILABLE, FEW TICKETS LEFT or SOLD OUT, pick a ticket (EARLY or LATE price, optional promo code), hold a place for a few minutes, and press a button to claim they paid. Their screen updates by itself when the organizer decides.
- **Organizer:** a dashboard with sales figures and charts, payment review (confirm or reject), demo QR tickets, amount and category corrections, event settings, promo codes, staff access codes, a CSV backup and a printable PDF guest list.
- **Door staff:** scan a QR code with the camera or an uploaded photo, or find a guest by name, and see live attendance. Each ticket works once.

## Installation

You need **[uv](https://docs.astral.sh/uv/)**, the tool used in the course. It installs the right Python (3.11 or newer) and every package for you.

**Windows (PowerShell):**

```
winget install --id=astral-sh.uv -e
```

**macOS or Linux:**

```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close and reopen the terminal, then get the code:

```
git clone https://github.com/Daniele75491/Tubarao-Event-Management-Nova.git
cd Tubarao-Event-Management-Nova/streamlit-app
```

(The repository is private, so your GitHub account needs access. With the GitHub CLI you can also run `gh repo clone Daniele75491/Tubarao-Event-Management-Nova`.)

## How to run the application

From the `streamlit-app` folder:

```
uv run python seed.py
uv run streamlit run app.py
```

1. `seed.py` creates a demo database with an event and made-up guests. It prints two **access codes**, one for the organizer and one for the door, and also saves them in `data/ACCESS_CODES.txt`.
2. `streamlit run` opens the app in your browser at `http://localhost:8501`.
3. Use the menu on the left to switch screens: **Tickets** (guests), **Organizer** and **Door check-in**. The staff screens ask for an access code.

The first run takes a minute or two while uv downloads Python and the packages. Later runs start in seconds. To start again from a clean demo, stop the app and run `uv run python seed.py` again.

To try one ticket from booking to the door, follow the walkthrough in [`streamlit-app/README.md`](streamlit-app/README.md#follow-one-ticket-from-booking-to-the-door).

### Run the tests

```
uv run pytest
```

This runs every check, including screen tests that open each page and press its buttons. All of them should pass.

## Security

The question we asked: can anyone get into an account, or act as staff, without the right code? What the app does about it:

- **Access codes are never stored.** Only a salted scrypt hash is kept, like a password. New codes need at least 10 characters, and the codes `seed.py` generates have 16 random characters.
- **Guessing is limited.** After 5 wrong codes within 15 minutes, the sign-in form refuses that visitor, even with the right code, for 15 minutes.
- **Sessions are checked on every action.** A sign-in creates a random session token, stored only as a hash. Every staff action in `logic.py` re-checks that the session is still valid, not logged out or expired (12 hours), and that the account is still active and has the right role. Door staff can't use organizer actions.
- **Tickets can't be forged.** A QR code holds only a signed random token, and the database keeps only its hash. A ticket works once, and only if the organizer confirmed the payment.
- **Guests can't inject content.** Names and emails are shown as plain text everywhere, so a name like `[click here](https://evil.example)` can't put a link, image or formatting on a staff screen. CSV exports also neutralise spreadsheet formulas.
- **No secrets in the repository.** Codes, the ticket-signing key and the database live in `data/` or in environment settings, and `.gitignore` keeps them out of Git.

Details and tests: [`streamlit-app/specs/security-hardening.md`](streamlit-app/specs/security-hardening.md) and [`streamlit-app/tests/test_security.py`](streamlit-app/tests/test_security.py).

### Known limits

- Staff sign in with a shared access code per role, not personal passwords, and there is no two-factor sign-in.
- Anyone can hold places with made-up emails, so a determined person could fill the event with holds until they expire. A real launch would add email confirmation or a limit per visitor.
- If the app is hosted where every visitor reaches it through one shared address, the guess limit counts them as one visitor. Wrong guesses then pause sign-in for everyone for 15 minutes. That is a nuisance, not a way in.
- Payments are simulated and no emails are sent, as the classroom rules require.

## Documentation

| Document | What it covers |
| --- | --- |
| [`streamlit-app/README.md`](streamlit-app/README.md) | The Python app in detail: walkthrough, where each piece of code lives, the life of a booking, settings, and how it maps to the JavaScript version |
| [`streamlit-app/specs/`](streamlit-app/specs/) | One short spec (Why / What / Out of scope / Done when) for each feature added after the port |
| [`streamlit-app/AGENTS.md`](streamlit-app/AGENTS.md) | The rules we gave AI coding assistants working on the code |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | The product rules: prices, capacity, holds, roles |
| [`docs/PROJECT-OVERVIEW.md`](docs/PROJECT-OVERVIEW.md) | How Tubarão started and developed |
| [`docs/TECHNICAL.md`](docs/TECHNICAL.md), [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | The original JavaScript version: setup, code and team workflow |

## Repository layout

```text
streamlit-app/      the Python + Streamlit app we are submitting
  app.py            screens
  logic.py          rules
  db.py             SQLite storage
  tickets.py        QR tickets
  display.py        shows typed text safely
  seed.py           demo data and access codes
  specs/  tests/
docs/               product and history documents
*.js, *.html, server/, api/, supabase/, tests/
                    the original JavaScript version, kept for reference
```
