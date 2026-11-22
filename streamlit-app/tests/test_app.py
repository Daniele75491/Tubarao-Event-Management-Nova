"""Screen tests: open each Streamlit screen like a browser would and press its buttons.

These use Streamlit's built-in AppTest, so no browser is needed.
"""

import os
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

import db
import logic
import seed

ROOT = Path(__file__).resolve().parent.parent
HARNESS = "import sys\nsys.path.insert(0, {root!r})\nimport app\n{setup}\napp.main({page!r})\n"
ORGANIZER_CODE, DOOR_CODE = "organizer-code-1", "door-code-1234"
# Seconds a screen may take to load. The very first one in a run loads Streamlit, pandas and
# the QR libraries from scratch, which can take over 30 seconds on a Windows laptop.
SCREEN_TIMEOUT = 120


@pytest.fixture
def demo_db(tmp_path, monkeypatch):
    path = tmp_path / "tubarao.db"
    monkeypatch.setenv("TUBARAO_DB", str(path))
    monkeypatch.delenv("TUBARAO_TICKET_SECRET", raising=False)
    conn = db.connect(path)
    seed.seed(conn, ORGANIZER_CODE, DOOR_CODE)
    yield conn
    conn.close()


def open_screen(page: str, setup: str = "", query: dict | None = None) -> AppTest:
    """Open one screen. `setup` runs before the app starts; `query` fills the page address."""
    at = AppTest.from_string(HARNESS.format(root=str(ROOT), page=page, setup=setup),
                               default_timeout=SCREEN_TIMEOUT)
    for key, value in (query or {}).items():
        at.query_params[key] = value
    return at.run()


def sign_in(at: AppTest, code: str) -> AppTest:
    [field for field in at.text_input if field.label == "Access code"][0].input(code)
    [button for button in at.button if button.label == "ENTER"][0].click()
    return at.run()


def button(at: AppTest, label: str):
    return [b for b in at.button if b.label == label][0]


def no_errors(at: AppTest) -> None:
    assert not at.exception, [e.value for e in at.exception]


def test_public_page_unlocks_tickets_after_the_follow_step(demo_db):
    at = open_screen("tickets")
    no_errors(at)
    tickets = [b for b in at.button if b.label == "GET TICKET →"]
    assert len(tickets) == 2 and all(b.disabled for b in tickets)
    at.checkbox[0].check().run()
    assert not any(b.disabled for b in at.button if b.label == "GET TICKET →")


def test_a_guest_can_reserve_and_claim(demo_db):
    at = open_screen("tickets")
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    at.text_input[0].input("Zara")
    at.text_input[1].input("Screen")
    at.text_input[2].input("zara@example.test")
    at.checkbox[0].check()
    button(at, "RESERVE MY SPOT").click().run()
    no_errors(at)
    assert any("YOUR SPOT IS RESERVED" in m.value for m in at.markdown)
    [b for b in at.button if b.label.startswith("SIMULATE")][0].click().run()
    assert any("DEMO PAYMENT CLAIMED" in m.value for m in at.markdown)


def test_the_category_must_be_confirmed_before_reserving(demo_db):
    at = open_screen("tickets")
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    at.text_input[0].input("Zara")
    at.text_input[1].input("Screen")
    at.text_input[2].input("zara@example.test")
    button(at, "RESERVE MY SPOT").click().run()
    assert any("Confirm your ticket category" in e.value for e in at.error)


def test_staff_screens_ask_for_an_access_code(demo_db):
    for page in ("organizer", "door"):
        at = open_screen(page)
        no_errors(at)
        assert any(field.label == "Access code" for field in at.text_input)


def test_a_wrong_access_code_is_refused(demo_db):
    at = sign_in(open_screen("organizer"), "not-the-code")
    assert any("INVALID ACCESS CODE" in e.value for e in at.error)


def test_the_organizer_dashboard_shows_the_numbers(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    no_errors(at)
    metrics = {m.label: m.value for m in at.metric}
    assert metrics["PAID ATTENDEES"] == "3" and metrics["NON-PAYING ATTENDEES"] == "4"
    assert metrics["REVENUE"] == "€24.00"


def test_a_door_account_cannot_see_the_dashboard(demo_db):
    at = sign_in(open_screen("organizer"), DOOR_CODE)
    no_errors(at)
    assert not at.metric
    assert any("door account" in i.value for i in at.info)


def test_the_organizer_can_save_event_settings(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    name = [f for f in at.text_input if f.label == "Event name"][0]
    name.input("Renamed Party")
    button(at, "SAVE EVENT").click().run()
    no_errors(at)
    assert logic.current_event(demo_db)["name"] == "Renamed Party"


def test_the_organizer_can_add_a_non_paying_attendee(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    # The paying-attendee filters also say "First name"; the add form's fields come last.
    form_fields = [f for f in at.text_input if f.label in ("First name", "Last name")][-2:]
    form_fields[0].input("Nova")
    form_fields[1].input("Guest")
    button(at, "ADD NON-PAYING ATTENDEE").click().run()
    no_errors(at)
    event = logic.current_event(demo_db)
    assert "Nova" in [p["first_name"] for p in db.non_paying_for_event(demo_db, event["id"])]


def test_the_organizer_can_create_an_inactive_event(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    [f for f in at.text_input if f.label == "Event name"][-1].input("Spring Party")
    button(at, "CREATE EVENT").click().run()
    no_errors(at)
    created = [e for e in db.all_events(demo_db) if e["name"] == "Spring Party"]
    assert created and not created[0]["is_active"]


def test_the_door_can_check_in_by_pasting_a_ticket_code(demo_db):
    import tickets
    event = logic.current_event(demo_db)
    row = [r for r in db.reservations_for_event(demo_db, event["id"]) if r["first_name"] == "Bruno"][0]
    payload = tickets.ticket_payload(tickets.derive_ticket_token(row["id"], row["event_id"], db.ticket_secret()))
    at = sign_in(open_screen("door"), DOOR_CODE)
    no_errors(at)
    [f for f in at.text_input if f.label.startswith("…or paste")][0].input(payload)
    button(at, "CHECK CODE").click().run()
    no_errors(at)
    assert any("CHECKED IN" in m.value and "Bruno" in m.value for m in at.markdown)


def test_the_door_can_find_and_check_in_a_guest_by_name(demo_db):
    at = sign_in(open_screen("door"), DOOR_CODE)
    [f for f in at.text_input if f.label.startswith("Search by")][0].input("Carla").run()
    button(at, "CHECK IN").click().run()
    no_errors(at)
    assert any("CHECKED IN" in m.value and "Carla" in m.value for m in at.markdown)


def test_the_privacy_notice_opens(demo_db):
    at = open_screen("privacy")
    no_errors(at)
    assert any("Privacy notice" in m.value for m in at.markdown)


def test_an_empty_database_explains_how_to_get_started(tmp_path, monkeypatch):
    monkeypatch.setenv("TUBARAO_DB", str(tmp_path / "empty.db"))
    for key in ("TUBARAO_ORGANIZER_CODE", "TUBARAO_DOOR_CODE"):
        monkeypatch.delenv(key, raising=False)
    at = open_screen("organizer")
    no_errors(at)
    assert any("seed.py" in w.value for w in at.warning)
    assert os.path.exists(tmp_path / "empty.db")


# ------------------------------------------------------------------ remembering a booking by its link

def reserve_on_screen(at: AppTest, email: str = "zara@example.test") -> AppTest:
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    at.text_input[0].input("Zara")
    at.text_input[1].input("Screen")
    at.text_input[2].input(email)
    at.checkbox[0].check()
    return button(at, "RESERVE MY SPOT").click().run()


def test_reserving_puts_the_booking_reference_in_the_address(demo_db):
    at = reserve_on_screen(open_screen("tickets"))
    reference = at.query_params.get("booking")
    reference = reference[0] if isinstance(reference, list) else reference
    assert reference and db.get_reservation(demo_db, reference)["email"] == "zara@example.test"


def test_opening_the_address_again_shows_the_booking(demo_db):
    booking = logic.reserve(demo_db, "Zara", "Link", "zara@example.test", "WOMEN", logic.utcnow())
    at = open_screen("tickets", query={"booking": booking["reservation_id"]})
    no_errors(at)
    assert any("YOUR SPOT IS RESERVED" in m.value for m in at.markdown)
    assert not any("Zara" in m.value or "zara@example.test" in m.value for m in at.markdown)


def test_claiming_from_a_reopened_link_needs_the_right_email(demo_db):
    booking = logic.reserve(demo_db, "Zara", "Link", "zara@example.test", "WOMEN", logic.utcnow())
    at = open_screen("tickets", query={"booking": booking["reservation_id"]})
    email = [f for f in at.text_input if f.label.startswith("Your email")][0]
    email.input("someone.else@example.test")
    [b for b in at.button if b.label.startswith("SIMULATE")][0].click().run()
    assert any("Reservation not found" in e.value for e in at.error)
    assert db.get_reservation(demo_db, booking["reservation_id"])["status"] == "RESERVED"
    [f for f in at.text_input if f.label.startswith("Your email")][0].input("zara@example.test")
    [b for b in at.button if b.label.startswith("SIMULATE")][0].click().run()
    no_errors(at)
    assert db.get_reservation(demo_db, booking["reservation_id"])["status"] == "PAYMENT_CLAIMED"


def test_an_unknown_reference_in_the_address_falls_back_to_the_event_page(demo_db):
    at = open_screen("tickets", query={"booking": "not-a-reference"})
    no_errors(at)
    assert any("Reservation not found" in e.value for e in at.error)
    assert any(b.label == "GET TICKET →" for b in at.button)


# ------------------------------------------------------------------ hero video

def test_the_landing_page_plays_the_hero_video_and_checkout_shows_the_logo(demo_db):
    at = open_screen("tickets")
    assert len(at.get("video")) == 1 and len(at.get("image")) == 0
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    assert len(at.get("video")) == 0 and len(at.get("image")) == 1


def test_without_the_video_file_the_logo_is_shown(demo_db):
    at = open_screen("tickets", setup="from pathlib import Path\napp.HERO_VIDEO = Path('missing.mp4')")
    no_errors(at)
    assert len(at.get("video")) == 0 and len(at.get("image")) == 1


# ------------------------------------------------------------------ non-paying check-in at the door

def test_the_door_can_check_in_a_resident_by_name(demo_db):
    at = sign_in(open_screen("door"), DOOR_CODE)
    [f for f in at.text_input if f.label.startswith("Search by")][0].input("Marta").run()
    assert any("NON-PAYING" in m.value for m in at.markdown)
    button(at, "CHECK IN").click().run()
    no_errors(at)
    assert any("CHECKED IN" in m.value and "Marta" in m.value for m in at.markdown)
    event = logic.current_event(demo_db)
    marta = [p for p in db.non_paying_for_event(demo_db, event["id"]) if p["first_name"] == "Marta"][0]
    assert marta["checked_in_at"]


# ------------------------------------------------------------------ dashboard charts

def test_the_organizer_sees_the_three_charts(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    no_errors(at)
    assert any("Charts" in m.value for m in at.markdown)
    assert len(at.get("vega_lite_chart")) == 3


def test_the_door_account_sees_no_charts(demo_db):
    at = sign_in(open_screen("organizer"), DOOR_CODE)
    assert len(at.get("vega_lite_chart")) == 0


# ------------------------------------------------------------------ promo codes

def checkout_with_code(at: AppTest, code: str, email: str = "promo@example.test") -> AppTest:
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    fields = {f.label: f for f in at.text_input}
    fields["First name"].input("Pia")
    fields["Last name"].input("Promo")
    fields["Email"].input(email)
    fields["Promo code (optional)"].input(code)
    at.checkbox[0].check()
    return button(at, "RESERVE MY SPOT").click().run()


def test_a_guest_books_with_a_promo_code_and_sees_the_discount(demo_db):
    organizer = [a for a in db.active_accounts(demo_db) if a["role"] == "SUPER_ADMIN"][0]
    admin = {"account_id": organizer["id"], "label": "Organizer", "role": "SUPER_ADMIN"}
    logic.create_promo_code(demo_db, admin, logic.current_event(demo_db)["id"], "NOVA20", 20, None, None,
                            logic.utcnow())
    at = checkout_with_code(open_screen("tickets"), "nova20")
    no_errors(at)
    assert any("YOUR SPOT IS RESERVED" in m.value for m in at.markdown)
    assert any("NOVA20" in m.value and "€6.40" in m.value for m in at.markdown)


def test_a_wrong_promo_code_shows_why_and_makes_no_booking(demo_db):
    at = checkout_with_code(open_screen("tickets"), "NOPE")
    assert any("This promo code doesn't exist." in e.value for e in at.error)
    assert not any("YOUR SPOT IS RESERVED" in m.value for m in at.markdown)
    assert demo_db.execute("SELECT COUNT(*) FROM reservations WHERE email = 'promo@example.test'").fetchone()[0] == 0


def test_the_organizer_creates_a_promo_code_from_the_dashboard(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    [f for f in at.text_input if f.label == "Code"][0].input("friends10")
    [f for f in at.number_input if f.label == "Percent off"][0].set_value(10)
    button(at, "CREATE CODE").click().run()
    no_errors(at)
    admin = [a for a in db.active_accounts(demo_db) if a["role"] == "SUPER_ADMIN"][0]
    codes = logic.promo_codes(demo_db, {"account_id": admin["id"], "role": "SUPER_ADMIN"}, logic.utcnow())
    assert [(c["code"], c["percent_off"]) for c in codes] == [("FRIENDS10", 10)]


def test_a_refused_promo_code_keeps_what_the_organizer_typed(demo_db):
    at = sign_in(open_screen("organizer"), ORGANIZER_CODE)
    [f for f in at.text_input if f.label == "Code"][0].input("no spaces")
    button(at, "CREATE CODE").click().run()
    assert any("3 to 20 letters" in e.value for e in at.error)
    assert [f for f in at.text_input if f.label == "Code"][0].value == "no spaces"
