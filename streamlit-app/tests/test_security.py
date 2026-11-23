"""Security hardening before submission (see specs/security-hardening.md)."""

from datetime import timedelta

import pytest

import display
import logic
import seed
from conftest import NOW

ATTACK_NAMES = [
    "[Payment problem, click here](https://evil.example)",
    "![](https://evil.example/x.png)",
    "<img src=https://evil.example/x.png>",
    "**Bold** _italic_ `code` # heading",
    "<script>alert(1)</script>",
    "https://evil.example/pay",
    "www.evil.example",
    "help@evil.example",
]


# ------------------------------------------------------------------ 1. names are shown as plain text

@pytest.mark.parametrize("name", ATTACK_NAMES)
def test_text_for_html_screens_has_no_markup_left(name):
    import html
    import re
    shown = display.esc(name)
    outside_codes = re.sub(r"&#\d+;|&[a-z]+;|<span></span>", "", shown)  # codes like &#91; are safe
    for dangerous in ("<", ">", "[", "]", "(", ")", "!", "*", "_", "`", "#"):
        assert dangerous not in outside_codes, (name, shown)
    assert html.unescape(shown.replace("<span></span>", "")) == name  # the reader sees what was typed


@pytest.mark.parametrize("name", ATTACK_NAMES)
def test_text_for_markdown_screens_has_every_symbol_escaped(name):
    shown = display.md(name)
    for i, char in enumerate(shown):
        if char in "[]()!*_`#<>":
            assert i > 0 and shown[i - 1] == "\\", (name, shown)


def test_ordinary_names_are_unchanged_in_markdown():
    assert display.md("João Conceição") == "João Conceição"
    assert display.md("Ana-Rita O'Neil") == "Ana-Rita O'Neil"


@pytest.mark.parametrize("address", ["https://evil.example/pay", "HTTP://evil.example", "www.evil.example"])
def test_web_addresses_cannot_become_links_on_their_own(address):
    # Streamlit's Markdown links a bare https:// or www. address by itself, so both
    # functions break the pattern with something invisible.
    import re
    pattern = re.compile(r"https?:|www\.", re.IGNORECASE)
    assert not pattern.search(display.md(address))
    assert not pattern.search(display.esc(address))
    assert display.md(address).replace(display.WORD_JOINER, "") == address


# ------------------------------------------------------------------ 2. sign-in attempts are limited

def wrong(conn, source, at=NOW):
    with pytest.raises(logic.TubaraoError) as error:
        logic.login(conn, "not-the-right-code", at, source=source)
    return error.value.code


def test_five_wrong_codes_lock_that_source_even_for_the_right_code(conn, organizer):
    for _ in range(5):
        assert wrong(conn, "1.2.3.4") == "INVALID_ACCESS_CODE"
    with pytest.raises(logic.TubaraoError) as error:
        logic.login(conn, "organizer-code-1", NOW + timedelta(minutes=1), source="1.2.3.4")
    assert error.value.code == "TOO_MANY_ATTEMPTS"


def test_other_sources_can_still_sign_in(conn, organizer):
    for _ in range(5):
        wrong(conn, "1.2.3.4")
    assert logic.login(conn, "organizer-code-1", NOW, source="5.6.7.8")[1]["role"] == "SUPER_ADMIN"


def test_the_lock_lifts_15_minutes_after_the_fifth_failure(conn, organizer):
    for minute in range(5):
        wrong(conn, "1.2.3.4", at=NOW + timedelta(minutes=minute))
    fifth = NOW + timedelta(minutes=4)
    with pytest.raises(logic.TubaraoError):
        logic.login(conn, "organizer-code-1", fifth + timedelta(minutes=14), source="1.2.3.4")
    assert logic.login(conn, "organizer-code-1", fifth + timedelta(minutes=15, seconds=1), source="1.2.3.4")


def test_four_failures_are_not_enough_to_lock(conn, organizer):
    for _ in range(4):
        wrong(conn, "1.2.3.4")
    assert logic.login(conn, "organizer-code-1", NOW, source="1.2.3.4")


def test_success_clears_the_count(conn, organizer):
    for _ in range(4):
        wrong(conn, "1.2.3.4")
    logic.login(conn, "organizer-code-1", NOW, source="1.2.3.4")
    for _ in range(4):
        assert wrong(conn, "1.2.3.4") == "INVALID_ACCESS_CODE"  # counting starts again


def test_old_failures_stop_counting(conn, organizer):
    for _ in range(4):
        wrong(conn, "1.2.3.4", at=NOW - timedelta(minutes=30))
    wrong(conn, "1.2.3.4")
    assert logic.login(conn, "organizer-code-1", NOW, source="1.2.3.4")


def test_the_source_is_stored_only_as_a_fingerprint(conn, organizer):
    wrong(conn, "1.2.3.4")
    stored = conn.execute("SELECT * FROM login_failures").fetchall()
    assert stored and "1.2.3.4" not in str([tuple(row) for row in stored])


def test_the_lock_message_says_to_wait():
    assert "15 minutes" in logic.MESSAGES["TOO_MANY_ATTEMPTS"]


# ------------------------------------------------------------------ 3. stronger codes

def test_new_and_reset_codes_need_ten_characters(conn, organizer, door):
    for call in (lambda: logic.create_access_account(conn, "Phone", "ADMIN", "nine-char"),
                 lambda: logic.add_staff_account(conn, organizer, "Phone", "ADMIN", "nine-char", NOW),
                 lambda: logic.reset_staff_code(conn, organizer, door["account_id"], "nine-char", NOW)):
        with pytest.raises(logic.TubaraoError) as error:
            call()
        assert error.value.code == "INVALID_INPUT" and "10 characters" in error.value.message
    assert logic.add_staff_account(conn, organizer, "Phone", "ADMIN", "ten-chars!", NOW)


def test_seed_refuses_codes_under_ten_characters(conn):
    with pytest.raises(seed.SetupError):
        seed.seed(conn, "nine-char", "door-code-1234")


def test_generated_codes_have_sixteen_random_characters():
    organizer, door = seed.generate_codes()
    assert organizer.startswith("org-") and door.startswith("door-")
    assert len(organizer.removeprefix("org-")) == 16 and len(door.removeprefix("door-")) == 16
    assert seed.generate_codes() != (organizer, door)
