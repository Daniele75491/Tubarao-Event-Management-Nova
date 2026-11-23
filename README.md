# Tubarão · Nova SBE classroom project

Tubarão helps a team run a small event. Guests can reserve a place, organizers can review simulated payments, and door staff can check tickets and record arrivals.

The **Python and Streamlit app** in `streamlit-app/` is the university submission. Streamlit turns the Python code into a website. Use made-up names and emails with `@example.test`. Payments are simulated, and the app sends no emails.

## Try the live demo

Open the guest demo in your browser. You can try it without signing in to Streamlit. [Open the Tubarão Nova demo](https://tubarao-event-management-nova-gjnjzm2wnuszqjv9ionfjb.streamlit.app/)

1. Under **Tickets**, confirm the classroom follow step, choose a ticket category, and reserve a place with a fictional name and email such as Alex Demo and `alex@example.test`.
2. Press **SIMULATE … & CLAIM**. This tells the organizer you completed the pretend payment step.
3. A teammate with organizer access can confirm the claim and download the QR ticket. A QR code is the square image door staff can scan.
4. A teammate with door access can scan the QR or find the guest by name. A second check-in for the same ticket is refused.

Keep staff codes private. Use the [demo walkthrough](docs/DEMO-RUNBOOK.md) for the full presentation, sample guests, and backup steps.

## Run the app on your computer

A local copy gives you your own practice data. Install [uv](https://docs.astral.sh/uv/getting-started/installation/), which sets up the Python tools the project needs. Open a terminal in a fresh checkout of the repository and run these commands:

```powershell
cd streamlit-app
uv sync --locked --python 3.12
uv run --locked --python 3.12 python seed.py
uv run --locked --python 3.12 python -m streamlit run app.py
```

Open [the local app](http://localhost:8501). The seed command creates fictional guests and prints local staff codes. Run it only for a disposable local demo database. It can replace an existing database after confirmation. Keep the generated codes and data out of Git.

## Run the tests

The tests check the booking rules, staff permissions, and check-in workflow. Run this from `streamlit-app/`:

```powershell
uv run --locked --python 3.12 python -m pytest -q -r a
```

`--locked` uses the dependency versions recorded in the repository. See the [final release report](docs/FINAL-RELEASE-REPORT.md) for the verified results and the known expected failure.

## How the demo stores data

SQLite keeps bookings and check-ins in a single file. The hosted demo may lose that file during a restart or redeploy, so use synthetic data and keep a local copy for the presentation. [Streamlit storage limits](https://docs.streamlit.io/develop/concepts/connections/connecting-to-data)

## Where to start

| I want to… | Start here |
| --- | --- |
| Understand the Python app and how it works | [Python setup and reference](streamlit-app/README.md) · [Code walkthrough](docs/CODE-WALKTHROUGH.md) |
| Get a copy of the code and share a change | [Team Handbook](docs/CONTRIBUTING.md) |
| Ask Codex for help with my first task | [Use Codex safely](docs/CONTRIBUTING.md#use-codex-safely) |
| Read about the project's history and the earlier JavaScript version | [Project Overview](docs/PROJECT-OVERVIEW.md) · [JavaScript Developer Guide](docs/TECHNICAL.md) |
