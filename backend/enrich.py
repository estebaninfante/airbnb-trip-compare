import json
import math
import re
import threading
import time
import unicodedata
from datetime import date

import requests
import pyairbnb
from pyairbnb.price import UnavailableError

from data_config import ANCHOR_SETS, DISTRICT_SAFETY, DEFAULT_SAFETY, TRIP

UA = "airbnb-trip-compare/1.0 (personal trip planner; contact: estebaninfante)"
OSRM = "https://router.project-osrm.org"
NOMINATIM = "https://nominatim.openstreetmap.org"
OVERPASS = "https://overpass-api.de/api/interpreter"

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": UA, "Accept-Language": "es"})


def _norm(text):
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]", " ", text.lower()).strip()


def parse_airbnb_id(url):
    if not url:
        return None
    m = re.search(r"/rooms/(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"(\d{6,})", url)
    return m.group(1) if m else None


def _segment(segment_id):
    for seg in TRIP["segments"]:
        if seg["id"] == segment_id:
            return seg
    return TRIP["segments"][0]


def _flatten_amenities(raw):
    out = []
    for group in raw or []:
        for item in group.get("values", []):
            if item.get("available", True):
                out.append(item.get("title", "").strip())
    seen = []
    for a in out:
        if a and a not in seen:
            seen.append(a)
    return seen


def _extract_reviews(raw):
    out = []
    for r in raw or []:
        out.append({
            "id": r.get("id"),
            "comments": (r.get("comments") or "").strip(),
            "date": r.get("createdAt"),
            "language": r.get("language"),
            "rating": r.get("rating") or r.get("ratingValue"),
        })
    return out[:12]


def _rating_summary(raw):
    if not raw:
        return {}
    return {
        "overall": raw.get("guest_satisfaction"),
        "accuracy": raw.get("accuracy"),
        "checkin": raw.get("checking"),
        "cleanliness": raw.get("cleanliness"),
        "communication": raw.get("communication"),
        "location": raw.get("location"),
        "value": raw.get("value"),
        "reviews": int(raw["review_count"]) if str(raw.get("review_count", "")).isdigit() else 0,
    }


def _name_from_html(html):
    try:
        m = re.search(r'<script id="data-deferred-state-0"[^>]*>(.*?)</script>', html, re.S)
        if not m:
            return {}
        data = json.loads(m.group(1))
        found = {}

        def walk(node):
            if found:
                return
            if isinstance(node, dict):
                emb = node.get("embedData")
                if isinstance(emb, dict) and emb.get("name"):
                    found.update({
                        "name": emb.get("name"),
                        "starRating": emb.get("starRating"),
                        "reviewCount": emb.get("reviewCount"),
                        "propertyType": emb.get("propertyType"),
                        "pictureUrl": emb.get("pictureUrl"),
                    })
                    return
                for v in node.values():
                    walk(v)
            elif isinstance(node, list):
                for v in node:
                    walk(v)

        walk(data)
        return found
    except Exception:
        return {}


def _overview_from_html(html):
    out = {}
    try:
        m = re.search(r'"overview":\{"__typename":"StaysPdpOverview".*?"items":(\[[^\]]*\])', html, re.S)
        if not m:
            return out
        items = json.loads(m.group(1))
        out["overview"] = items
        for it in items:
            low = it.lower()
            num = re.search(r"(\d+(?:[.,]\d+)?)", low)
            if not num:
                continue
            val = float(num.group(1).replace(",", "."))
            if "huésped" in low or "huesped" in low or "guest" in low or "persona" in low:
                out["capacityOverview"] = int(val)
            elif "habitacion" in low or "habitación" in low or "recámara" in low or "recamara" in low or "bedroom" in low:
                out["bedrooms"] = int(val)
            elif "cama" in low or "bed" in low:
                out["beds"] = int(val)
            elif "baño" in low or "bano" in low or "bath" in low:
                out["baths"] = val
    except Exception:
        pass
    return out


_AIRBNB_LOCK = threading.Lock()
_last_airbnb_request = [0.0]


def _throttle(min_gap=3.0):
    with _AIRBNB_LOCK:
        wait = min_gap - (time.time() - _last_airbnb_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_airbnb_request[0] = time.time()


def _fetch_html_raw(url):
    from curl_cffi import requests as creq
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    for attempt in range(5):
        _throttle(2.0)
        try:
            r = creq.get(url, headers=headers, impersonate="chrome", timeout=30)
            if r.status_code == 200 and "data-deferred-state-0" in r.text:
                return r.text
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def _details_from_html(url):
    import pyairbnb.parse as pparse
    html = _fetch_html_raw(url)
    if not html:
        raise RuntimeError("Airbnb no entrego la pagina del listing (posible limite temporal)")
    data, price_input = pparse.parse_body_details_wrapper(html)
    try:
        _throttle(3.0)
        revs = pyairbnb.reviews.get(api_key=price_input["api_key"], product_id=price_input["product_id"],
                                    currency="USD", language="es")
        if isinstance(revs, str):
            try:
                revs = json.loads(revs)
            except Exception:
                revs = []
        data["reviews"] = revs
    except Exception:
        data["reviews"] = []
    data["_pdp"] = _name_from_html(html)
    data["_pdp"].update(_overview_from_html(html))
    return data


def _get_details(url):
    last = None
    for attempt in range(3):
        try:
            return _details_from_html(url)
        except Exception as e:
            last = e
            time.sleep(2.0 * (attempt + 1))
    return pyairbnb.get_details(room_url=url, currency="USD", language="es")


def fetch_details(url):
    room_id = parse_airbnb_id(url)
    details = _get_details(url)
    pdp = details.pop("_pdp", {}) or {}
    title = details.get("title") or []
    if isinstance(title, list):
        title = title[0] if title else ""
    name = pdp.get("name") or title or (details.get("description") or "").strip()[:80] or f"Airbnb {room_id}"
    images = [img.get("url") for img in (details.get("images") or []) if img.get("url")]
    if pdp.get("pictureUrl") and pdp["pictureUrl"] not in images:
        images.insert(0, pdp["pictureUrl"])
    coords = details.get("coordinates") or {}
    return {
        "roomId": room_id,
        "name": name,
        "description": (details.get("description") or "").strip(),
        "images": images[:8],
        "lat": coords.get("latitude"),
        "lng": coords.get("longitude"),
        "personCapacity": details.get("person_capacity"),
        "bedrooms": pdp.get("bedrooms"),
        "beds": pdp.get("beds"),
        "baths": pdp.get("baths"),
        "overview": pdp.get("overview") or [],
        "roomType": details.get("room_type"),
        "propertyType": pdp.get("propertyType"),
        "isSuperhost": bool(details.get("is_super_host")),
        "homeTier": details.get("home_tier"),
        "amenities": _flatten_amenities(details.get("amenities")),
        "rating": _rating_summary(details.get("rating")),
        "reviews": _extract_reviews(details.get("reviews")),
        "host": (details.get("host") or {}).get("name") or "",
        "houseRules": details.get("house_rules"),
    }


def _num(value):
    if isinstance(value, (int, float)):
        return float(value)
    if not value:
        return None
    m = re.search(r"(\d[\d.,]*)", str(value).replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except Exception:
        return None


def fetch_price(room_id, seg, capacity=None):
    group = int(TRIP["group"]["total"])
    adults = group
    if capacity:
        try:
            adults = max(1, min(group, int(capacity)))
        except Exception:
            adults = group
    try:
        nights = (date.fromisoformat(seg["check_out"]) - date.fromisoformat(seg["check_in"])).days
    except Exception:
        nights = None
    try:
        raw = pyairbnb.get_price(
            str(room_id),
            date.fromisoformat(seg["check_in"]),
            date.fromisoformat(seg["check_out"]),
            adults=adults,
            currency="USD",
            language="en",
        )
    except UnavailableError as e:
        return {"available": False, "adults": adults, "reason": str(e)}
    except Exception as e:
        return {"available": False, "adults": adults, "reason": f"error: {e}"}

    main = raw.get("main") or {}
    price = main.get("price")
    total = _num(price.get("amount")) if isinstance(price, dict) else None
    if total is None:
        details = main.get("details") or {}
        candidates = [_num(v) for v in details.values()]
        candidates = [c for c in candidates if c]
        if candidates:
            total = max(candidates)
    if total is None:
        for grp in raw.get("raw") or []:
            if isinstance(grp, dict):
                p = grp.get("price")
                total = _num(p.get("amount")) if isinstance(p, dict) else None
                if total:
                    break
    per_night = round(total / nights, 2) if total and nights else None
    per_person = round(per_night / group, 2) if per_night else None
    return {
        "available": True, "adults": adults, "currency": "USD",
        "total": total, "nights": nights, "perNight": per_night,
        "perPersonPerNight": per_person,
        "qualifier": main.get("qualifier"),
        "breakdown": main.get("details"),
        "capacityLimited": adults < group,
        "raw": main,
    }


def reverse_geocode(lat, lng):
    last = None
    for attempt in range(3):
        try:
            r = _SESSION.get(f"{NOMINATIM}/reverse", params={
                "format": "jsonv2", "lat": lat, "lon": lng, "addressdetails": 1, "accept-language": "es",
            }, timeout=20)
            r.raise_for_status()
            data = r.json()
            addr = data.get("address", {})
            district = _norm(addr.get("city_district") or addr.get("suburb") or addr.get("town")
                             or addr.get("village") or addr.get("municipality") or addr.get("county")
                             or addr.get("city") or "")
            return {
                "display": data.get("display_name", ""),
                "district": district,
                "city": addr.get("city") or addr.get("town") or addr.get("municipality") or "",
                "neighbourhood": addr.get("neighbourhood") or addr.get("suburb") or "",
                "state": addr.get("state") or "",
                "country": addr.get("country") or "",
            }
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    return {"error": str(last)}


def safety_for(geo):
    keys = [geo.get("district", ""), _norm(geo.get("city", "")), _norm(geo.get("neighbourhood", "")),
            _norm(geo.get("state", ""))]
    score, note = DEFAULT_SAFETY
    matched = None
    for key in keys:
        if key and key in DISTRICT_SAFETY:
            score, note = DISTRICT_SAFETY[key]
            matched = key
            break
    level = "alta" if score >= 8 else "media-alta" if score >= 7 else "media" if score >= 5.5 else "media-baja" if score >= 4 else "baja"
    return {"score": round(score, 1), "level": level, "note": note, "matched": matched,
            "source": "heuristica por distrito/ciudad (estimado)"}


def _route(origin, dest):
    url = f"{OSRM}/route/v1/driving/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    for attempt in range(3):
        try:
            r = _SESSION.get(url, params={"overview": "false"}, timeout=20)
            data = r.json()
            if data.get("code") == "Ok" and data.get("routes"):
                route = data["routes"][0]
                return {"distanceKm": round(route["distance"] / 1000, 1), "durationMin": round(route["duration"] / 60)}
        except Exception:
            pass
        time.sleep(1.0 * (attempt + 1))
    return None


def _haversine_km(a, b):
    r = 6371.0
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def routes_to_anchors(lat, lng, anchor_set):
    anchors = ANCHOR_SETS.get(anchor_set, [])
    out = []
    for a in anchors:
        route = _route((lat, lng), (a["lat"], a["lng"]))
        time.sleep(1.05)
        entry = {
            "key": a["key"], "label": a["label"], "weight": a["weight"],
            "distanceKm": None, "durationMin": None, "straightKm": round(_haversine_km((lat, lng), (a["lat"], a["lng"])), 1),
        }
        if route:
            entry.update(route)
        else:
            entry["distanceKm"] = entry["straightKm"]
            entry["durationMin"] = round(entry["straightKm"] / 22 * 60)
            entry["approx"] = True
        out.append(entry)
    return out


def _poi_query(lat, lng, radius):
    parts = [
        f'node["amenity"~"restaurant|cafe|fast_food|bar|pub|pharmacy|hospital|clinic|doctors|taxi|atm|bank"](around:{radius},{lat},{lng});',
        f'node["shop"~"supermarket|convenience|bakery|greengrocer"](around:{radius},{lat},{lng});',
        f'node["highway"="bus_stop"](around:{radius},{lat},{lng});',
        f'node["railway"="station"](around:{radius},{lat},{lng});',
        f'node["tourism"~"attraction|museum|viewpoint|gallery"](around:{radius},{lat},{lng});',
    ]
    return "[out:json][timeout:30];(" + "".join(parts) + ");out center tags;"


def _categorize(node):
    tags = node.get("tags", {})
    amenity = tags.get("amenity", "")
    shop = tags.get("shop", "")
    tourism = tags.get("tourism", "")
    if amenity in ("restaurant", "cafe", "fast_food", "bar", "pub"):
        return "gastronomia"
    if shop in ("supermarket", "convenience", "bakery", "greengrocer"):
        return "compras"
    if amenity in ("pharmacy", "hospital", "clinic", "doctors"):
        return "salud"
    if tags.get("highway") == "bus_stop" or amenity == "taxi" or tags.get("railway") == "station":
        return "transporte"
    if tourism in ("attraction", "museum", "viewpoint", "gallery"):
        return "turismo"
    if amenity in ("atm", "bank"):
        return "bancos"
    return None


def poi_counts(lat, lng, radius=1000):
    last = None
    for attempt in range(3):
        counts = {k: 0 for k in ["gastronomia", "compras", "salud", "transporte", "turismo", "bancos"]}
        try:
            r = _SESSION.post(OVERPASS, data={"data": _poi_query(lat, lng, radius)}, timeout=40)
            r.raise_for_status()
            for el in r.json().get("elements", []):
                cat = _categorize(el)
                if cat:
                    counts[cat] += 1
            total = sum(counts.values())
            walk = min(10.0, round(2.2 * math.log(1 + total), 1))
            return {"counts": counts, "total": total, "walkScore": walk, "radiusM": radius}
        except Exception as e:
            last = e
            time.sleep(2.0 * (attempt + 1))
    return {"counts": {k: 0 for k in ["gastronomia", "compras", "salud", "transporte", "turismo", "bancos"]},
            "total": 0, "error": str(last)}


def enrich(listing):
    seg = _segment(listing.get("segment"))
    result = {"status": "ready", "warnings": [], "segment": seg["id"]}
    try:
        details = fetch_details(listing["url"])
    except Exception as e:
        return {"status": "error", "error": f"No se pudo leer el listing: {e}", "segment": seg["id"]}
    result.update(details)
    if not result.get("lat"):
        result["warnings"].append("Sin coordenadas en el listing")
        result["status"] = "partial"
        return result
    result["price"] = fetch_price(result["roomId"], seg, result.get("personCapacity"))
    geo = reverse_geocode(result["lat"], result["lng"])
    time.sleep(1.05)
    result["geo"] = geo
    result["safety"] = safety_for(geo)
    result["pois"] = poi_counts(result["lat"], result["lng"])
    result["routes"] = routes_to_anchors(result["lat"], result["lng"], seg["anchor_set"])
    return result
