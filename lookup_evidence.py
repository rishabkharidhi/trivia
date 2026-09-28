#!/usr/bin/env python3
"""
Collect Wikipedia evidence for trivia answers, for Snow's Push to Think Trivia.

  python3 lookup_evidence.py                 # reads questions.json, writes evidence.jsonl

For every question without an "explain" field it searches Wikipedia and saves the top
matching articles: title, link, the search snippet (the passage that matched), and the
article's intro. Nothing is written into questions.json; evidence.jsonl is then reviewed
and turned into sourced explanations.

- Standard library only.
- Follows the MediaWiki API etiquette: one request at a time, a descriptive User-Agent
  with contact URL, maxlag, and backoff on rate limits.
- Resumable: stop it any time (Ctrl+C) and run it again; finished questions are skipped.
- Two requests per question; expect roughly 1 to 2 hours for ~5,300 questions.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://en.wikipedia.org/w/api.php"
# Wikimedia requires a descriptive User-Agent with contact info. Change the URL if you like.
USER_AGENT = "PushToThinkTrivia-evidence/1.0 (https://rishabkharidhi.com/trivia/; personal trivia game)"
PAUSE = 0.25  # small gap between serial requests

STOP = set("""a an the of in on at to for is was were are be been by with from as and or not no this that these
those it its into than then what which who whom whose where when why how does did do has have had many much most
known called named name first last largest smallest only following one two true false there their
about also better used which""".split())


def keywords(text, limit=6):
    words = re.findall(r"[A-Za-z0-9'’\-]+", html.unescape(text))
    out, seen = [], set()
    for w in words:
        lw = w.lower().strip("'’-")
        if len(lw) < 3 or lw in STOP or lw in seen:
            continue
        seen.add(lw)
        out.append(w.strip("'’-"))
        if len(out) >= limit:
            break
    return out


def api(params, retries=6):
    params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    delay = 5
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            err = (data.get("error") or {}).get("code")
            if err in ("maxlag", "ratelimited"):
                print(f"  server asked us to slow down ({err}); waiting {delay}s", file=sys.stderr)
                time.sleep(delay); delay = min(delay * 2, 120)
                continue
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                wait = int(e.headers.get("Retry-After") or delay)
                print(f"  HTTP {e.code}; waiting {wait}s", file=sys.stderr)
                time.sleep(wait); delay = min(delay * 2, 120)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  network error ({e}); retrying in {delay}s", file=sys.stderr)
            time.sleep(delay); delay = min(delay * 2, 120)
    raise RuntimeError("Too many retries")


def clean_snippet(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def search_query(q):
    kw = keywords(q["question"])
    if q["type"] == "boolean":
        return " ".join(kw)
    return f'{q["correct"]} ' + " ".join(kw[:5])


def lookup(q):
    query = search_query(q)
    data = api({"action": "query", "list": "search", "srsearch": query, "srlimit": "3", "srprop": "snippet"})
    hits = (data.get("query") or {}).get("search") or []
    results = [{"title": h["title"], "snippet": clean_snippet(h.get("snippet"))} for h in hits]
    if results:
        time.sleep(PAUSE)
        ex = api({"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "redirects": "1",
                  "titles": "|".join(r["title"] for r in results)})
        pages = {p["title"]: p.get("extract", "") for p in (ex.get("query") or {}).get("pages", [])}
        redirects = {r["from"]: r["to"] for r in (ex.get("query") or {}).get("redirects", [])}
        for r in results:
            t = redirects.get(r["title"], r["title"])
            r["title"] = t
            r["url"] = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_"))
            r["intro"] = (pages.get(t) or "")[:1500]
    return {"id": q["id"], "query": query, "results": results}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--questions", default="questions.json")
    ap.add_argument("--out", default="evidence.jsonl")
    ap.add_argument("--limit", type=int, default=0, help="only look up this many (for a test run)")
    args = ap.parse_args()

    with open(args.questions, encoding="utf-8") as f:
        data = json.load(f)
    questions = data["questions"] if isinstance(data, dict) else data
    todo = [q for q in questions if not q.get("explain")]

    done = set()
    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as f:
            for line in f:
                try: done.add(json.loads(line)["id"])
                except (ValueError, KeyError): pass
    todo = [q for q in todo if q["id"] not in done]
    if args.limit: todo = todo[:args.limit]
    print(f"{len(done)} already done, {len(todo)} to look up")

    start = time.time()
    with open(args.out, "a", encoding="utf-8") as out:
        for i, q in enumerate(todo, 1):
            try:
                rec = lookup(q)
            except Exception as e:  # keep going; a failed one is retried on the next run
                print(f"  skipped {q['id']}: {e}", file=sys.stderr)
                continue
            out.write(json.dumps(rec, ensure_ascii=False) + "\n"); out.flush()
            if i % 25 == 0 or i == len(todo):
                rate = i / (time.time() - start)
                left = (len(todo) - i) / rate if rate else 0
                print(f"  {i}/{len(todo)} looked up, about {left / 60:.0f} min left")
            time.sleep(PAUSE)
    print(f"Done. Evidence saved to {args.out}. Upload it back to Claude for review.")


if __name__ == "__main__":
    main()
