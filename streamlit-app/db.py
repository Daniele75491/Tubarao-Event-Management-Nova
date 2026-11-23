"""db.py — where Tubarão stores and loads its data.

Everything the app remembers lives in one SQLite database file
(data/tubarao.db). SQLite is a small database that is just a file on disk,
so there is nothing to install or sign up for.

This file only knows how to save and read rows. The rules about what is
allowed (capacity, prices, who may confirm a payment...) live in logic.py.

Tables
------
events                          one row per party
reservations                    one row per guest booking (paid or not)
non_paying_attendees            residents and invited guests (no ticket, no revenue)
admin_access_accounts           staff access codes (stored only as salted hashes)
admin_sessions                  who is signed in (stored only as hashes)
reservation_amount_adjustments  private history of manual price corrections
promo_codes                     discount codes the organizer creates for an event
login_failures                  recent wrong access codes, per source fingerprint (to limit guessing)
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

APP_DIR = Path(__file__).parent
DATA_DIR = APP_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "tubarao.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    starts_at TEXT,
    physical_capacity INTEGER NOT NULL,
    men_paid_cap INTEGER NOT NULL,
    early_price_cents INTEGER NOT NULL,
    late_price_cents INTEGER NOT NULL,
    early_price_ends_at TEXT,
    pricing_mode TEXT NOT NULL DEFAULT 'AUTO',
    show_pricing_countdown INTEGER NOT NULL DEFAULT 0,
    show_late_price_before_start INTEGER NOT NULL DEFAULT 0,
    reservation_minutes INTEGER NOT NULL,
    claim_hold_hours INTEGER NOT NULL,
    sales_mode TEXT NOT NULL,
    sales_open_at TEXT,
    sales_close_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('MEN', 'WOMEN')),
    amount_cents INTEGER NOT NULL,
    pricing_tier TEXT CHECK (pricing_tier IS NULL OR pricing_tier IN ('EARLY', 'LATE')),
    status TEXT NOT NULL CHECK (status IN
        ('RESERVED', 'PAYMENT_CLAIMED', 'PAID', 'REJECTED', 'EXPIRED', 'CANCELLED')),
    reserved_until TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    claimed_at TEXT,
    paid_at TEXT,
    rejected_at TEXT,
    expired_at TEXT,
    confirmed_by_access_id TEXT,
    checked_in_at TEXT,
    checked_in_by_access_id TEXT,
    qr_token_hash TEXT UNIQUE,
    qr_created_at TEXT,
    ticket_issued_at TEXT,
    ticket_issue_attempts INTEGER NOT NULL DEFAULT 0,
    ticket_issue_error TEXT
);

-- One live booking per email per event. Expired or rejected bookings do not block.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_email_per_event
    ON reservations(event_id, email)
    WHERE status IN ('RESERVED', 'PAYMENT_CLAIMED', 'PAID');

CREATE TABLE IF NOT EXISTS non_paying_attendees (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    category TEXT NOT NULL CHECK (category IN ('MEN', 'WOMEN')),
    checked_in_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_access_accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SUPER_ADMIN')),
    code_salt TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES admin_access_accounts(id),
    session_token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS promo_codes (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id),
    code TEXT NOT NULL,
    percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 90),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- A code is unique within its event (codes are always saved in capitals).
CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_one_code_per_event ON promo_codes(event_id, code);

-- Wrong access codes, to limit guessing. Only a fingerprint (hash) of the source is kept.
CREATE TABLE IF NOT EXISTS login_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_hash TEXT NOT NULL,
    failed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_by_source ON login_failures(source_hash, failed_at);

-- Deliberately no foreign key: the history must survive deleting the reservation.
CREATE TABLE IF NOT EXISTS reservation_amount_adjustments (
    id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL,
    previous_amount_cents INTEGER NOT NULL,
    new_amount_cents INTEGER NOT NULL,
    adjusted_at TEXT NOT NULL,
    adjusted_by_access_id TEXT NOT NULL REFERENCES admin_access_accounts(id)
);
"""


# Columns added after the first version. connect() adds any that an older database file is missing,
# so nobody has to delete their data/tubarao.db when the app gets a new feature.
ADDED_COLUMNS = {
    "reservations": {
        "promo_code_id": "TEXT",        # the promo code this booking used, if any
        "promo_code": "TEXT",           # that code's text, e.g. NOVA20 (codes never change once created)
        "list_price_cents": "INTEGER",  # the EARLY/LATE price before any promo discount
    },
}


def upgrade(conn: sqlite3.Connection) -> None:
    for table, columns in ADDED_COLUMNS.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, kind in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {kind}")


def db_path() -> Path:
    """The database file. Tests and deployments can point elsewhere with TUBARAO_DB."""
    return Path(os.environ.get("TUBARAO_DB", DEFAULT_DB_PATH))


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    """Open the database and make sure every table exists."""
    path = Path(path) if path is not None else db_path()
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    # isolation_level=None lets us start transactions ourselves (see `transaction`).
    conn = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")  # readers never wait for a writer
    conn.executescript(SCHEMA)
    upgrade(conn)
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection):
    """Run several reads and writes as one all-or-nothing step.

    BEGIN IMMEDIATE takes the database write lock straight away, so two staff
    phones (or two guests grabbing the last ticket) can never both pass a
    capacity check at the same moment. If anything fails, every change in the
    block is undone.
    """
    if conn.in_transaction:  # already inside a transaction: just join it
        yield conn
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


# ---------------------------------------------------------------- generic helpers

def _dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


def fetch_one(conn, sql: str, params: tuple = ()) -> dict | None:
    return _dict(conn.execute(sql, params).fetchone())


def fetch_all(conn, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def insert(conn, table: str, values: dict) -> None:
    columns = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(values.values()))


def update(conn, table: str, row_id: str, values: dict) -> None:
    if not values:
        return
    assignments = ", ".join(f"{key} = ?" for key in values)
    conn.execute(f"UPDATE {table} SET {assignments} WHERE id = ?", (*values.values(), row_id))


# ---------------------------------------------------------------- events

def all_events(conn) -> list[dict]:
    return fetch_all(conn, "SELECT * FROM events ORDER BY created_at DESC, id DESC")


def get_event(conn, event_id: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM events WHERE id = ?", (event_id,))


def active_events(conn) -> list[dict]:
    return fetch_all(conn, "SELECT * FROM events WHERE is_active = 1 ORDER BY created_at DESC, id DESC")


# ---------------------------------------------------------------- reservations

def get_reservation(conn, reservation_id: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM reservations WHERE id = ?", (reservation_id,))


def reservations_for_event(conn, event_id: str) -> list[dict]:
    return fetch_all(conn, "SELECT * FROM reservations WHERE event_id = ? ORDER BY created_at, id", (event_id,))


def reservation_by_qr_hash(conn, token_hash: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM reservations WHERE qr_token_hash = ?", (token_hash,))


def delete_reservation_row(conn, reservation_id: str) -> None:
    conn.execute("DELETE FROM reservations WHERE id = ?", (reservation_id,))


# ---------------------------------------------------------------- non-paying attendees

def non_paying_for_event(conn, event_id: str) -> list[dict]:
    return fetch_all(
        conn, "SELECT * FROM non_paying_attendees WHERE event_id = ? ORDER BY last_name, first_name, id", (event_id,)
    )


def get_non_paying(conn, attendee_id: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM non_paying_attendees WHERE id = ?", (attendee_id,))


def delete_non_paying_row(conn, attendee_id: str) -> None:
    conn.execute("DELETE FROM non_paying_attendees WHERE id = ?", (attendee_id,))


# ---------------------------------------------------------------- staff access

def active_accounts(conn) -> list[dict]:
    return fetch_all(conn, "SELECT * FROM admin_access_accounts WHERE is_active = 1")


def get_account(conn, account_id: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM admin_access_accounts WHERE id = ?", (account_id,))


def session_by_token_hash(conn, token_hash: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM admin_sessions WHERE session_token_hash = ?", (token_hash,))


def promo_codes_for_event(conn, event_id: str) -> list[dict]:
    return fetch_all(conn, "SELECT * FROM promo_codes WHERE event_id = ? ORDER BY created_at, code", (event_id,))


def promo_code_by_code(conn, event_id: str, code: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM promo_codes WHERE event_id = ? AND code = ?", (event_id, code))


def get_promo_code(conn, code_id: str) -> dict | None:
    return fetch_one(conn, "SELECT * FROM promo_codes WHERE id = ?", (code_id,))


def amount_adjustments(conn, reservation_id: str) -> list[dict]:
    return fetch_all(
        conn,
        "SELECT * FROM reservation_amount_adjustments WHERE reservation_id = ? ORDER BY adjusted_at",
        (reservation_id,),
    )


# ---------------------------------------------------------------- ticket secret

def ticket_secret() -> str:
    """The private key that signs QR tickets.

    It must stay the same for as long as the tickets are in use, otherwise old
    QR codes stop matching. Set TUBARAO_TICKET_SECRET, or let the app create
    data/ticket_secret.txt once, next to the database (never committed to Git).
    """
    from_env = os.environ.get("TUBARAO_TICKET_SECRET")
    if from_env:
        return from_env
    secret_path = db_path().parent / "ticket_secret.txt"
    if secret_path.exists():
        return secret_path.read_text(encoding="utf-8").strip()
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    value = secrets.token_urlsafe(48)
    secret_path.write_text(value, encoding="utf-8")
    return value
