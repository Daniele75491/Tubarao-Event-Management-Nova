"""QA: the whole demo from booking to the door, on a real database file.

Each step opens its own connection and closes it again, like a different
browser tab or phone would. So these tests also prove that every result is
really saved in the SQLite file, not just kept in memory.

Scenarios covered (see docs/QA-FINAL.md): A, D, F, H, I, J, K, L, M, N.
"""

import csv
import io
from datetime import timedelta

import pytest

import db
import guest_list_pdf
import logic
import tickets
from conftest import NOW, SECRET
from qa_support import DOOR_CODE, ORGANIZER_CODE, create_demo_file, identity, opened, sign_in

GUEST = {"first": "Alex", "last": "Demo", "email": "alex.demo@example.test"}


@pytest.fixture(autouse=True)
def workflow_clock(monkeypatch):
    """Keep session validation on the same clock as the workflow."""
    monkeypatch.setattr(logic, "utcnow", lambda: NOW)



@pytest.fixture
def demo_file(tmp_path):
    path = tmp_path / "qa-demo.db"
    event_id = create_demo_file(path)
    return path, event_id


def test_one_ticket_goes_from_booking_to_the_door_and_into_the_numbers(demo_file):
    path, event_id = demo_file

    # A. The guest reserves a WOMEN ticket at the early price.
    with opened(path) as conn:
        booking = logic.reserve(conn, GUEST["first"], GUEST["last"], GUEST["email"], "WOMEN", NOW)
    assert (booking["status"], booking["amount_cents"], booking["pricing_tier"]) == ("RESERVED", 800, "EARLY")
    reference = booking["reservation_id"]

    # D. Later, in a new browser session, the guest presses SIMULATE €8 & CLAIM.
    with opened(path) as conn:
        assert logic.reservation_state(conn, reference, GUEST["email"], NOW + timedelta(minutes=5))["status"] == "RESERVED"
        claimed = logic.claim_payment(conn, reference, GUEST["email"], NOW + timedelta(minutes=5))
    assert claimed["status"] == "PAYMENT_CLAIMED"

    # F. The organizer signs in, sees the claim waiting and confirms it.
    organizer_token = sign_in(path, ORGANIZER_CODE)
    with opened(path) as conn:
        organizer = identity(conn, organizer_token)
        waiting = [r for r in logic.dashboard(conn, organizer, NOW)["reservations"] if r["id"] == reference]
        assert waiting[0]["status"] == "PAYMENT_CLAIMED"
        confirmed = logic.confirm_payment(conn, organizer, reference, NOW + timedelta(minutes=10), SECRET)
    assert confirmed == {"reservation_id": reference, "status": "PAID", "ticket_issued": True, "ticket_error": None}

    # H. The organizer downloads the demo QR. The scanner can read it, and it holds no personal data.
    with opened(path) as conn:
        png = logic.ticket_qr(conn, identity(conn, organizer_token), reference, SECRET)
    payload = tickets.decode_qr_image(png)
    assert payload is not None and payload.startswith("TUBARAO:")
    assert tickets.TOKEN_PATTERN.match(payload.removeprefix("TUBARAO:"))  # just 43 random-looking characters
    for private in (GUEST["email"], reference, event_id, "WOMEN"):
        assert private not in payload

    # The guest's own screen now says PAID, but never shows the QR.
    with opened(path) as conn:
        guest_view = logic.booking_by_reference(conn, reference, NOW + timedelta(minutes=11))
    assert guest_view["status"] == "PAID"
    assert not any("qr" in key for key in guest_view)

    # I. Door staff scan the code: the guest is let in.
    door_token = sign_in(path, DOOR_CODE)
    with opened(path) as conn:
        first = logic.check_in_qr(conn, identity(conn, door_token), payload, NOW + timedelta(hours=2))
    assert (first["result"], first["first_name"], first["last_name"]) == ("CHECKED_IN", "Alex", "Demo")

    # J. The same code shown again, on another phone connection, is refused.
    with opened(path) as conn:
        second = logic.check_in_qr(conn, identity(conn, door_token), payload, NOW + timedelta(hours=3))
    assert second["result"] == "ALREADY_CHECKED_IN"
    assert second["checked_in_at"] == first["checked_in_at"]

    # L. Live attendance (door) and the dashboard (organizer) agree.
    with opened(path) as conn:
        live = logic.presence(conn, identity(conn, door_token))
        numbers = logic.dashboard(conn, identity(conn, organizer_token), NOW)["kpis"]
    assert live["stats"]["total"] == 1 and live["stats"]["women"] == 1
    assert (numbers["paid"], numbers["checked_in"], numbers["revenue_cents"]) == (1, 1, 800)

    # N. The backup CSV and the guest list both show the guest as expected.
    with opened(path) as conn:
        organizer = identity(conn, organizer_token)
        rows = list(csv.reader(io.StringIO(logic.event_backup_csv(conn, organizer)[1].decode("utf-8-sig"))))
        listed_event, guests = logic.guest_list(conn, organizer)
    assert rows[1][:3] == ["Alex", "Demo", GUEST["email"]]
    assert rows[1][5:8] == ["PAID", "8.00", "YES"]
    assert guests == [{"first_name": "Alex", "last_name": "Demo"}]
    assert guest_list_pdf.render(listed_event, guests).startswith(b"%PDF")


def test_a_non_paying_guest_is_admitted_once_and_counted_everywhere(demo_file):
    path, event_id = demo_file
    organizer_token, door_token = sign_in(path, ORGANIZER_CODE), sign_in(path, DOOR_CODE)

    # K. The organizer adds a resident; the door finds them by name and lets them in once.
    with opened(path) as conn:
        resident = logic.add_non_paying(conn, identity(conn, organizer_token), event_id,
                                        "Rui", "Resident", "MEN", None, NOW)
    with opened(path) as conn:
        door = identity(conn, door_token)
        found = logic.search_attendees(conn, door, "rui res", NOW)["attendees"]
        assert [(p["type"], p["checked_in_at"]) for p in found] == [("NON-PAYING", None)]
        first = logic.check_in_non_paying(conn, door, found[0]["attendee_id"], NOW)
    with opened(path) as conn:
        second = logic.check_in_non_paying(conn, identity(conn, door_token), resident["id"], NOW + timedelta(minutes=1))
    assert first["result"] == "CHECKED_IN"
    assert second["result"] == "ALREADY_CHECKED_IN" and second["checked_in_at"] == first["checked_in_at"]

    # L. They count as inside, but never as revenue or as a paid ticket.
    with opened(path) as conn:
        live = logic.presence(conn, identity(conn, door_token))
        numbers = logic.dashboard(conn, identity(conn, organizer_token), NOW)["kpis"]
    assert live["stats"] == {"total": 1, "men": 1, "women": 0, "men_percentage": 100.0, "women_percentage": 0.0}
    assert live["attendees"][0]["type"] == "NON-PAYING"
    assert (numbers["non_paying"], numbers["paid"], numbers["revenue_cents"]) == (1, 0, 0)


# ------------------------------------------------------------------ M. persistence

def test_a_booking_keeps_its_status_deadline_and_price_after_the_database_reopens(demo_file):
    path, _event_id = demo_file
    with opened(path) as conn:
        booking = logic.reserve(conn, "Bea", "Demo", "bea@example.test", "WOMEN", NOW)

    # The organizer switches to the late price after the booking was made.
    organizer_token = sign_in(path, ORGANIZER_CODE)
    with opened(path) as conn:
        event = logic.current_event(conn)
        logic.update_event(conn, identity(conn, organizer_token), event["id"], {"pricing_mode": "LATE"}, NOW)

    with opened(path) as conn:
        again = logic.booking_by_reference(conn, booking["reservation_id"], NOW + timedelta(minutes=1))
    for key in ("status", "amount_cents", "pricing_tier", "reserved_until", "category"):
        assert again[key] == booking[key]
    assert again["amount_cents"] == 800  # still the early price

    # The same details typed again (e.g. on another device) resume this booking, not a new one.
    with opened(path) as conn:
        resumed = logic.reserve(conn, "bea", "DEMO", "Bea@Example.test", "WOMEN", NOW + timedelta(minutes=2))
    assert resumed["resumed"] is True and resumed["reservation_id"] == booking["reservation_id"]
    with opened(path) as conn:
        assert len(db.fetch_all(conn, "SELECT id FROM reservations")) == 1


def test_a_check_in_and_the_qr_survive_closing_and_reopening_the_database(demo_file):
    path, _event_id = demo_file
    with opened(path) as conn:
        booking = logic.reserve(conn, "Caio", "Demo", "caio@example.test", "MEN", NOW)
        logic.claim_payment(conn, booking["reservation_id"], "caio@example.test", NOW)
    organizer_token, door_token = sign_in(path, ORGANIZER_CODE), sign_in(path, DOOR_CODE)
    with opened(path) as conn:
        organizer = identity(conn, organizer_token)
        logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
        first_png = logic.ticket_qr(conn, organizer, booking["reservation_id"], SECRET)
    with opened(path) as conn:
        assert logic.check_in_qr(conn, identity(conn, door_token), tickets.decode_qr_image(first_png), NOW)["result"] == "CHECKED_IN"

    # After a "restart", the same QR is still recognised and still refused a second time.
    with opened(path) as conn:
        again_png = logic.ticket_qr(conn, identity(conn, organizer_token), booking["reservation_id"], SECRET)
        result = logic.check_in_qr(conn, identity(conn, door_token), tickets.decode_qr_image(again_png), NOW)
        row = db.get_reservation(conn, booking["reservation_id"])
    assert tickets.decode_qr_image(again_png) == tickets.decode_qr_image(first_png)
    assert result["result"] == "ALREADY_CHECKED_IN"
    assert row["status"] == "PAID" and row["checked_in_at"] is not None


def test_staff_sessions_are_stored_in_the_file_but_logout_still_ends_them(demo_file):
    path, _event_id = demo_file
    token = sign_in(path, ORGANIZER_CODE)
    with opened(path) as conn:
        assert identity(conn, token)["role"] == "SUPER_ADMIN"
        logic.logout(conn, token, NOW)
    with opened(path) as conn:
        assert logic.session_identity(conn, token, NOW) is None
