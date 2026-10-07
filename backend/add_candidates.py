import json
import sys
import time
import urllib.request

API = "http://localhost:3000/api/listings"
SOURCE = "/tmp/opencode/airbnb-final.json"


def _post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def _existing():
    with urllib.request.urlopen(API, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    return {l.get("url") for l in data.get("listings", [])}


def segment_for(sector):
    low = (sector or "").lower()
    if "paracas" in low or "pisco" in low:
        return "paracas"
    return "lima1"


def main():
    with open(SOURCE, encoding="utf-8") as fh:
        candidates = json.load(fh)
    have = _existing()
    added = 0
    for item in candidates:
        url = item.get("url")
        if not url or url in have:
            continue
        seg = segment_for(item.get("sector"))
        try:
            res = _post({"url": url, "segment": seg, "person": "equipo"})
            print(f"added {res.get('id')} [{seg}] {item.get('name')}", file=sys.stderr, flush=True)
            have.add(url)
            added += 1
        except Exception as e:
            print(f"error {url}: {e}", file=sys.stderr, flush=True)
        time.sleep(1.0)
    print(f"total added: {added}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
