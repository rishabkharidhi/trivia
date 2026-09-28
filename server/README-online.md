# Online rooms (Phase 1: Buzz-In)

Play from separate devices instead of one shared screen. The single-screen game in `index.html` is unchanged.

- `play.html` — where everyone plays. Create or join a room, buzz, answer, see scores. Whoever creates the room gets Start/Next buttons; if they leave, the controls pass to another player automatically.
- `online.html` — an optional big screen for streaming. The host voice is off by default here (everyone reads the question on their own device); there's a toggle on the lobby screen if you want it. View-only: it never scores and never controls the game. Open it with the "View big screen" button, or directly with `?room=CODE`.
- `src/index.js` — Cloudflare Worker with the `Room` Durable Object: authoritative state, WebSockets, timers.
- `src/rules.js` — pure game rules (scoring, buzz ranking, question picking). Unit-testable, no Cloudflare APIs.
- `test_room.mjs` — Node test that drives a whole game against a stubbed runtime: `node test_room.mjs`

## How a game runs
1. You open `play.html` and press "Create a new room". You get a 4-letter code and the controls.
2. Everyone else opens `play.html`, types their name and the code (or taps your invite link). Phones reconnect automatically and keep their score.
3. If you're streaming, press "View big screen" to pop the display open in a new tab, and share that tab. It's optional.
4. You press Start. The Worker picks a question, and sends it with a `shownAt` timestamp ~700 ms ahead so every device reveals it at the same instant.
5. First buzz wins — ranked by **when the button was pressed on that device**, converted to room time using a measured clock offset, not by who reached the server first. A slower connection doesn't lose you the buzz.
6. A wrong answer costs the question's value and reopens it to everyone who hasn't tried. When nobody's left, the answer is revealed with its explanation.

## Modes and settings
The controller's device has the settings, all applied when a round starts:
- **Mode**: Buzz-In or Board.
- **Buzz-In**: question count, difficulty, buzz window (how long a question stays open), answer time, auto-advance or manual next.
- **Board**: 5 categories x 5 values (200-2,000) or a quick 15-tile board. The player whose turn it is picks a tile and answers it alone; a wrong answer or a timeout costs the tile's value and opens it to everyone else as a buzz-in steal. Double Down tiles let the picker wager up to their score (minimum cap: the board's top value) and allow no steals. Turns rotate after every tile, and the game ends when the board is cleared.
- **End game** stops a round early so you can switch modes.

Options are shown to everyone as soon as a question appears, so players read A-D first and then buzz to lock in.

## Deploy the Worker
Needs Node and a Cloudflare account (free plan is fine).

    cd online
    npx wrangler login
    npx wrangler deploy

Wrangler prints a URL like `https://push-to-think.<your-subdomain>.workers.dev`. Then:
1. Put that URL in `DEFAULT_SERVER` at the top of the script in **both** `online.html` and `play.html`.
2. Commit `online.html`, `play.html` into the `trivia` repo (any folder), so they're served from GitHub Pages.
3. Everyone opens `https://rishabkharidhi.com/trivia/play.html`. No screen needed unless you want one for streaming.

You can test against a different Worker without editing files by adding `?server=https://...` to either page's URL; it's remembered in that browser.

The Worker reads questions from `QUESTIONS_URL` in `wrangler.toml` (your published `questions.json`) and caches them, so retired questions and explanations come along automatically. Change it with:

    npx wrangler deploy --var QUESTIONS_URL:https://example.com/questions.json

## Cost
Durable Objects run on the Workers free plan. A game between friends is a few thousand messages, against 100,000 requests/day, where 20 incoming WebSocket messages count as 1 request.

## Not in this phase
Board and Last Standing online, the Kokoro host voice (the screen uses the browser voice for now), spectators, and folding this screen into the main `index.html` design.
