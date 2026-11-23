"""tickets.py — the QR code on each ticket.

How a ticket stays safe
-----------------------
1. When a payment is confirmed, the app makes a secret "token" from the
   reservation ID, the event ID and a private signing key (HMAC-SHA256).
   The same inputs always give the same token, so a ticket can be re-issued
   without changing its QR code.
2. The QR code contains only "TUBARAO:" + that token. No name, email,
   category or price is inside it.
3. The database stores only a fingerprint (SHA-256 hash) of the token, never
   the token itself. At the door, the scanned token is hashed again and
   looked up. Someone who reads the database still cannot make a valid QR.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import re

import qrcode
from PIL import Image

PREFIX = "TUBARAO:"
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def derive_ticket_token(reservation_id: str, event_id: str, secret: str) -> str:
    """Make the opaque ticket token (version 1)."""
    if not isinstance(secret, str) or len(secret.encode("utf-8")) < 32:
        raise ValueError("Ticket signing is not configured.")
    if not UUID_PATTERN.match(reservation_id) or not UUID_PATTERN.match(event_id):
        raise ValueError("Invalid ticket identifiers.")
    message = f"tubarao-ticket-v1:{reservation_id.lower()}:{event_id.lower()}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")  # 43 characters


def hash_ticket_token(token: str) -> str:
    """The fingerprint stored in the database."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def matches_token_hash(token: str, stored_hash: str | None) -> bool:
    if not isinstance(stored_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", stored_hash):
        return False
    return hmac.compare_digest(hash_ticket_token(token), stored_hash.lower())


def ticket_payload(token: str) -> str:
    if not TOKEN_PATTERN.match(token):
        raise ValueError("Invalid ticket token.")
    return PREFIX + token


def parse_payload(payload: str | None) -> str | None:
    """Return the token inside a scanned QR, or None if it is not a Tubarão ticket."""
    if not isinstance(payload, str):
        return None
    payload = payload.strip()
    if not payload.startswith(PREFIX):
        return None
    token = payload[len(PREFIX):]
    return token if TOKEN_PATTERN.match(token) else None


def qr_png(token: str) -> bytes:
    """Draw the QR code as a PNG image."""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=6)
    qr.add_data(ticket_payload(token))
    qr.make(fit=True)
    image = qr.make_image(fill_color="#000000", back_color="#FFFFFF")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def decode_qr_image(image_bytes: bytes) -> str | None:
    """Read the text inside a QR code photo (camera or uploaded file). None if no code is found.

    OpenCV has two QR readers. The standard one misses about 3 in 100 perfectly clean codes,
    so the newer "Aruco" reader goes first and the standard one is the backup. Each is tried on
    the image as it is and on cleaned-up versions (greyscale, black-and-white, a white border
    added, enlarged), which also helps with small, dim or tightly cropped camera photos.
    """
    import cv2  # imported here so the rest of the app works even without OpenCV
    import numpy as np

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return None
    colour = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    grey = cv2.cvtColor(colour, cv2.COLOR_BGR2GRAY)
    _, black_white = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bordered = cv2.copyMakeBorder(grey, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
    enlarged = cv2.resize(grey, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)

    readers = []
    if hasattr(cv2, "QRCodeDetectorAruco"):
        readers.append(cv2.QRCodeDetectorAruco())
    readers.append(cv2.QRCodeDetector())
    for reader in readers:
        for candidate in (colour, grey, black_white, bordered, enlarged):
            try:
                text, _points, _ = reader.detectAndDecode(candidate)
            except cv2.error:
                continue
            if text:
                return text
    return None
