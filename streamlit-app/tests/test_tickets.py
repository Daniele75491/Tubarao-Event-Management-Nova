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


# ------------------------------------------------------------------ fix 5: every ticket QR scans

def _many_tokens(count=500):
    import random
    rng = random.Random(20261123)  # fixed, so the same 500 codes are checked every time
    return [tickets.derive_ticket_token(str(uuid.UUID(int=rng.getrandbits(128))),
                                        str(uuid.UUID(int=rng.getrandbits(128))), SECRET) for _ in range(count)]


def _png(image) -> bytes:
    import io
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _variants(png: bytes):
    """The ways a QR reaches the scanner: as issued, smaller, slightly turned, slightly blurred photo."""
    import io

    from PIL import Image, ImageFilter
    original = Image.open(io.BytesIO(png)).convert("RGB")
    half = original.resize((original.width // 2, original.height // 2))
    turned = original.rotate(7, expand=True, fillcolor="white")
    blurred = original.filter(ImageFilter.GaussianBlur(1.5))
    return {"as issued": png, "half size": _png(half), "turned": _png(turned), "blurred": _png(blurred)}


def test_every_generated_ticket_qr_scans_in_every_form():
    failures = {}
    for token in _many_tokens():
        for form, image in _variants(tickets.qr_png(token)).items():
            if tickets.decode_qr_image(image) != "TUBARAO:" + token:
                failures.setdefault(form, 0)
                failures[form] += 1
    assert failures == {}


def test_the_qr_image_for_a_ticket_never_changes():
    # Re-issuing must give exactly the same image, including for tickets issued before this fix.
    token = _many_tokens(1)[0]
    assert tickets.qr_png(token) == tickets.qr_png(token)
