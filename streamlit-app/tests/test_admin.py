"""Staff sign-in, event management and organizer corrections."""

from datetime import timedelta

import pytest

import db
import logic
from conftest import NOW


# ------------------------------------------------------------------ sign-in

def test_the_right_code_signs_in_with_the_right_role(conn, organizer, door):
    _token, identity = logic.login(conn, "door-code-1234", NOW)
    assert identity["role"] == "ADMIN"


def test_a_wrong_code_is_refused(conn, organizer):
    with pytest.raises(logic.TubaraoError) as error:
        logic.login(conn, "wrong-code-123", NOW)
    assert error.value.code == "INVALID_ACCESS_CODE"


def test_access_codes_and_sessions_are_never_stored_in_plain_text(conn, organizer):
    token, _ = logic.login(conn, "organizer-code-1", NOW)
    everything = str(db.fetch_all(conn, "SELECT * FROM admin_access_accounts")) + \
        str(db.fetch_all(conn, "SELECT * FROM admin_sessions"))
    assert "organizer-code-1" not in everything and token not in everything


def test_sessions_last_12_hours_and_logout_ends_them(conn, organizer):
    token, _ = logic.login(conn, "organizer-code-1", NOW)
    assert logic.session_identity(conn, token, NOW + timedelta(hours=11))["role"] == "SUPER_ADMIN"
    assert logic.session_identity(conn, token, NOW + timedelta(hours=12, seconds=1)) is None
    logic.logout(conn, token, NOW)
    assert logic.session_identity(conn, token, NOW) is None


def test_a_deactivated_account_loses_access_immediately(conn, organizer):
    token, identity = logic.login(conn, "organizer-code-1", NOW)
    db.update(conn, "admin_access_accounts", identity["account_id"], {"is_active": 0})
    assert logic.session_identity(conn, token, NOW) is None
    with pytest.raises(logic.TubaraoError):
        logic.dashboard(conn, identity, NOW)


def test_door_staff_cannot_open_the_dashboard_or_manage_events(conn, door, event):
    for call in (lambda: logic.dashboard(conn, door, NOW),
                 lambda: logic.update_event(conn, door, event["id"], {"name": "Hacked"}, NOW),
                 lambda: logic.add_non_paying(conn, door, event["id"], "A", "B", "MEN", None, NOW),
                 lambda: logic.event_backup_csv(conn, door)):
        with pytest.raises(logic.TubaraoError) as error:
            call()
        assert error.value.code == "FORBIDDEN"


def test_a_screen_cannot_upgrade_a_door_account_by_claiming_a_role(conn, door, event):
    pretend = {**door, "role": "SUPER_ADMIN"}
    with pytest.raises(logic.TubaraoError):
        logic.dashboard(conn, pretend, NOW)


# ------------------------------------------------------------------ events

def test_new_events_start_inactive_and_activation_switches_the_live_event(conn, organizer, event):
    new = logic.create_event(conn, organizer, {"name": "Next", "sales_mode": "OPEN"}, NOW)
    assert not new["is_active"] and logic.current_event(conn)["id"] == event["id"]
    logic.activate_event(conn, organizer, new["id"], NOW)
    assert logic.current_event(conn)["id"] == new["id"]
    assert len(db.active_events(conn)) == 1
    assert db.get_event(conn, event["id"]) is not None  # history is kept


def test_editing_requires_the_event_to_still_be_the_active_one(conn, organizer, event):
    new = logic.create_event(conn, organizer, {"name": "Next"}, NOW)
    logic.activate_event(conn, organizer, new["id"], NOW)
    with pytest.raises(logic.TubaraoError) as error:
        logic.update_event(conn, organizer, event["id"], {"name": "Old edit"}, NOW)
    assert error.value.code == "EVENT_CHANGED"


@pytest.mark.parametrize("settings", [
    {"name": ""},
    {"name": "X", "sales_mode": "SCHEDULED"},  # scheduled without an opening time
    {"name": "X", "sales_open_at": NOW, "sales_close_at": NOW},  # closing must be after opening
    {"name": "X", "pricing_mode": "CHEAP"},
    {"name": "X", "reservation_minutes": 0},
    {"name": "X", "unknown_setting": 1},
])
def test_invalid_event_settings_are_refused(conn, organizer, settings):
    with pytest.raises(logic.TubaraoError):
        logic.create_event(conn, organizer, settings, NOW)


def test_the_active_event_prefers_open_or_scheduled_sales(conn, organizer):
    open_event = logic.create_event(conn, organizer, {"name": "Open", "sales_mode": "OPEN"}, NOW)
    closed_event = logic.create_event(conn, organizer, {"name": "Closed", "sales_mode": "CLOSED"}, NOW + timedelta(seconds=1))
    for item in (open_event, closed_event):  # force both active to test the tie-break rule
        db.update(conn, "events", item["id"], {"is_active": 1})
    assert logic.current_event(conn)["name"] == "Open"


# ------------------------------------------------------------------ corrections

def test_only_bookings_without_payment_or_ticket_evidence_can_be_deleted(conn, organizer, event, book, paid):
    reserved = book()
    assert logic.delete_record(conn, organizer, reserved["reservation_id"])["deleted"]
    claimed = book()
    logic.claim_payment(conn, claimed["reservation_id"], claimed["email"], NOW)
    ticket = paid()
    for booking in (claimed, ticket):
        with pytest.raises(logic.TubaraoError) as error:
            logic.delete_record(conn, organizer, booking["reservation_id"])
        assert error.value.code == "RESERVATION_NOT_DELETABLE"


def test_a_paid_ticket_can_be_deleted_only_before_check_in(conn, organizer, door, paid):
    first, second = paid(), paid()
    logic.check_in_manual(conn, door, second["reservation_id"], NOW)
    assert logic.delete_paid_ticket(conn, organizer, first["reservation_id"])["deleted"]
    with pytest.raises(logic.TubaraoError) as error:
        logic.delete_paid_ticket(conn, organizer, second["reservation_id"])
    assert error.value.code == "PAID_TICKET_NOT_DELETABLE"


def test_changing_a_paid_category_respects_the_men_cap(conn, organizer, paid):
    women = paid("WOMEN")
    for _ in range(4):
        paid("MEN")
    with pytest.raises(logic.TubaraoError) as error:
        logic.change_paid_category(conn, organizer, women["reservation_id"], "MEN", NOW)
    assert error.value.code == "MEN_TICKETS_FULL"


def test_changing_category_keeps_price_and_qr(conn, organizer, paid):
    booking = paid("WOMEN")
    before = db.get_reservation(conn, booking["reservation_id"])
    assert logic.change_paid_category(conn, organizer, booking["reservation_id"], "MEN", NOW)["changed"]
    after = db.get_reservation(conn, booking["reservation_id"])
    assert after["category"] == "MEN"
    assert (after["amount_cents"], after["qr_token_hash"]) == (before["amount_cents"], before["qr_token_hash"])
    assert not logic.change_paid_category(conn, organizer, booking["reservation_id"], "MEN", NOW)["changed"]


def test_category_cannot_change_after_check_in(conn, organizer, door, paid):
    booking = paid()
    logic.check_in_manual(conn, door, booking["reservation_id"], NOW)
    with pytest.raises(logic.TubaraoError) as error:
        logic.change_paid_category(conn, organizer, booking["reservation_id"], "MEN", NOW)
    assert error.value.code == "CATEGORY_NOT_EDITABLE"


def test_adjusting_an_amount_is_recorded_in_the_private_history(conn, organizer, paid):
    booking = paid()
    logic.adjust_amount(conn, organizer, booking["reservation_id"], 650, NOW)
    history = db.amount_adjustments(conn, booking["reservation_id"])
    assert [(h["previous_amount_cents"], h["new_amount_cents"]) for h in history] == [(800, 650)]
    assert history[0]["adjusted_by_access_id"] == organizer["account_id"]
    assert not logic.adjust_amount(conn, organizer, booking["reservation_id"], 650, NOW)["changed"]  # no-op
    assert len(db.amount_adjustments(conn, booking["reservation_id"])) == 1


def test_the_amount_history_survives_deleting_the_ticket(conn, organizer, paid):
    booking = paid()
    logic.adjust_amount(conn, organizer, booking["reservation_id"], 650, NOW)
    logic.delete_paid_ticket(conn, organizer, booking["reservation_id"])
    assert len(db.amount_adjustments(conn, booking["reservation_id"])) == 1


def test_amounts_of_expired_or_rejected_bookings_cannot_be_adjusted(conn, organizer, event, book):
    booking = book(at=NOW - timedelta(hours=1))
    logic.reserve(conn, "Someone", "Else", "else@example.test", "WOMEN", NOW)  # saves the expiry
    with pytest.raises(logic.TubaraoError) as error:
        logic.adjust_amount(conn, organizer, booking["reservation_id"], 500, NOW)
    assert error.value.code == "AMOUNT_NOT_EDITABLE"


@pytest.mark.parametrize("bad", [0, 100001, 8.5, True])
def test_adjusted_amounts_must_be_valid_cents(conn, organizer, paid, bad):
    booking = paid()
    with pytest.raises(logic.TubaraoError):
        logic.adjust_amount(conn, organizer, booking["reservation_id"], bad, NOW)


def test_removing_a_non_paying_guest_releases_the_place(conn, organizer, make_event, book):
    event = make_event(physical_capacity=1, men_paid_cap=1)
    guest = logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    with pytest.raises(logic.TubaraoError):
        book()
    logic.remove_non_paying(conn, organizer, event["id"], guest["id"])
    assert book()["status"] == "RESERVED"


def test_dashboard_numbers(conn, organizer, door, event, book, paid):
    logic.add_non_paying(conn, organizer, event["id"], "Rui", "Resident", "MEN", None, NOW)
    ticket = paid("WOMEN")
    paid("MEN")
    book("WOMEN")
    logic.check_in_manual(conn, door, ticket["reservation_id"], NOW)
    data = logic.dashboard(conn, organizer, NOW)
    k = data["kpis"]
    assert (k["paid"], k["non_paying"], k["total"], k["checked_in"], k["revenue_cents"]) == (2, 1, 3, 1, 1600)
    assert (k["total_men"], k["total_women_percent"]) == (2, "33.3%")
    assert (data["capacity"]["total"], data["capacity"]["paid_capacity"]) == (4, 9)
