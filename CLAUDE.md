# CLAUDE.md — fhl-ask-frosty

Ask Frosty is FHL's in-app assistant (the flying snowman, bottom right of the
platform). This repo is its **source of truth**. frosty-saas runs a synced
copy in `src/lib/ask-frosty/`. Never edit that copy by hand: change it here,
then `npm run sync -- /path/to/frosty-saas` and open a PR there.

## Owner's hard rules (Omar)

1. Every tool gets its own GitHub repo under MrFrosty25 (2026-11-14). This is
   that repo for Ask Frosty.
2. Nothing critical may depend on Claude. Ask Frosty is a convenience: every
   action it proposes is also a button on a screen.
3. Every mistake is written down in `docs/LESSONS.md`.

## Ask Frosty's safety rules

- **Look-ups are read-only** and run with the signed-in person's own Supabase
  client, so RLS applies exactly as on the screens.
- **Actions are proposals.** An action tool returns a card. Nothing happens
  until the person taps **Confirm** (owner, 2026-11-15: "tap to confirm every
  action"). On Confirm the person's browser calls the **same endpoint the
  screen's button calls**. Never add a new write path for Frosty.
- **Customer messages are drafts.** The platform sends nothing; the card opens
  the person's own Messages / Mail with the text filled in.
- Never put a per-foot rate, a footage or internal pricing in a customer
  message. Never mention HVAC.
- A request Frosty cannot do yet is answered "Not yet:", plus the screen that
  does it. Those requests feed `docs/WISHLIST.md`.

## Layout

- `src/read-tools.ts` — the six look-ups and their executor.
- `src/actions.ts` — the six action proposals → cards; `draftLink`.
- `src/prompt.ts` — what Frosty is told.
- `tests/` — `npm test` (node --test, no dependencies). Must pass.
- `scripts/sync-to-platform.mjs` — copy `src/` into frosty-saas, stamped.
