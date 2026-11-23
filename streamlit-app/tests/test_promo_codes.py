"""Promo codes: organizer creates them, guests use them at checkout (see specs/promo-codes.md)."""

import sqlite3
from datetime import timedelta

import pytest

import db
import logic
from conftest import NOW, SECRET


@pytest.fixture
def promo(conn, organizer, event):
    """Create a promo code for the active event."""
    def make(code="NOVA20", percent=20, max_uses=None, expires_at=None):
        return logic.create_promo_code(conn, organizer, event["id"], code, percent, max_uses, expires_at, NOW)
    return make


def reserve(conn, n, code=None, at=NOW, category="WOMEN"):
    return logic.reserve(conn, f"Guest{n}", "Promo", f"promo{n}@example.test", category, at, promo_code=code)


def refused(conn, n, code, at=NOW) -> str:
    with pytest.raises(logic.TubaraoError) as error:
        reserve(conn, n, code, at)
    return error.value.code


# ------------------------------------------------------------------ the discount

@pytest.mark.parametrize("price,percent,expected", [(800, 20, 640), (1200, 50, 600), (850, 25, 638), (1, 90, 1)])
def test_the_discount_is_rounded_to_the_nearest_cent(price, percent, expected):
    assert logic.discounted_price(price, percent) == expected


def test_a_valid_code_lowers_the_price_and_is_remembered(conn, promo):
    promo()
    booking = reserve(conn, 1, "NOVA20")
    assert (booking["amount_cents"], booking["list_price_cents"], booking["promo_code"]) == (640, 800, "NOVA20")
    assert booking["pricing_tier"] == "EARLY"


def test_codes_work_in_any_capitals_and_with_spaces(conn, promo):
    promo()
    assert reserve(conn, 1, "  nova20 ")["amount_cents"] == 640


def test_no_code_or_an_empty_code_means_full_price(conn, promo):
    promo()
    assert reserve(conn, 1, None)["amount_cents"] == 800
    booking = reserve(conn, 2, "   ")
    assert (booking["amount_cents"], booking["promo_code"], booking["list_price_cents"]) == (800, None, 800)


def test_the_discount_applies_to_the_late_price_too(conn, organizer, event, promo):
    promo()
    logic.update_event(conn, organizer, event["id"], {"pricing_mode": "LATE"}, NOW)
    booking = reserve(conn, 1, "NOVA20")
    assert (booking["amount_cents"], booking["pricing_tier"]) == (960, "LATE")


def test_revenue_counts_the_discounted_amount(conn, organizer, promo):
    promo()
    booking = reserve(conn, 1, "NOVA20")
    logic.claim_payment(conn, booking["reservation_id"], "promo1@example.test", NOW)
    logic.confirm_payment(conn, organizer, booking["reservation_id"], NOW, SECRET)
    assert logic.dashboard(conn, organizer, NOW)["kpis"]["revenue_cents"] == 640


# ------------------------------------------------------------------ refusals

def test_an_unknown_code_is_refused_and_makes_no_booking(conn, event):
    assert refused(conn, 1, "NOPE") == "PROMO_CODE_NOT_FOUND"
    assert db.reservations_for_event(conn, event["id"]) == []


def test_a_code_from_another_event_does_not_exist_here(conn, organizer, promo, make_event):
    promo()
    make_event(name="Next Party")
    assert refused(conn, 1, "NOVA20") == "PROMO_CODE_NOT_FOUND"


def test_a_deactivated_code_is_refused_until_activated_again(conn, organizer, promo):
    code = promo()
    logic.set_promo_code_active(conn, organizer, code["id"], False, NOW)
    assert refused(conn, 1, "NOVA20") == "PROMO_CODE_INACTIVE"
    logic.set_promo_code_active(conn, organizer, code["id"], True, NOW)
    assert reserve(conn, 1, "NOVA20")["amount_cents"] == 640


def test_a_code_stops_working_at_its_expiry_time(conn, promo):
    promo(expires_at=NOW + timedelta(hours=1))
    assert reserve(conn, 1, "NOVA20", at=NOW + timedelta(minutes=59))["amount_cents"] == 640
    assert refused(conn, 2, "NOVA20", at=NOW + timedelta(hours=1)) == "PROMO_CODE_EXPIRED"


def test_a_code_runs_out_after_its_maximum_uses(conn, promo):
    promo(max_uses=2)
    reserve(conn, 1, "NOVA20")
    reserve(conn, 2, "NOVA20")
    assert refused(conn, 3, "NOVA20") == "PROMO_CODE_USED_UP"


def test_an_expired_hold_frees_its_use(conn, promo):
    promo(max_uses=1)
    reserve(conn, 1, "NOVA20", at=NOW)
    assert refused(conn, 2, "NOVA20", at=NOW + timedelta(minutes=5)) == "PROMO_CODE_USED_UP"
    assert reserve(conn, 2, "NOVA20", at=NOW + timedelta(minutes=21))["amount_cents"] == 640


def test_a_rejected_claim_frees_its_use(conn, organizer, promo):
    promo(max_uses=1)
    booking = reserve(conn, 1, "NOVA20")
    logic.claim_payment(conn, booking["reservation_id"], "promo1@example.test", NOW)
    logic.reject_payment(conn, organizer, booking["reservation_id"], NOW)
    assert reserve(conn, 2, "NOVA20")["amount_cents"] == 640


def test_the_refusal_messages_are_the_ones_in_the_spec():
    assert logic.MESSAGES["PROMO_CODE_NOT_FOUND"] == "This promo code doesn't exist."
    assert logic.MESSAGES["PROMO_CODE_INACTIVE"] == "This promo code is no longer active."
    assert logic.MESSAGES["PROMO_CODE_EXPIRED"] == "This promo code has expired."
    assert logic.MESSAGES["PROMO_CODE_USED_UP"] == "This promo code has been fully used."


# ------------------------------------------------------------------ resuming and restoring

def test_resuming_keeps_the_original_price_and_ignores_a_new_code(conn, promo):
    promo()
    first = reserve(conn, 1, None)
    again = reserve(conn, 1, "NOVA20", at=NOW + timedelta(minutes=2))
    assert again["resumed"] and again["reservation_id"] == first["reservation_id"]
    assert (again["amount_cents"], again["promo_code"]) == (800, None)


def test_resuming_with_an_invalid_code_still_resumes(conn, promo):
    first = reserve(conn, 1, None)
    assert reserve(conn, 1, "NOPE")["reservation_id"] == first["reservation_id"]


def test_a_restored_booking_keeps_its_discount_even_if_the_code_ran_out(conn, organizer, promo):
    promo(max_uses=1)
    old = reserve(conn, 1, "NOVA20", at=NOW)
    reserve(conn, 2, "NOVA20", at=NOW + timedelta(minutes=30))  # the freed use is taken again
    result = logic.confirm_external_payment(conn, organizer, old["reservation_id"], NOW + timedelta(minutes=31), SECRET)
    assert result["status"] == "PAID"
    assert db.get_reservation(conn, old["reservation_id"])["amount_cents"] == 640


# ------------------------------------------------------------------ organizer: creating and listing codes

def test_codes_are_saved_in_capitals(conn, promo):
    assert promo(code="friends-10", percent=10)["code"] == "FRIENDS-10"


@pytest.mark.parametrize("code,percent,max_uses", [
    ("AB", 20, None),               # too short
    ("A" * 21, 20, None),           # too long
    ("NOVA 20", 20, None),          # space inside
    ("NOVA20!", 20, None),          # symbol
    ("NOVA20", 0, None),            # percent too low
    ("NOVA20", 91, None),           # percent too high
    ("NOVA20", 20.5, None),         # not a whole number
    ("NOVA20", 20, 0),              # max uses below 1
])
def test_invalid_codes_are_refused(conn, promo, code, percent, max_uses):
    with pytest.raises(logic.TubaraoError) as error:
        promo(code=code, percent=percent, max_uses=max_uses)
    assert error.value.code == "INVALID_PROMO_CODE"


def test_a_code_must_be_unique_within_its_event(conn, organizer, promo, make_event):
    promo(code="NOVA20")
    with pytest.raises(logic.TubaraoError) as error:
        promo(code="nova20")
    assert error.value.code == "PROMO_CODE_EXISTS"
    new = make_event(name="Next Party")
    assert logic.create_promo_code(conn, organizer, new["id"], "NOVA20", 20, None, None, NOW)["code"] == "NOVA20"


def test_codes_can_only_be_made_for_the_active_event(conn, organizer, event, make_event):
    make_event(name="Next Party")
    with pytest.raises(logic.TubaraoError) as error:
        logic.create_promo_code(conn, organizer, event["id"], "OLD10", 10, None, None, NOW)
    assert error.value.code == "EVENT_CHANGED"


def test_door_staff_cannot_create_list_or_change_codes(conn, door, event, promo):
    code = promo()
    for call in (lambda: logic.create_promo_code(conn, door, event["id"], "DOOR10", 10, None, None, NOW),
                 lambda: logic.promo_codes(conn, door, NOW),
                 lambda: logic.set_promo_code_active(conn, door, code["id"], False, NOW)):
        with pytest.raises(logic.TubaraoError) as error:
            call()
        assert error.value.code == "FORBIDDEN"


def test_the_code_list_shows_uses_taken(conn, organizer, promo):
    promo(code="NOVA20", max_uses=5)
    promo(code="FRIENDS", percent=10)
    reserve(conn, 1, "NOVA20")
    reserve(conn, 2, "NOVA20")
    reserve(conn, 3, "NOVA20", at=NOW - timedelta(hours=1))  # this hold has expired: no use taken
    listed = {c["code"]: c for c in logic.promo_codes(conn, organizer, NOW)}
    assert (listed["NOVA20"]["uses"], listed["NOVA20"]["max_uses"], listed["NOVA20"]["percent_off"]) == (2, 5, 20)
    assert (listed["FRIENDS"]["uses"], listed["FRIENDS"]["max_uses"]) == (0, None)


def test_the_dashboard_shows_which_code_a_booking_used(conn, organizer, promo):
    promo()
    reserve(conn, 1, "NOVA20")
    row = logic.dashboard(conn, organizer, NOW)["reservations"][0]
    assert (row["promo_code"], row["list_price_cents"], row["amount_cents"]) == ("NOVA20", 800, 640)


# ------------------------------------------------------------------ upgrading an existing database

def test_a_database_from_before_promo_codes_is_upgraded(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE reservations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT NOT NULL,
            last_name TEXT NOT NULL, email TEXT NOT NULL, category TEXT NOT NULL, amount_cents INTEGER NOT NULL,
            pricing_tier TEXT, status TEXT NOT NULL, reserved_until TEXT NOT NULL, created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL, claimed_at TEXT, paid_at TEXT, rejected_at TEXT, expired_at TEXT,
            confirmed_by_access_id TEXT, checked_in_at TEXT, checked_in_by_access_id TEXT,
            qr_token_hash TEXT UNIQUE, qr_created_at TEXT, ticket_issued_at TEXT,
            ticket_issue_attempts INTEGER NOT NULL DEFAULT 0, ticket_issue_error TEXT);
        INSERT INTO reservations (id, event_id, first_name, last_name, email, category, amount_cents, status,
            reserved_until, created_at, updated_at)
        VALUES ('r1', 'e1', 'Old', 'Row', 'old@example.test', 'WOMEN', 800, 'PAID', 'x', 'x', 'x');
    """)
    old.close()
    conn = db.connect(path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(reservations)")}
    assert {"promo_code_id", "list_price_cents"} <= columns
    assert db.get_reservation(conn, "r1")["amount_cents"] == 800  # existing data untouched
    conn.close()
    db.connect(path).close()  # upgrading twice is harmless
