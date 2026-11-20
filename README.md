# Tubarão · Nova SBE classroom demo

This copy is for Introduction to Programming. It uses a local database, simulated payments and downloadable demo QR tickets. Use synthetic records throughout.

## Run the checks

Use Node.js 24 and pnpm. The tests and public build need no integration credentials.

```sh
pnpm install --frozen-lockfile
node --test tests/*.test.cjs
node scripts/build.cjs
```

## Run locally

1. Prepare a disposable Supabase stack at `http://127.0.0.1:54321`. Start with the reviewed schema-only baseline and apply the migrations in order. The baseline is a separate prerequisite.
2. Copy [the environment template](.env.example) to an ignored `.env`. Set `DEMO_MODE=local`, use the local service key, and generate a fresh, stable demo signing secret of at least 32 UTF-8 bytes.
3. Seed a fictional active event and synthetic `SUPER_ADMIN` and door `ADMIN` access accounts. Keep the access codes and their salts and hashes local.
4. Run `node --env-file-if-exists=.env scripts/dev.cjs` and open `http://127.0.0.1:3000`. The runner builds the public files and serves the existing API handlers on one origin.

## Demo walkthrough

1. Simulate the follow step, choose a category and reserve with a synthetic name and email.
2. Select **SIMULATE … & CLAIM**. The database moves the reservation to `PAYMENT_CLAIMED`.
3. Sign in at `/admin.html` as `SUPER_ADMIN` and confirm the claim. In completed payments, select **DOWNLOAD DEMO QR** after the ticket is issued.
4. Sign in at `/checkin.html` as an authorized door user and scan the demo QR or use manual check-in. A second scan reports the original admission.

See [Nova demo isolation](docs/NOVA-DEMO.md) for the configuration contract, change inventory and verification results. [The original audit](docs/NOVA-PROJECT-AUDIT.md) documents the starting point.
