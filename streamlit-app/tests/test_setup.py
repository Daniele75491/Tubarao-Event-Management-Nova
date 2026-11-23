"""Fix 2: first-time setup and seed.py are all-or-nothing, check both codes first, and never lose data by accident."""

import os

import pytest

import db
import logic
import seed

GOOD_ORGANIZER, GOOD_DOOR = "organizer-code-1", "door-code-1234"


def table_counts(conn) -> dict:
    tables = ("events", "reservations", "non_paying_attendees", "admin_access_accounts", "admin_sessions")
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}


def is_empty(conn) -> bool:
    return not any(table_counts(conn).values())


# ------------------------------------------------------------------ checking the codes first

@pytest.mark.parametrize("organizer,door", [
    ("short", GOOD_DOOR),             # organizer code under 8 characters
    (GOOD_ORGANIZER, "short"),        # door code under 8 characters
    ("same-code-123", "same-code-123"),  # identical codes: sign-in could not tell them apart
    ("", GOOD_DOOR),
    (None, GOOD_DOOR),
])
def test_bad_codes_write_nothing(conn, organizer, door):
    with pytest.raises(seed.SetupError):
        seed.seed(conn, organizer, door)
    assert is_empty(conn)


def test_codes_are_compared_without_surrounding_spaces(conn):
    with pytest.raises(seed.SetupError):
        seed.seed(conn, "same-code-123", "  same-code-123 ")
    assert is_empty(conn)


# ------------------------------------------------------------------ all or nothing

def test_a_failure_partway_through_leaves_the_database_empty(conn, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("simulated failure while adding residents")
    monkeypatch.setattr(logic, "add_non_paying", broken)
    with pytest.raises(RuntimeError):
        seed.seed(conn, GOOD_ORGANIZER, GOOD_DOOR)
    assert is_empty(conn)


def test_setup_refuses_a_database_that_already_has_data(conn):
    seed.seed(conn, GOOD_ORGANIZER, GOOD_DOOR)
    before = table_counts(conn)
    with pytest.raises(seed.SetupError):
        seed.seed(conn, "other-organizer-1", "other-door-1234")
    assert table_counts(conn) == before


def test_setup_creates_everything_when_it_succeeds(conn):
    seed.seed(conn, GOOD_ORGANIZER, GOOD_DOOR)
    counts = table_counts(conn)
    assert counts["admin_access_accounts"] == 2 and counts["events"] == 2 and counts["reservations"] > 0
    assert logic.login(conn, GOOD_DOOR, logic.utcnow())[1]["role"] == "ADMIN"


# ------------------------------------------------------------------ first start of a hosted copy

def test_first_start_sets_up_an_empty_database(conn):
    assert seed.bootstrap_if_empty(conn, GOOD_ORGANIZER, GOOD_DOOR) is None
    assert table_counts(conn)["admin_access_accounts"] == 2


def test_first_start_skips_a_database_that_has_data(conn):
    seed.seed(conn, GOOD_ORGANIZER, GOOD_DOOR)
    before = table_counts(conn)
    assert seed.bootstrap_if_empty(conn, "other-organizer-1", "other-door-1234") is None
    assert table_counts(conn) == before


def test_first_start_without_codes_does_nothing(conn):
    assert seed.bootstrap_if_empty(conn, None, None) is None
    assert is_empty(conn)


def test_first_start_with_bad_codes_reports_why_and_writes_nothing(conn):
    message = seed.bootstrap_if_empty(conn, "same-code-123", "same-code-123")
    assert "different" in message
    assert is_empty(conn)


def test_first_start_retries_after_a_failure(conn, monkeypatch):
    original = logic.add_non_paying
    monkeypatch.setattr(logic, "add_non_paying", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert "boom" in seed.bootstrap_if_empty(conn, GOOD_ORGANIZER, GOOD_DOOR)
    assert is_empty(conn)
    monkeypatch.setattr(logic, "add_non_paying", original)
    assert seed.bootstrap_if_empty(conn, GOOD_ORGANIZER, GOOD_DOOR) is None
    assert table_counts(conn)["admin_access_accounts"] == 2


# ------------------------------------------------------------------ the seed.py command

@pytest.fixture
def db_file(tmp_path, monkeypatch):
    path = tmp_path / "tubarao.db"
    monkeypatch.setenv("TUBARAO_DB", str(path))
    monkeypatch.setenv("TUBARAO_ORGANIZER_CODE", GOOD_ORGANIZER)
    monkeypatch.setenv("TUBARAO_DOOR_CODE", GOOD_DOOR)
    monkeypatch.delenv("TUBARAO_TICKET_SECRET", raising=False)
    return path


def existing_database(path):
    conn = db.connect(path)
    seed.seed(conn, "old-organizer-1", "old-door-12345")
    marker = logic.reserve(conn, "Keep", "Me", "keep@example.test", "WOMEN", logic.utcnow())
    conn.close()
    return marker["reservation_id"]


def still_has(path, reservation_id) -> bool:
    conn = db.connect(path)
    try:
        return db.get_reservation(conn, reservation_id) is not None
    finally:
        conn.close()


def test_seed_creates_a_new_database(db_file):
    seed.main(["--yes"])
    conn = db.connect(db_file)
    assert logic.login(conn, GOOD_ORGANIZER, logic.utcnow())[1]["role"] == "SUPER_ADMIN"
    conn.close()
    assert (db_file.parent / "ACCESS_CODES.txt").exists()


def test_seed_asks_before_replacing_and_keeps_data_when_told_no(db_file, monkeypatch):
    kept = existing_database(db_file)
    monkeypatch.setattr("builtins.input", lambda prompt: "n")
    with pytest.raises(SystemExit) as exit_:
        seed.main([])
    assert exit_.value.code == 1
    assert still_has(db_file, kept)


def test_seed_replaces_when_told_yes(db_file, monkeypatch):
    kept = existing_database(db_file)
    monkeypatch.setattr("builtins.input", lambda prompt: "y")
    seed.main([])
    assert not still_has(db_file, kept)


def test_bad_codes_stop_seed_before_touching_anything(db_file, monkeypatch):
    kept = existing_database(db_file)
    monkeypatch.setenv("TUBARAO_DOOR_CODE", GOOD_ORGANIZER)  # same as the organizer code
    with pytest.raises(SystemExit):
        seed.main(["--yes"])
    assert still_has(db_file, kept)


def test_a_failed_seed_leaves_the_old_database_untouched(db_file, monkeypatch):
    kept = existing_database(db_file)
    monkeypatch.setattr(logic, "add_non_paying", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(SystemExit):
        seed.main(["--yes"])
    assert still_has(db_file, kept)
    assert not [p for p in os.listdir(db_file.parent) if ".new" in p]  # no leftover half-built file


def test_a_locked_database_file_is_reported_not_destroyed(db_file, monkeypatch, capsys):
    kept = existing_database(db_file)

    def locked(src, dst):
        raise PermissionError("The process cannot access the file because it is being used by another process")
    monkeypatch.setattr(seed.os, "replace", locked)
    with pytest.raises(SystemExit):
        seed.main(["--yes"])
    assert "Stop the app" in capsys.readouterr().out
    assert still_has(db_file, kept)
    assert not [p for p in os.listdir(db_file.parent) if ".new" in p]
