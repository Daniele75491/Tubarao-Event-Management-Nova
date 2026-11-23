"""Shared helpers for the QA test files (test_qa_*.py).

The original tests use an in-memory database. The QA tests also need a real
database FILE, so they can close it, open it again and use several
connections at once, like several phones and browsers would.

Everything here is made up: names, @example.test emails and access codes.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

import db
import logic
from conftest import NOW

ORGANIZER_CODE = "qa-organizer-code-1"
DOOR_CODE = "qa-door-code-1234"


def create_demo_file(path: Path, **event_settings) -> dict:
    """Create a database file with one organizer, one door account and one open event.

    Returns the event id. The file is closed again before returning, so every
    test step has to open it itself, exactly like a fresh browser session.
    """
    conn = db.connect(path)
    try:
        organizer_id = logic.create_access_account(conn, "QA Organizer", "SUPER_ADMIN", ORGANIZER_CODE)
        logic.create_access_account(conn, "QA Door phone", "ADMIN", DOOR_CODE)
        organizer = {"account_id": organizer_id}
        values = {"name": "QA Party", "starts_at": NOW + timedelta(days=5), "physical_capacity": 6,
                  "men_paid_cap": 2, "early_price_cents": 800, "late_price_cents": 1200,
                  "early_price_ends_at": NOW + timedelta(days=1), "pricing_mode": "AUTO",
                  "reservation_minutes": 20, "claim_hold_hours": 24, "sales_mode": "OPEN", **event_settings}
        event = logic.create_event(conn, organizer, values, NOW - timedelta(days=1))
        logic.activate_event(conn, organizer, event["id"], NOW - timedelta(days=1))
        return event["id"]
    finally:
        conn.close()


@contextmanager
def opened(path: Path):
    """Open the database file for one step and always close it afterwards."""
    conn = db.connect(path)
    try:
        yield conn
    finally:
        conn.close()


def sign_in(path: Path, code: str) -> str:
    """Sign in with an access code and return only the session token,
    like the browser keeps only the token between page loads."""
    with opened(path) as conn:
        token, _identity = logic.login(conn, code, NOW)
    return token


def identity(conn, token: str) -> dict:
    """Turn a saved session token back into the signed-in staff member."""
    who = logic.session_identity(conn, token, NOW)
    assert who is not None, "the staff session should still be valid"
    return who
