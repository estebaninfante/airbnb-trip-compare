import json
import os
import re
import sys
import time

import pyairbnb

from data_config import TRIP

AREAS = [
    {"id": "lima", "segment": "lima1", "label": "Lima (Miraflores / Barranco / San Isidro)",
     "ne_lat": -12.055, "ne_long": -76.975, "sw_lat": -12.185, "sw_long": -77.085, "zoom": 13},
    {"id": "paracas", "segment": "paracas", "label": "Paracas / Pisco (Ica)",
     "ne_lat": -13.795, "ne_long": -76.205, "sw_lat": -13.900, "sw_long": -76.300, "zoom": 14},
]

GOOD_DISTRICTS = ["miraflores", "barranco", "san isidro", "surco", "santiago de surco", "san borja",
                  "la molina", "magdalena", "jesus maria", "lince", "pueblo libre", "san miguel"]

GROUP_TOTAL = int(TRIP["group"]["total"])


def _seg(seg_id):
    for s in TRIP["segments"]:
        if s["id"] == seg_id:
            return s
    raise KeyError(seg_id)


def _num(value):
    if isinstance(value, (int, float)):
        return float(value)
    if not value:
        return None
    m = re.search(r"(\d[\d.,]*)", str(value).replace(" ", ""))
    return float(m.group(1).replace(",", "")) if m else None


def _line_items(structured):
    out = {}
    for key in ("mapPrimaryLine", "primaryLine"):
        for item in structured.get(key) or []:
            body = (item.get("body") or "").lower()
            num = re.search(r"(\d+(?:[.,]\d+)?)", body)
            if not num:
                continue
            val = float(num.group(1).replace(",", "."))
            if "bedroom" in body:
                out["bedrooms"] = int(val)
            elif "bed" in body:
                out["beds"] = int(val)
            elif "bath" in body:
                out["baths"] = val
            elif "guest" in body:
                out["guests"] = int(val)
        if out:
            break
    return out


def _parse(raw):
    structured = raw.get("structuredContent") or {}
    info = _line_items(structured)
    price = raw.get("price") or {}
    unit = price.get("unit") or {}
    total = price.get("total") or {}
    rating = raw.get("rating") or {}
    coords = raw.get("coordinates") or {}
    room_id = raw.get("room_id")
    images = raw.get("images") or []
    first_image = None
    if images and isinstance(images[0], dict):
        first_image = images[0].get("url") or (images[0].get("baseUrl"))
    return {
        "roomId": room_id,
        "url": f"https://www.airbnb.com/rooms/{room_id}",
        "name": raw.get("name"),
        "bedrooms": info.get("bedrooms"),
        "beds": info.get("beds"),
        "baths": info.get("baths"),
        "guests": info.get("guests"),
        "pricePerNight": _num(unit.get("amount")),
        "priceTotal": _num(total.get("amount")) or _num(unit.get("amount")),
        "qualifier": unit.get("qualifier"),
        "rating": rating.get("value") or rating.get("guestSatisfaction"),
        "reviewCount": rating.get("reviewCount"),
        "lat": coords.get("latitude"),
        "lng": coords.get("longitude"),
        "image": first_image,
        "area": None,
        "segment": None,
    }


def search_area(area, seg):
    try:
        results = pyairbnb.search_all(
            check_in=seg["check_in"], check_out=seg["check_out"],
            ne_lat=area["ne_lat"], ne_long=area["ne_long"],
            sw_lat=area["sw_lat"], sw_long=area["sw_long"], zoom_value=area["zoom"],
            price_min=0, price_max=100000,
            adults=GROUP_TOTAL, min_bedrooms=5, min_beds=6, min_bathrooms=3,
            currency="USD", language="en",
        )
    except Exception as e:
        print(f"[{area['id']}] search error: {e}", file=sys.stderr)
        return []
    out = []
    for raw in results or []:
        item = _parse(raw)
        item["area"] = area["id"]
        item["segment"] = area["segment"]
        out.append(item)
    print(f"[{area['id']}] {len(out)} resultados", file=sys.stderr)
    return out


def run():
    all_items = []
    seen = set()
    for area in AREAS:
        seg = _seg(area["segment"])
        for item in search_area(area, seg):
            if not item["roomId"] or item["roomId"] in seen:
                continue
            seen.add(item["roomId"])
            all_items.append(item)
        time.sleep(1.0)
    for item in all_items:
        item["inGoodDistrict"] = any(g in (item.get("name") or "").lower() for g in GOOD_DISTRICTS)
    all_items.sort(key=lambda x: (x.get("pricePerNight") or 999999))
    with open(os.path.join(os.path.dirname(__file__), "..", "data", "candidates.json"), "w", encoding="utf-8") as fh:
        json.dump(all_items, fh, ensure_ascii=False, indent=2)
    print(json.dumps(all_items, ensure_ascii=False, indent=2))
    return all_items


if __name__ == "__main__":
    run()
