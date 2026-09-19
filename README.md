# Snow's Push to Think Trivia

A screen-share-friendly trivia game show hosted by Fae N'Lancer (pun on Final Answer), a talking question mark.

## Files
- `index.html`: the whole game (HTML, CSS, JS in one file). Includes a 66-question starter set as a fallback.
- `questions.json`: the question bank the game loads. Starts as the starter set.
- `fetch_questions.py`: grows `questions.json` from the Open Trivia Database. Standard library only.
- `lookup_evidence.py`: collects Wikipedia evidence for answers (writes `evidence.jsonl`) so explanations can be verified and sourced.

## Deploy (GitHub Pages)
Put all three files in a repo and enable Pages.
`questions.json` only loads over http(s). Opening `index.html` from disk falls back to the starter set.
Local testing: `python3 -m http.server` in the folder, then open http://localhost:8000.

## Growing the question bank
    python3 fetch_questions.py
Pulls every verified OTDB question (one request per 5 seconds, roughly 8-10 minutes), merges and dedupes
into `questions.json`. Existing questions, including any explanations you've added, are kept. Commit the updated file.

## Answer explanations
After each reveal the game shows why the answer is right:
1. If the question has an `explain` field in `questions.json`, that text is shown.
2. Otherwise, for name/place-style answers, it looks up a short Wikipedia excerpt and shows it with a
   source link, only when the article title matches the answer and the excerpt mentions a keyword from the question.
3. Otherwise nothing is shown.
To add your own, put `"explain": "..."` on any question in `questions.json`. Re-running the fetch script keeps it.

## Host voice
The host uses Kokoro-82M (Apache 2.0) through kokoro-js, running entirely in the browser in a Web Worker.
- Default voice: Sky (`af_sky`). Change it in Settings > Natural voice.
- Uses WebGPU (fp32 model, larger download) when available, otherwise CPU/WASM (q8, about 86 MB). Settings > Natural voice mode > Light forces the smaller CPU model.
- The first visit downloads the model; later visits should load it from the browser cache.
- If the model can't load, the game falls back to the browser's built-in voice automatically.
- The on-screen name is Fae N'Lancer; the voice says it as "Final Answer" (`SPOKEN_NAME` in index.html).

## Removing bad questions
In-game, press X (or "Flag question"). Then Settings > "Copy flagged list", paste into `flagged.json`, and run:

    python3 fetch_questions.py --skip-fetch --flagged flagged.json

## Board mode
Pick Board on the title screen, add 2-8 players (saved for next time), choose Full (25 tiles: 200, 400, 800, 1,600, 2,000) or Quick (15 tiles: 200, 800, 2,000).
- Tile difficulty: 200 and 400 easy, 800 medium, 1,600 and 2,000 hard.
- Players take turns in the order added. The picker answers; right adds the tile value, wrong subtracts it.
- After a wrong answer, others can steal (click a name or press its number; N for no steal). Wrong steals also lose the value.
- Double Down tiles: the picker wagers up to their score (or 2,000 if lower). No steals.
- Final round: each player's wager is typed hidden, players DM their answers to the host, then the host marks right or wrong.
- Podium shows final ranks and the all-time board high scores (top 10, stored in the browser).
- Needs 5 categories with enough questions. The starter set can just about fill it; run fetch_questions.py for real variety.

## Controls
1-4 or A-D answer. Space/Enter next. Esc or the ⏸ button opens the pause menu (resume, end the game, or quit to the main menu). F 50/50, S skip, T +10 sec, X flag, R repeat, M mute, Esc pause.

## License

**Code:** `index.html` and `fetch_questions.py` are licensed under the MIT License (see `LICENSE`).

**Question data:** the MIT License does not cover questions from the Open Trivia Database.
- Every entry in `questions.json` tagged `"source": "opentdb"` comes from the Open Trivia Database
  (https://opentdb.com) and is licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
  If you share or adapt those entries, keep the attribution and the same license.
- The built-in starter questions and explanations (entries without that tag, also embedded in `index.html`)
  are covered by the MIT License along with the code.
- Explanations that have an `explainSource` field are quoted from the linked Wikipedia article and are
  licensed under CC BY-SA 4.0. The game shows each one with a link to its source.

**Loaded at runtime (not stored in this repo):**
- Host voice: Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M), Apache 2.0, via kokoro-js (Apache 2.0),
  loaded from the jsDelivr CDN.
- Fallback explanations: excerpts from Wikipedia (https://en.wikipedia.org), CC BY-SA 4.0, each shown with a
  link to its source article.
- Fonts: Bungee and Rubik from Google Fonts.
