# Bring back the hero video

## Why
The JavaScript landing page opened with a short looping shark video. The port showed only the still logo.

## What
- The Tickets landing page shows `assets/tubarao-hero.mp4` at the top: playing by itself, muted, looping, with no player controls and soft faded edges.
- If the video file is missing, the still logo is shown instead, as now.
- The checkout and booking screens keep the still logo, so they stay light.

## Out of scope
- Sound, or any other video.

## Done when
- A screen test sees the video on the landing page and the logo on the checkout screen.
- A screen test with the video file hidden sees the logo instead.
- Clicked through in a browser: the video plays with no controls on a phone-sized screen.
- `uv run pytest` is green.
