import json
import os
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import store
import enrich as enrich_mod
from data_config import TRIP, ANCHOR_SETS, CRITERIA

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(os.path.dirname(HERE), "frontend")
DIST = os.path.join(FRONTEND, "dist")
if not os.path.isdir(DIST):
    DIST = FRONTEND
PORT = int(os.environ.get("PORT", "3000"))

FX_PATH = os.path.join(os.path.dirname(HERE), "data", "fx.json")
_FX = {"rate": None, "updated": None}


def get_fx():
    import time as _time
    import urllib.request
    if _FX["rate"] is None:
        try:
            with open(FX_PATH) as f:
                d = json.load(f)
            _FX["rate"] = float(d.get("usd_cop"))
            _FX["updated"] = float(d.get("updated") or 0)
        except Exception:
            pass
    if _FX["rate"] and _FX["updated"] and (_time.time() - _FX["updated"]) < 43200:
        return _FX
    try:
        req = urllib.request.Request("https://open.er-api.com/v6/latest/USD",
                                     headers={"User-Agent": "airbnb-trip-compare"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
        rate = float(data["rates"]["COP"])
        _FX["rate"] = rate
        _FX["updated"] = _time.time()
        os.makedirs(os.path.dirname(FX_PATH), exist_ok=True)
        with open(FX_PATH, "w") as f:
            json.dump({"usd_cop": rate, "updated": _FX["updated"]}, f)
    except Exception:
        if not _FX["rate"]:
            _FX["rate"] = 4000.0
    return _FX


def _clamp(v, lo=0.0, hi=10.0):
    return max(lo, min(hi, v))


def _loc_score(routes):
    if not routes:
        return 5.0
    tw = sum(r.get("weight", 1) for r in routes)
    avg = sum((r.get("durationMin") or 60) * r.get("weight", 1) for r in routes) / tw
    if avg <= 15:
        return 10.0
    if avg <= 30:
        return 8.0
    if avg <= 45:
        return 6.0
    if avg <= 60:
        return 4.0
    return 2.0


def _price_ppn(listing, seg):
    p = listing.get("price") or {}
    if not p.get("available"):
        return None
    pp = p.get("perPersonPerNight")
    if pp is not None:
        return round(pp, 1)
    total = p.get("total")
    nights = p.get("nights")
    if total and nights:
        return round(total / nights / 11, 1)
    return None


def _price_score(ppn):
    if ppn is None:
        return None
    if ppn <= 15:
        return 10.0
    if ppn <= 25:
        return 8.0
    if ppn <= 40:
        return 6.0
    if ppn <= 60:
        return 4.0
    return 2.0


def _capacity_score(cap):
    if cap is None:
        return 5.0
    if cap >= 11:
        return 10.0
    if cap >= 9:
        return 8.0
    if cap >= 7:
        return 6.0
    if cap >= 5:
        return 4.0
    return 2.0


def _quality_score(rating):
    r = (rating or {}).get("overall")
    if not r:
        return 6.0
    return _clamp(float(r) * 2)


def _objective(listing, seg, weights):
    subs = {
        "ubicacion": _loc_score(listing.get("routes")),
        "precio": _price_score(_price_ppn(listing, seg)),
        "capacidad": _capacity_score(listing.get("personCapacity")),
        "calidad": _quality_score(listing.get("rating")),
        "seguridad": (listing.get("safety") or {}).get("score", 6.0),
        "entorno": (listing.get("pois") or {}).get("walkScore", 5.0),
    }
    num = 0.0
    den = 0.0
    breakdown = {}
    for c in CRITERIA:
        w = weights.get(c["key"], c["defaultWeight"])
        val = subs[c["key"]]
        if val is None:
            breakdown[c["key"]] = {"score": None, "weight": w}
            continue
        breakdown[c["key"]] = {"score": round(val, 1), "weight": w}
        num += val * w
        den += w
    return (round(num / den, 2) if den else 5.0), breakdown


def build_results():
    data = store.all_data()
    listings = data["listings"]
    votes = data["votes"]
    weights = data.get("weights") or {}
    out = {"segments": [], "criteria": CRITERIA, "weights": weights}
    for seg in TRIP["segments"]:
        seg_listings = [l for l in listings.values() if l.get("segment") == seg["id"]]
        scored = []
        for l in seg_listings:
            obj, breakdown = _objective(l, seg, weights)
            seg_votes = [v for v in votes if v["listingId"] == l["id"]]
            community = round(sum(v["score"] for v in seg_votes) / len(seg_votes), 2) if seg_votes else None
            final = obj if community is None else round(0.5 * obj + 0.5 * community, 2)
            scored.append({
                "id": l["id"], "name": l.get("name"), "image": (l.get("images") or [None])[0],
                "status": l.get("status"), "objective": obj, "community": community,
                "final": final, "votes": len(seg_votes), "breakdown": breakdown,
                "pricePPN": _price_ppn(l, seg), "safety": (l.get("safety") or {}).get("score"),
                "district": (l.get("geo") or {}).get("district"), "capacity": l.get("personCapacity"),
                "bedrooms": l.get("bedrooms"), "beds": l.get("beds"), "baths": l.get("baths"),
                "priceTotal": (l.get("price") or {}).get("total"),
                "pricePerNight": (l.get("price") or {}).get("perNight"),
                "priceAvailable": (l.get("price") or {}).get("available"),
                "available": bool((l.get("price") or {}).get("available")),
                "rating": (l.get("rating") or {}).get("overall"),
                "walkScore": (l.get("pois") or {}).get("walkScore"),
                "routes": l.get("routes"),
            })
        scored.sort(key=lambda x: (x["available"], x["final"]), reverse=True)
        for i, s in enumerate(scored):
            s["rank"] = i + 1
        winner = next((s["id"] for s in scored if s["available"]), None)
        out["segments"].append({"id": seg["id"], "label": seg["label"], "listings": scored,
                                "winner": winner})
    return out


def _run_enrichment(listing_id, url, segment):
    listing = store.get_listing(listing_id)
    if not listing:
        return
    try:
        result = enrich_mod.enrich({"id": listing_id, "url": url, "segment": segment})
        result["id"] = listing_id
        result["url"] = url
        result["addedBy"] = listing.get("addedBy")
        result["addedAt"] = listing.get("addedAt")
        store.upsert_listing(result)
    except Exception as e:
        store.update_listing(listing_id, {"status": "error", "error": str(e)})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def _static(self, path):
        if path == "/" or not path:
            path = "/index.html"
        rel = path.lstrip("/")
        target = os.path.normpath(os.path.join(DIST, rel))
        if not target.startswith(DIST) or not os.path.isfile(target):
            target = os.path.join(DIST, "index.html")
        if not os.path.isfile(target):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"frontend no compilado (ejecuta: npm --prefix frontend run build)")
            return
        types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                 ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                 ".ico": "image/x-icon", ".map": "application/json", ".webmanifest": "application/manifest+json"}
        ext = os.path.splitext(target)[1]
        with open(target, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", types.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json({}, 204)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/api/health":
            return self._json({"ok": True})
        if p == "/api/trip":
            fx = get_fx()
            return self._json({"trip": TRIP, "anchors": ANCHOR_SETS, "criteria": CRITERIA,
                               "fx": {"usd_cop": fx["rate"], "updated": fx["updated"]}})
        if p == "/api/listings":
            return self._json({"listings": list(store.all_data()["listings"].values())})
        if p == "/api/results":
            return self._json(build_results())
        if p == "/api/votes":
            return self._json({"votes": store.list_votes(), "people": store.list_people()})
        m = re.match(r"^/api/listings/([a-f0-9]+)$", p)
        if m:
            l = store.get_listing(m.group(1))
            return self._json(l) if l else self._json({"error": "not found"}, 404)
        return self._static(p)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/api/listings":
            body = self._body()
            url = (body.get("url") or "").strip()
            segment = body.get("segment") or "lima1"
            addedBy = (body.get("addedBy") or body.get("person") or "anonimo").strip()
            if "airbnb." not in url:
                return self._json({"error": "Pega un enlace valido de Airbnb (airbnb.com/rooms/...)"}, 400)
            try:
                rid = enrich_mod.parse_airbnb_id(url)
            except Exception:
                rid = None
            existing = next((l for l in store.list_listings()
                             if (rid and l.get("roomId") == rid) or l.get("url") == url), None)
            if existing:
                return self._json({**existing, "duplicate": True}, 200)
            lid = uuid.uuid4().hex[:12]
            listing = {"id": lid, "url": url, "segment": segment, "addedBy": addedBy,
                       "addedAt": store.now_iso(), "status": "enriching", "name": "Procesando..."}
            store.upsert_listing(listing)
            threading.Thread(target=_run_enrichment, args=(lid, url, segment), daemon=True).start()
            return self._json(listing, 201)
        if p == "/api/votes":
            body = self._body()
            if not body.get("listingId") or not body.get("person"):
                return self._json({"error": "faltan datos"}, 400)
            vote = {"listingId": body["listingId"], "person": body["person"].strip(),
                    "score": float(body.get("score", 0)), "comment": (body.get("comment") or "").strip(),
                    "at": store.now_iso()}
            store.add_vote(vote)
            return self._json(vote, 201)
        if p == "/api/weights":
            return self._json({"weights": store.set_weights(self._body())})
        m = re.match(r"^/api/listings/([a-f0-9]+)/refresh$", p)
        if m:
            lid = m.group(1)
            l = store.get_listing(lid)
            if not l:
                return self._json({"error": "not found"}, 404)
            store.update_listing(lid, {"status": "enriching"})
            threading.Thread(target=_run_enrichment, args=(lid, l["url"], l["segment"]), daemon=True).start()
            return self._json(store.get_listing(lid))
        return self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        u = urlparse(self.path)
        m = re.match(r"^/api/listings/([a-f0-9]+)$", u.path)
        if m:
            store.delete_listing(m.group(1))
            return self._json({"ok": True})
        return self._json({"error": "not found"}, 404)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"airbnb-trip-compare escuchando en http://0.0.0.0:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
