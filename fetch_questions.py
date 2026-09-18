#!/usr/bin/env python3
"""
Build or refresh questions.json for Snow's Push to Think Trivia from the Open Trivia Database.

  python3 fetch_questions.py                      # merge everything into ./questions.json
  python3 fetch_questions.py --flagged flagged.json   # also drop questions you flagged in-game

- Standard library only, no installs.
- Merges with the existing output file, so re-running only ever adds questions.
- Dedupes by normalized question text. IDs are the first 12 hex chars of SHA-1 of that
  text, the same IDs the game uses for its "seen" history and flag list.
- OTDB allows one request per 5 seconds per IP and 50 questions per request, so a full
  pull of ~4,700 verified questions takes roughly 8-10 minutes.

Data license: Open Trivia Database content is CC BY-SA 4.0 (https://opentdb.com/api_config.php).
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://opentdb.com/api.php"
TOKEN_URL = "https://opentdb.com/api_token.php"
DELAY = 5.2          # seconds between requests (limit is 1 per 5s per IP)
MAX_REQUESTS = 2000  # hard stop so a logic bug can't loop forever


def norm(text):
    return " ".join(text.lower().split())


def qid(text):
    return hashlib.sha1(norm(text).encode("utf-8")).hexdigest()[:12]


def b64(s):
    return base64.b64decode(s).decode("utf-8")


def get_json(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "PushToThinkTrivia-fetch/1.0"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == retries:
                raise
            wait = DELAY * attempt * 2
            print(f"  network error ({e}); retrying in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)


def new_token():
    data = get_json(f"{TOKEN_URL}?command=request")
    if data.get("response_code") != 0 or "token" not in data:
        raise RuntimeError(f"Could not get a session token: {data}")
    return data["token"]


def convert(r):
    """OTDB result (base64-encoded fields) -> game format."""
    question = b64(r["question"])
    qtype = b64(r["type"])
    return {
        "id": qid(question),
        "category": b64(r["category"]),
        "difficulty": b64(r["difficulty"]),
        "type": "boolean" if qtype == "boolean" else "multiple",
        "question": question,
        "correct": b64(r["correct_answer"]),
        "incorrect": [b64(x) for x in r["incorrect_answers"]],
        "source": "opentdb",
    }


def load_existing(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data["questions"] if isinstance(data, dict) else data


def load_flagged(path):
    if not path:
        return set()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return set(data if isinstance(data, list) else data.get("flagged", []))


def fetch_all():
    token = new_token()
    time.sleep(DELAY)
    amount, requests, out = 50, 0, []
    while requests < MAX_REQUESTS:
        requests += 1
        data = get_json(f"{API}?amount={amount}&token={token}&encode=base64")
        code = data.get("response_code")
        if code == 0:
            batch = [convert(r) for r in data.get("results", [])]
            out.extend(batch)
            print(f"  request {requests}: +{len(batch)} (total {len(out)})")
        elif code == 5:  # rate limited
            print("  rate limited; backing off")
            time.sleep(DELAY * 2)
            continue
        elif code == 3:  # token expired / not found
            print("  session token lost; requesting a new one")
            token = new_token()
        elif code in (1, 4):  # not enough questions left for this amount
            if amount == 1:
                break
            amount = max(1, amount // 2)
        else:
            raise RuntimeError(f"Unexpected response: {data}")
        time.sleep(DELAY)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="questions.json")
    ap.add_argument("--flagged", help="JSON list of question IDs to exclude (copied from the game's settings)")
    ap.add_argument("--skip-fetch", action="store_true", help="only re-apply the flag list to the existing file")
    args = ap.parse_args()

    existing = load_existing(args.out)
    flagged = load_flagged(args.flagged)
    print(f"Existing questions: {len(existing)}; flagged to remove: {len(flagged)}")

    fetched = [] if args.skip_fetch else fetch_all()

    merged, seen_text = {}, set()
    for q in existing + fetched:
        key = norm(q["question"])
        if key in seen_text:
            continue
        seen_text.add(key)
        q["id"] = q.get("id") or qid(q["question"])
        merged[q["id"]] = q
    for f in flagged:
        merged.pop(f, None)

    questions = sorted(merged.values(), key=lambda q: q["id"])
    payload = {
        "source": "Open Trivia Database (https://opentdb.com), CC BY-SA 4.0, plus built-in starter questions",
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "count": len(questions),
        "questions": questions,
    }
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.replace(tmp, args.out)
    added = len(questions) - len(existing)
    print(f"Wrote {len(questions)} questions to {args.out} ({added:+d} vs before)")


if __name__ == "__main__":
    main()
