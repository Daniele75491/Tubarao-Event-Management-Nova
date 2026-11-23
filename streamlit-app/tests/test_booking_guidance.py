"""'What's next?' guidance on the booking page, and the demo copy it must not contradict."""

import re
from pathlib import Path

import app
import logic
from test_app import button, demo_db, no_errors, open_screen  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
REAL_STATES = ("RESERVED", "PAYMENT_CLAIMED", "PAID", "EXPIRED", "REJECTED", "CANCELLED")


def test_each_status_has_its_own_guidance():
    texts = {s: app.next_step_guidance(s) for s in REAL_STATES}
    assert len(set(texts.values())) == len(REAL_STATES)
    assert "SIMULATE" in texts["RESERVED"]
    assert "admin" in texts["PAYMENT_CLAIMED"] and "Nothing more to do" in texts["PAYMENT_CLAIMED"]
    assert "QR" in texts["PAID"]
    assert "no longer valid" in texts["EXPIRED"] and "TRY AGAIN" in texts["EXPIRED"]
    assert "not accept" in texts["REJECTED"] and "TRY AGAIN" in texts["REJECTED"]


def test_guidance_covers_every_status_the_app_can_show():
    assert set(REAL_STATES) <= set(app.NEXT_STEPS)
    assert set(app.BOOKING_COPY) <= set(app.NEXT_STEPS)


def test_unexpected_status_gets_a_safe_fallback():
    for odd in ("", "WEIRD", None):
        assert "could not read the status" in app.next_step_guidance(odd)


def test_no_misleading_id_spam_or_email_promises():
    source = (ROOT / "app.py").read_text()
    assert "as on your id" not in source.lower()
    assert not re.search(r"spam|junk", source, re.I)
    for text in app.NEXT_STEPS.values():
        assert not re.search(r"email you|we.ll email|inbox|spam", text, re.I)


def test_booking_page_shows_guidance_for_the_real_status(demo_db):
    at = open_screen("tickets")
    at.checkbox[0].check().run()
    [b for b in at.button if b.label == "GET TICKET →"][0].click().run()
    at.text_input[0].input("Gui")
    at.text_input[1].input("Dance")
    at.text_input[2].input("gui@example.test")
    at.checkbox[0].check()
    button(at, "RESERVE MY SPOT").click().run()
    no_errors(at)
    assert any(app.next_step_guidance("RESERVED") in i.value for i in at.info)
    [b for b in at.button if b.label.startswith("SIMULATE")][0].click().run()
    assert any(app.next_step_guidance("PAYMENT_CLAIMED") in i.value for i in at.info)
    assert not any(app.next_step_guidance("RESERVED") in i.value for i in at.info)
