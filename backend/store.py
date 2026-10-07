import json
import os
import threading
import time

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "db.json")

_LOCK = threading.RLock()

_EMPTY = {"listings": {}, "votes": [], "people": [], "weights": {}}


def _ensure():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        _write(_EMPTY)


def _read():
    _ensure()
    with open(DB_PATH, "r", encoding="utf-8") as fh:
        try:
            return json.load(fh)
        except json.JSONDecodeError:
            return json.loads(json.dumps(_EMPTY))


def _write(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, DB_PATH)


def all_data():
    with _LOCK:
        return _read()


def list_listings():
    with _LOCK:
        return list(_read()["listings"].values())


def get_listing(lid):
    with _LOCK:
        return _read()["listings"].get(lid)


def upsert_listing(listing):
    with _LOCK:
        data = _read()
        data["listings"][listing["id"]] = listing
        _write(data)
        return listing


def update_listing(lid, patch):
    with _LOCK:
        data = _read()
        if lid not in data["listings"]:
            return None
        data["listings"][lid].update(patch)
        _write(data)
        return data["listings"][lid]


def delete_listing(lid):
    with _LOCK:
        data = _read()
        removed = data["listings"].pop(lid, None)
        data["votes"] = [v for v in data["votes"] if v["listingId"] != lid]
        _write(data)
        return removed


def add_vote(vote):
    with _LOCK:
        data = _read()
        data["votes"] = [v for v in data["votes"] if not (v["listingId"] == vote["listingId"] and v["person"].lower() == vote["person"].lower())]
        data["votes"].append(vote)
        if vote["person"] not in data["people"]:
            data["people"].append(vote["person"])
        _write(data)
        return vote


def list_votes():
    with _LOCK:
        return _read()["votes"]


def list_people():
    with _LOCK:
        return _read()["people"]


def get_weights():
    with _LOCK:
        return _read().get("weights", {})


def set_weights(weights):
    with _LOCK:
        data = _read()
        data["weights"] = weights
        _write(data)
        return weights


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
