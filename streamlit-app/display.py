"""display.py — show text typed by guests or staff as plain text, never as formatting.

Streamlit renders text as Markdown, and some screens also allow HTML. A guest
could otherwise book under a name like `[click here](https://evil.example)`
and put a working link (or an image, or formatting) on the organizer's screen.

esc(text)  for st.markdown(..., unsafe_allow_html=True): HTML-escapes the text
           and turns Markdown symbols into HTML character codes, which show as
           the plain symbol and can never become a link, image or emphasis.
md(text)   for plain st.write / st.markdown / messages: puts a backslash in
           front of every Markdown symbol, the standard way to show it as-is.

Streamlit's Markdown also turns a bare `https://...` or `www....` into a link by
itself, after escapes are undone, so escaping alone can't stop it. Both functions
put an invisible break right after `http`, `https` or `www`, so the address no
longer matches and shows as plain text. (Email addresses still become mail links:
that only opens the viewer's mail program.)
"""

from __future__ import annotations

import html
import re

# Symbols that mean something in Streamlit's Markdown ($ starts maths, ~ strikes through).
MARKDOWN_SYMBOLS = "\\`*_{}[]()#!|~<>$"
# The start of a web address that Markdown would link by itself: http: https: www.
ADDRESS_START = re.compile(r"(https?(?=:)|www(?=\.))", re.IGNORECASE)
WORD_JOINER = "⁠"  # an invisible character, used where HTML is not allowed


def esc(text) -> str:
    escaped = html.escape(str(text))  # & < > " '
    escaped = "".join(f"&#{ord(char)};" if char in MARKDOWN_SYMBOLS else char for char in escaped)
    return ADDRESS_START.sub(r"\1<span></span>", escaped)


def md(text) -> str:
    escaped = "".join("\\" + char if char in MARKDOWN_SYMBOLS else char for char in str(text))
    return ADDRESS_START.sub(r"\1" + WORD_JOINER, escaped)
