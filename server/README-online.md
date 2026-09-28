# Online rooms (Phase 1: Buzz-In)

Play from separate devices instead of one shared screen. The single-screen game in `index.html` is unchanged.

- `play/index.html` — where everyone plays. Create or join a room, buzz, answer, see scores. Whoever creates the room gets Start/Next buttons; if they leave, the controls pass to another player automatically.
- `host/index.html` — an optional big screen for streaming. The host voice is off by default here (everyone reads the question on their own device); there's a toggle on the lobby screen if you want it. View-only: it never scores and never controls the game. Open it with the "View big screen" button, or directly with `?room=CODE`.
- `src/index.js` — Cloudflare Worker with the `Room` Durable Object: authoritative state, WebSockets, timers.
- `src/rules.js` — pure game rules (scoring, buzz ranking, question picking). Unit-testable, no Cloudflare APIs.
- `test_room.mjs` — Node test that drives a whole game against a stubbed runtime: `node test_room.mjs`

## How a game runs
1. You open `play/` and press "Create a new room". You get a 4-letter code and the controls.
2. Everyone else opens `play/`, types their name and the code (or taps your invite link). Phones reconnect automatically and keep their score.
3. If you're streaming, press "View big screen" to pop the display open in a new tab, and share that tab. It's optional.
4. You press Start. The Worker picks a question, and sends it with a `shownAt` timestamp ~700 ms ahead so every device reveals it at the same instant.
5. First buzz wins — ranked by **when the button was pressed on that device**, converted to room time using a measured clock offset, not by who reached the server first. A slower connection doesn't lose you the buzz.
6. A wrong answer costs the question's value and reopens it to everyone who hasn't tried. When nobody's left, the answer is revealed with its explanation.

## Modes and settings
The controller's device has the settings, all applied when a round starts:
- **Mode**: Buzz-In, Board or Survival.
- **Buzz-In**: question count, difficulty, buzz window (how long a question stays open), answer time, auto-advance or manual next.
- **Board**: 5 categories x 5 values (200-2,000) or a quick 15-tile board. The player whose turn it is picks a tile and answers it alone; a wrong answer or a timeout costs the tile's value and opens it to everyone else as a buzz-in steal. Double Down tiles let the picker wager up to their score (minimum cap: the board's top value) and allow no steals. Turns rotate after every tile, and the game ends when the board is cleared.
- **Survival**: everyone gets the same number of lives (1, 2, 3 or 5). Each round picks one category and difficulty, and every surviving player answers their own question from it in turn, so nobody hears another player's answer. A wrong answer or a timeout costs a life; at zero you're out. Difficulty ramps up each round and the last player standing wins.
- **Timers**: the buzz window and the answer clock both go up to 30 seconds. Once a player is locked in, everyone sees the answer countdown.
- **End game** stops a round early so you can switch modes.

Options are shown to everyone as soon as a question appears, so players read A-D first and then buzz to lock in.

## Room lifetime
Rooms clean themselves up, so nothing stale lingers:
- **10 minutes after the last person disconnects**, the room's storage is deleted and its state reset.
- **2 hours of inactivity** wipes a room even if a tab is still connected; the expiry is pushed out on every message.
- **A recycled room code never resurrects an old game.** If the code's last activity was over 2 hours ago and nobody is connected, joining wipes it first and starts fresh.
- Ending a game keeps the room alive on purpose, so you can set up another round from the lobby. Close the tabs and it disappears on its own.
- Player devices only remember their name, their player id and the server URL. The room's state lives on the server, never in the browser.

## Deploy the Worker
Needs Node and a Cloudflare account (free plan is fine).

    cd server
    npx wrangler login
    npx wrangler deploy

Wrangler prints a URL like `https://push-to-think.<your-subdomain>.workers.dev`. Then:
1. Put that URL in `DEFAULT_SERVER` at the top of the script in **both** `host/index.html` and `play/index.html`.
2. Commit the `host/` and `play/` directories into the `trivia` repo, so they're served from GitHub Pages.
3. Everyone opens `https://rishabkharidhi.com/trivia/play/`. No screen needed unless you want one for streaming.

You can test against a different Worker without editing files by adding `?server=https://...` to either page's URL; it's remembered in that browser.

The Worker reads questions from `QUESTIONS_URL` in `wrangler.toml` (your published `questions.json`) and caches them, so retired questions and explanations come along automatically. Change it with:

    npx wrangler deploy --var QUESTIONS_URL:https://example.com/questions.json

## Cost
Durable Objects run on the Workers free plan. A game between friends is a few thousand messages, against 100,000 requests/day, where 20 incoming WebSocket messages count as 1 request.

## Not in this phase
The Kokoro host voice (the screen uses the browser voice for now), spectators, and folding this screen into the main `index.html` design.
