# Secret Santa

Draw names for a gift exchange, then let each person privately see who they're buying for.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

1. **Who's in**: add everyone taking part.
2. **Keep apart** (optional): stop pairs such as partners from drawing each other. Rules work both ways.
3. **Draw names**: random assignment, nobody draws themselves.

After the draw, either pass one phone around (each person taps their tag, unwraps it, hides it) or
send each person their **private link** (`/reveal#...`), which opens the same unwrap screen on their own phone.

Everything is stored in the browser's localStorage. There is no backend.

## Files

| Path | What it is |
| --- | --- |
| `src/components/SecretSanta.tsx` | Main page: event header, setup steps, board after the draw |
| `src/components/GiftReveal.tsx` | The unwrap moment (gift box, tag swing) |
| `src/components/RevealFromLink.tsx` | Private-link page that reads the URL hash |
| `src/lib/draw.ts` | Draw algorithm (randomised backtracking, honours keep-apart rules) |
| `src/lib/store.ts` | localStorage-backed store via `useSyncExternalStore` |
| `src/lib/share.ts` | Private-link encoding (scrambled, **not** encrypted) |
| `src/app/globals.css` | All design tokens and styles |
| `src/app/fonts/` | Self-hosted Gloock and Familjen Grotesk (SIL OFL) |

## Known limits

- Private links are scrambled, not encrypted. Someone determined could decode one. Fine for a friendly
  exchange; add a backend if secrecy really matters.
- Data lives in one browser. Clearing site data or switching devices loses the group.
