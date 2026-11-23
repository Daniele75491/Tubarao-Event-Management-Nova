# Security hardening before submission

## Why
A security review before submission found three ways the app could be abused.

1. **Content injection into staff screens.** Guest and staff names were escaped for HTML but not for Markdown. A guest booking under the name `[Payment problem, click here](https://evil.example)` put a working link inside the organizer's dashboard, and `![](https://evil.example/x.png)` made the organizer's browser load an outside image. A name that is just a web address (`https://evil.example/pay`) also became a clickable link, because Streamlit's Markdown links bare addresses by itself.
2. **Unlimited sign-in guesses.** The access-code form accepted any number of attempts, so someone could keep guessing until a code worked.
3. **Weak codes.** `seed.py` generated codes with only 8 random hexadecimal characters (about 4 billion possibilities), and staff could choose any 8-character code, like `password`.

## What
1. Every name, email, code or label typed by a guest or staff member is shown as plain text everywhere: Markdown symbols (`[ ] ( ) ! * _ ` # < >` and so on) appear as themselves and never become links, images or formatting. Bare web addresses (`http://`, `https://`, `www.`) show as plain text too. The helpers live in `display.py`.
2. Sign-in attempts are counted per source: the visitor's IP address, or the browser session when the IP isn't known. After **5 wrong codes within 15 minutes** from one source, that source is refused, even with the right code, until 15 minutes have passed since its 5th failure. Other sources are unaffected, so an attacker can't lock out real staff from their own phones. (On a host where every visitor reaches the app through one shared address, they all count as one source: wrong guesses from anyone then pause sign-in for everyone for 15 minutes. That is a nuisance, not a way in.) A successful sign-in clears that source's count. Only a fingerprint of the source is stored.
3. New and reset access codes need **at least 10 characters**. Codes `seed.py` generates have 16 random hexadecimal characters (about 18 billion billion possibilities). Existing shorter codes keep working until they are reset.

## Out of scope
- Two-factor sign-in, and staff accounts with personal passwords.
- Limits on how many places one visitor can hold (a separate abuse problem, listed in the README's known limits).

## Done when
- Tests:
  - the escaping functions neutralise links, images, emphasis, HTML and bare web addresses;
  - the 6th wrong attempt from a source is refused, even with the right code;
  - another source still signs in;
  - the limit lifts after 15 minutes;
  - success clears the count;
  - 9-character codes are refused for new accounts, resets and `seed.py`;
  - generated codes have 16 random characters.
- The sign-in screen refuses the right code after 5 wrong ones (screen test).
- In a browser, guests named with a Markdown link, an image, HTML, formatting and bare web addresses show as plain text on the door search and in every kind of message, label and button, with no outside link or image.
- `uv run pytest` is green.
