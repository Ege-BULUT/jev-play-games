# Jev Play Games

**Live:** https://jev-play-games.vercel.app

Watch [TypeSafe AI's Jev](https://vercel.com/ai-gateway/models/jev) play browser games live. Jev is a
"System 1" model: it never writes text, it returns a calibrated probability for every option it is
given. Every move here is one Jev call, and the page shows the odds of each move as bars next to the game.

## How it works

- **One decision per turn.** Each game is a pure, seeded state machine (`src/games/`). Every turn
  the server lists the legal moves, describes what each one leads to, and asks Jev one `choice`
  question through the AI SDK's `experimental_evaluate` on Vercel AI Gateway (`typesafe-ai/jev`).
- **The server owns the state.** The state for turn *n* is recomputed on the server from the seed
  or from turn *n − 1*'s snapshot and action. Clients can only ask for the next turn, so the model
  key cannot be pointed at arbitrary input.
- **Live for everyone, paid only while watched.** The viewer who presses *Play live* drives the
  game. Everyone else on the page follows it through Supabase Realtime. If the driver leaves, another
  viewer takes over after about 6 seconds. With no viewers, nobody drives, Jev is never called, and
  the session closes after 3 idle minutes.
- **Everything is recorded.** Each decision is stored with the state it was made from, so a replay
  is exact. The last recording loops behind the *Play live* button.
- **Rate limit.** Through AI Gateway, Jev allows 30 requests a minute per project. The server spaces
  calls evenly at `JEV_RPM` (default 28) a minute across all games. The time per move therefore grows
  with the number of live games, and real-time games play their frames in slow motion across the gap.
- **Pause and resume.** A game that stops because nobody is watching carries on from its last turn
  the next time someone presses *Play live*. A finished game starts a new one.
- **Spend cap.** Input tokens are metered per UTC day. Past `JEV_DAILY_CAP_USD` (default `$1`),
  live play stops until the next day and replays keep running.

## Games

| Game | Status |
| --- | --- |
| 2048 | playable |
| Snake | playable |
| Block Blitz (block-drop puzzle) | playable |
| Hill Climb | playable |
| Super Jev Bros (platformer, Kenney CC0 art) | playable |
| Freedoom (FPS on the BSD-licensed Freedoom assets) | planned |

All games are original implementations or open clones with original or freely licensed art. No
commercial game assets or ROMs are used.

## Develop

```bash
pnpm install
vercel link && vercel env pull .env.local   # AI Gateway OIDC token + Supabase keys
node --env-file=.env.local scripts/migrate.mjs   # applies db/schema.sql (idempotent)
pnpm dev
pnpm test
```
