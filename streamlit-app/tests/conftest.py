"""Shared test setup: a fresh in-memory database, two staff accounts and an open event."""

from datetime import datetime, timedelta, timezone

import pytest

import db
import logic

NOW = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
SECRET = "test-signing-secret-that-is-long-enough-123"


@pytest.fixture
def conn():
    connection = db.connect(":memory:")
    yield connection
    connection.close()


@pytest.fixture
def organizer(conn):
    account_id = logic.create_access_account(conn, "Organizer", "SUPER_ADMIN", "organizer-code-1")
    return {"account_id": account_id, "label": "Organizer", "role": "SUPER_ADMIN"}


@pytest.fixture
def door(conn):
    account_id = logic.create_access_account(conn, "Door phone", "ADMIN", "door-code-1234")
    return {"account_id": account_id, "label": "Door phone", "role": "ADMIN"}


@pytest.fixture
def make_event(conn, organizer):
    """Create and activate an event. Any setting can be overridden."""
    def make(**settings):
        values = {"name": "Test Party", "starts_at": NOW + timedelta(days=5), "physical_capacity": 10,
                  "men_paid_cap": 4, "early_price_cents": 800, "late_price_cents": 1200,
                  "reservation_minutes": 20, "claim_hold_hours": 24, "sales_mode": "OPEN", **settings}
        event = logic.create_event(conn, organizer, values, NOW - timedelta(days=1))
        return logic.activate_event(conn, organizer, event["id"], NOW - timedelta(days=1))
    return make


@pytest.fixture
def event(make_event):
    return make_event()


@pytest.fixture
def book(conn, make_event):
    """Reserve a ticket for a made-up guest (creating a default event if there is none yet)."""
    counter = {"n": 0}

    def make(category="WOMEN", at=NOW, first=None, last="Demo", email=None):
        if not db.active_events(conn):
            make_event()
        counter["n"] += 1
        first = first or f"Guest{counter['n']}"
        email = email or f"guest{counter['n']}@example.test"
        result = logic.reserve(conn, first, last, email, category, at)
        return {**result, "email": email, "first": first, "last": last}
    return make


@pytest.fixture
def paid(conn, book, organizer):
    """A booking that went all the way to PAID with a ticket issued."""
    def make(category="WOMEN", **kwargs):
        booking = book(category, **kwargs)
        logic.claim_payment(conn, booking["reservation_id"], booking["email"], NOW)
        logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
        return booking
    return make
