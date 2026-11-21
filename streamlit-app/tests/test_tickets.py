"""The QR ticket token: opaque, reproducible and readable by the scanner."""

import uuid

import pytest

import tickets
from conftest import SECRET

RESERVATION = str(uuid.UUID(int=1))
EVENT = str(uuid.UUID(int=2))


def test_the_token_is_always_the_same_for_the_same_ticket():
    assert tickets.derive_ticket_token(RESERVATION, EVENT, SECRET) == tickets.derive_ticket_token(RESERVATION, EVENT, SECRET)


def test_different_tickets_or_secrets_give_different_tokens():
    token = tickets.derive_ticket_token(RESERVATION, EVENT, SECRET)
    assert token != tickets.derive_ticket_token(EVENT, RESERVATION, SECRET)
    assert token != tickets.derive_ticket_token(RESERVATION, EVENT, SECRET + "x")


def test_the_qr_contains_only_the_prefix_and_an_opaque_token():
    token = tickets.derive_ticket_token(RESERVATION, EVENT, SECRET)
    payload = tickets.ticket_payload(token)
    assert payload.startswith("TUBARAO:") and len(token) == 43
    assert RESERVATION not in payload and EVENT not in payload


def test_only_the_hash_matches_the_token():
    token = tickets.derive_ticket_token(RESERVATION, EVENT, SECRET)
    stored = tickets.hash_ticket_token(token)
    assert len(stored) == 64 and token not in stored
    assert tickets.matches_token_hash(token, stored)
    assert not tickets.matches_token_hash(token, "0" * 64)
    assert not tickets.matches_token_hash(token, None)


def test_a_short_signing_secret_is_refused():
    with pytest.raises(ValueError):
        tickets.derive_ticket_token(RESERVATION, EVENT, "short")


@pytest.mark.parametrize("payload", [None, "", "hello", "TUBARAO:", "TUBARAO:short", "OTHER:" + "a" * 43,
                                     "TUBARAO:" + "a" * 42 + "!"])
def test_payloads_that_are_not_tubarao_tickets_are_ignored(payload):
    assert tickets.parse_payload(payload) is None


def test_the_png_qr_can_be_read_back_by_the_scanner():
    token = tickets.derive_ticket_token(RESERVATION, EVENT, SECRET)
    png = tickets.qr_png(token)
    assert png.startswith(b"\x89PNG")
    assert tickets.decode_qr_image(png) == "TUBARAO:" + token


def test_an_image_without_a_qr_returns_nothing():
    import io

    from PIL import Image
    buffer = io.BytesIO()
    Image.new("RGB", (200, 200), "white").save(buffer, format="PNG")
    assert tickets.decode_qr_image(buffer.getvalue()) is None
    assert tickets.decode_qr_image(b"not an image") is None
