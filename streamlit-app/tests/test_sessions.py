"""Fix 3: every staff action rechecks the session, not just the account."""

from datetime import timedelta

import pytest

import db
import logic
from conftest import SECRET


def signed_in(conn, code, at=None):
    """Sign in like the screen does: the identity carries its session token."""
    token, identity = logic.login(conn, code, at or logic.utcnow())
    return token, {**identity, "session_token": token}


def actions(conn, who, booking_id, event_id):
    now = logic.utcnow()
    return {
        "dashboard": lambda: logic.dashboard(conn, who, now),
        "confirm": lambda: logic.confirm_payment(conn, who, booking_id, now, SECRET),
        "reject": lambda: logic.reject_payment(conn, who, booking_id, now),
        "adjust": lambda: logic.adjust_amount(conn, who, booking_id, 500, now),
        "delete": lambda: logic.delete_record(conn, who, booking_id),
        "edit event": lambda: logic.update_event(conn, who, event_id, {"name": "Changed"}, now),
        "add guest": lambda: logic.add_non_paying(conn, who, event_id, "A", "B", "MEN", None, now),
        "backup": lambda: logic.event_backup_csv(conn, who, now),
        "door search": lambda: logic.search_attendees(conn, who, "Guest", now),
        "check in": lambda: logic.check_in_manual(conn, who, booking_id, now),
        "live attendance": lambda: logic.presence(conn, who),
    }


@pytest.fixture
def booking(conn, organizer, event):
    made = logic.reserve(conn, "Guest", "Session", "guest.session@example.test", "WOMEN", logic.utcnow())
    return made["reservation_id"]


def test_a_live_session_can_act(conn, organizer, event, booking):
    _token, who = signed_in(conn, "organizer-code-1")
    assert logic.dashboard(conn, who, logic.utcnow())["event"]["id"] == event["id"]


@pytest.mark.parametrize("name", ["dashboard", "confirm", "reject", "adjust", "delete", "edit event", "add guest",
                                  "backup", "door search", "check in", "live attendance"])
def test_after_logout_every_action_is_refused(conn, organizer, event, booking, name):
    token, who = signed_in(conn, "organizer-code-1")
    logic.logout(conn, token, logic.utcnow())
    with pytest.raises(logic.TubaraoError) as error:
        actions(conn, who, booking, event["id"])[name]()
    assert error.value.code == "UNAUTHORIZED"
    assert db.get_reservation(conn, booking)["status"] == "RESERVED"  # nothing happened


def test_an_expired_session_is_refused(conn, organizer, event):
    _token, who = signed_in(conn, "organizer-code-1", at=logic.utcnow() - timedelta(hours=13))
    with pytest.raises(logic.TubaraoError) as error:
        logic.dashboard(conn, who, logic.utcnow())
    assert error.value.code == "UNAUTHORIZED"


def test_a_door_session_stops_live_attendance_after_logout(conn, door, event):
    token, who = signed_in(conn, "door-code-1234")
    assert logic.presence(conn, who)["stats"]["total"] == 0
    logic.logout(conn, token, logic.utcnow())
    with pytest.raises(logic.TubaraoError):
        logic.presence(conn, who)


def test_a_session_cannot_be_borrowed_by_another_account(conn, organizer, door, event):
    token, _ = signed_in(conn, "door-code-1234")
    pretend = {**organizer, "session_token": token}  # organizer's ID with the door phone's session
    with pytest.raises(logic.TubaraoError) as error:
        logic.dashboard(conn, pretend, logic.utcnow())
    assert error.value.code == "UNAUTHORIZED"


def test_a_made_up_token_is_refused(conn, organizer, event):
    with pytest.raises(logic.TubaraoError) as error:
        logic.dashboard(conn, {**organizer, "session_token": "made-up"}, logic.utcnow())
    assert error.value.code == "UNAUTHORIZED"
