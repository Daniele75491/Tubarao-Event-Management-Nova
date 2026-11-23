"""QA: several people acting at the same moment.

Each "person" is a separate thread with its own connection to the same
database file, like several phones or browsers talking to one server.
db.transaction() uses BEGIN IMMEDIATE, so only one of them can change the
data at a time. These tests check that the rules still hold under that
pressure: no overbooking and no double admission.

Limits: SQLite runs on one computer. These tests do not prove anything about
a database shared across several servers (see docs/QA-FINAL.md).
"""

import threading
from datetime import timedelta

import pytest

import db
import logic
import tickets
from conftest import NOW, SECRET
from qa_support import create_demo_file, opened

PEOPLE = 8


def all_at_once(path, action, count=PEOPLE) -> list:
    """Run `action(conn, n)` for `count` people at the same moment. Returns each outcome."""
    start = threading.Barrier(count)
    outcomes: list = [None] * count

    def person(n: int) -> None:
        conn = db.connect(path)
        try:
            start.wait()
            outcomes[n] = action(conn, n)
        except logic.TubaraoError as error:
            outcomes[n] = error.code
        except Exception as error:  # anything else is a real failure: keep it visible
            outcomes[n] = f"CRASH: {error!r}"
        finally:
            conn.close()

    threads = [threading.Thread(target=person, args=(n,)) for n in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return outcomes


@pytest.fixture
def make_file(tmp_path):
    def make(**settings):
        path = tmp_path / "qa-concurrency.db"
        create_demo_file(path, **settings)
        return path
    return make


def test_eight_guests_racing_for_the_last_place_produce_exactly_one_booking(make_file):
    path = make_file(physical_capacity=1, men_paid_cap=1)
    outcomes = all_at_once(path, lambda conn, n: logic.reserve(
        conn, f"Racer{n}", "Demo", f"racer{n}@example.test", "WOMEN", NOW)["status"])
    assert sorted(outcomes) == ["EVENT_SOLD_OUT"] * (PEOPLE - 1) + ["RESERVED"]
    with opened(path) as conn:
        assert db.fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations")["n"] == 1


def test_men_racing_for_the_last_men_place_produce_exactly_one_men_booking(make_file):
    path = make_file(physical_capacity=6, men_paid_cap=1)
    outcomes = all_at_once(path, lambda conn, n: logic.reserve(
        conn, f"Racer{n}", "Demo", f"racer{n}@example.test", "MEN", NOW)["status"])
    assert outcomes.count("RESERVED") == 1
    assert outcomes.count("MEN_SOLD_OUT") == PEOPLE - 1


def test_the_same_guest_pressing_reserve_on_many_devices_gets_one_booking(make_file):
    path = make_file()
    outcomes = all_at_once(path, lambda conn, n: logic.reserve(
        conn, "Alex", "Demo", "alex@example.test", "WOMEN", NOW)["reservation_id"])
    assert len(set(outcomes)) == 1 and not str(outcomes[0]).startswith("CRASH")
    with opened(path) as conn:
        assert db.fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations")["n"] == 1


def test_one_ticket_scanned_by_many_door_phones_at_once_lets_one_person_in(make_file):
    path = make_file()
    with opened(path) as conn:
        organizer = {"account_id": db.fetch_one(conn, "SELECT id FROM admin_access_accounts WHERE role = 'SUPER_ADMIN'")["id"]}
        door = {"account_id": db.fetch_one(conn, "SELECT id FROM admin_access_accounts WHERE role = 'ADMIN'")["id"]}
        booking = logic.reserve(conn, "Alex", "Demo", "alex@example.test", "WOMEN", NOW)
        logic.claim_payment(conn, booking["reservation_id"], "alex@example.test", NOW)
        logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
        payload = tickets.decode_qr_image(logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET))

    outcomes = all_at_once(path, lambda conn, n: logic.check_in_qr(
        conn, door, payload, NOW + timedelta(seconds=n))["result"])
    assert sorted(outcomes) == ["ALREADY_CHECKED_IN"] * (PEOPLE - 1) + ["CHECKED_IN"]
    with opened(path) as conn:
        assert logic.presence(conn, door)["stats"]["total"] == 1


def test_a_resident_checked_in_by_two_phones_at_once_is_counted_once(make_file):
    path = make_file()
    with opened(path) as conn:
        organizer = {"account_id": db.fetch_one(conn, "SELECT id FROM admin_access_accounts WHERE role = 'SUPER_ADMIN'")["id"]}
        door = {"account_id": db.fetch_one(conn, "SELECT id FROM admin_access_accounts WHERE role = 'ADMIN'")["id"]}
        resident = logic.add_non_paying(conn, organizer, logic.current_event(conn)["id"], "Rui", "Resident", "MEN", None, NOW)

    outcomes = all_at_once(path, lambda conn, n: logic.check_in_non_paying(conn, door, resident["id"], NOW)["result"], count=4)
    assert sorted(outcomes) == ["ALREADY_CHECKED_IN"] * 3 + ["CHECKED_IN"]
