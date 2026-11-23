"""Staff management: the organizer adds, deactivates and resets staff accounts (see specs/staff-management.md)."""

import pytest

import logic
from conftest import NOW


def sign_in(conn, code):
    return logic.login(conn, code, NOW)


def error_code(call) -> str:
    with pytest.raises(logic.TubaraoError) as error:
        call()
    return error.value.code


# ------------------------------------------------------------------ listing

def test_the_list_shows_accounts_but_never_codes_or_hashes(conn, organizer, door):
    accounts = logic.staff_accounts(conn, organizer)
    assert {(a["label"], a["role"], a["is_active"]) for a in accounts} == {
        ("Organizer", "SUPER_ADMIN", 1), ("Door phone", "ADMIN", 1)}
    assert not any(key in str(accounts) for key in ("code_hash", "code_salt", "organizer-code-1"))


def test_the_list_shows_the_last_sign_in(conn, organizer, door):
    sign_in(conn, "door-code-1234")
    door_row = [a for a in logic.staff_accounts(conn, organizer) if a["role"] == "ADMIN"][0]
    assert door_row["last_login_at"] == logic.to_iso(NOW)


# ------------------------------------------------------------------ adding

def test_a_new_door_account_can_sign_in(conn, organizer):
    new_id = logic.add_staff_account(conn, organizer, "Door phone 2", "ADMIN", "second-door-code", NOW)
    _token, identity = sign_in(conn, "second-door-code")
    assert (identity["account_id"], identity["role"], identity["label"]) == (new_id, "ADMIN", "Door phone 2")


@pytest.mark.parametrize("label,role,code", [
    ("", "ADMIN", "long-enough-code"),          # no name
    ("A" * 101, "ADMIN", "long-enough-code"),   # name too long
    ("Phone", "OWNER", "long-enough-code"),     # unknown role
    ("Phone", "ADMIN", "short"),                # code under 8 characters
])
def test_invalid_accounts_are_refused(conn, organizer, label, role, code):
    assert error_code(lambda: logic.add_staff_account(conn, organizer, label, role, code, NOW)) == "INVALID_INPUT"


def test_a_code_used_by_another_active_account_is_refused(conn, organizer, door):
    assert error_code(lambda: logic.add_staff_account(conn, organizer, "Copy", "ADMIN", "door-code-1234", NOW)) \
        == "CODE_IN_USE"


# ------------------------------------------------------------------ deactivating and activating

def test_a_deactivated_account_is_signed_out_and_cannot_sign_in(conn, organizer, door):
    token, _ = sign_in(conn, "door-code-1234")
    logic.set_staff_active(conn, organizer, door["account_id"], False, NOW)
    assert logic.session_identity(conn, token, NOW) is None
    assert error_code(lambda: sign_in(conn, "door-code-1234")) == "INVALID_ACCESS_CODE"


def test_an_activated_account_signs_in_with_its_old_code(conn, organizer, door):
    logic.set_staff_active(conn, organizer, door["account_id"], False, NOW)
    logic.set_staff_active(conn, organizer, door["account_id"], True, NOW)
    assert sign_in(conn, "door-code-1234")[1]["role"] == "ADMIN"


def test_a_deactivated_accounts_code_cannot_be_reused(conn, organizer, door):
    # Otherwise activating the old account again would give two active accounts the same code.
    logic.set_staff_active(conn, organizer, door["account_id"], False, NOW)
    assert error_code(lambda: logic.add_staff_account(conn, organizer, "Replacement", "ADMIN", "door-code-1234",
                                                      NOW)) == "CODE_IN_USE"


def test_you_cannot_deactivate_yourself(conn, organizer):
    assert error_code(lambda: logic.set_staff_active(conn, organizer, organizer["account_id"], False, NOW)) \
        == "CANNOT_CHANGE_SELF"


def test_an_unknown_account_is_refused(conn, organizer):
    assert error_code(lambda: logic.set_staff_active(conn, organizer, "nobody", False, NOW)) == "STAFF_NOT_FOUND"


# ------------------------------------------------------------------ resetting a code

def test_resetting_a_code_replaces_it_and_signs_the_account_out(conn, organizer, door):
    token, _ = sign_in(conn, "door-code-1234")
    logic.reset_staff_code(conn, organizer, door["account_id"], "brand-new-door-code", NOW)
    assert logic.session_identity(conn, token, NOW) is None
    assert error_code(lambda: sign_in(conn, "door-code-1234")) == "INVALID_ACCESS_CODE"
    assert sign_in(conn, "brand-new-door-code")[1]["account_id"] == door["account_id"]


def test_resetting_your_own_code_signs_you_out(conn, organizer):
    token, _ = sign_in(conn, "organizer-code-1")
    logic.reset_staff_code(conn, organizer, organizer["account_id"], "new-organizer-code", NOW)
    assert logic.session_identity(conn, token, NOW) is None
    assert sign_in(conn, "new-organizer-code")[1]["role"] == "SUPER_ADMIN"


def test_a_reset_code_must_be_long_enough_and_not_taken(conn, organizer, door):
    assert error_code(lambda: logic.reset_staff_code(conn, organizer, door["account_id"], "short", NOW)) \
        == "INVALID_INPUT"
    assert error_code(lambda: logic.reset_staff_code(conn, organizer, door["account_id"], "organizer-code-1", NOW)) \
        == "CODE_IN_USE"


def test_resetting_to_the_same_code_is_allowed(conn, organizer, door):
    logic.reset_staff_code(conn, organizer, door["account_id"], "door-code-1234", NOW)
    assert sign_in(conn, "door-code-1234")[1]["role"] == "ADMIN"


# ------------------------------------------------------------------ who may do it

def test_door_staff_and_signed_out_people_cannot_manage_staff(conn, organizer, door):
    for who, expected in ((door, "FORBIDDEN"), (None, "UNAUTHORIZED")):
        for call in (lambda: logic.staff_accounts(conn, who),
                     lambda: logic.add_staff_account(conn, who, "X", "ADMIN", "some-long-code", NOW),
                     lambda: logic.set_staff_active(conn, who, organizer["account_id"], False, NOW),
                     lambda: logic.reset_staff_code(conn, who, organizer["account_id"], "some-long-code", NOW)):
            assert error_code(call) == expected
