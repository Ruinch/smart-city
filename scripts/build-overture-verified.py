"""Build a small, address-corroborated Astana Overture snapshot offline.

Usage: python scripts/build-overture-verified.py PLACES.geojsonseq OSM-ADDRESSES.json VETTED-EVIDENCE.json

The inputs are local research extracts, not downloaded by this script. It never
claims an OSM address verifies that a business is operating. Run the TypeScript
importer tests before publishing the resulting snapshot.
"""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/astana-overture-verified.json"
OSM_POIS = ROOT / "data/astana-dynamic-fallback.json"
RESEARCH_QUEUE = ROOT / "data/research/astana-overture-candidates.json"
KAZAKH_TO_COMMON = str.maketrans("қғңәөүұіё", "кгнаоууие")
ADDRESS_WORDS = {
    "улица", "ул", "street", "st", "көшесі", "көше", "кошеси", "коше",
    "проспект", "пр", "avenue", "ave", "даңғылы", "дангылы", "г", "город",
    "астана", "дом", "д", "корпус",
}
CATEGORIES = {
    "restaurant": "restaurant", "gastropub": "restaurant", "cafe": "cafe",
    "coffee_shop": "cafe", "bar": "bar", "pub": "bar", "beer_bar": "bar",
    "cocktail_bar": "bar", "sports_bar": "bar", "nightclub": "nightclub",
    "karaoke_venue": "karaoke", "shopping_mall": "mall", "library": "library",
    "bookstore": "bookshop", "movie_theater": "cinema", "theatre_venue": "theatre",
    "museum": "museum", "art_gallery": "gallery", "park": "park", "garden": "garden",
    "bowling_alley": "bowling_alley", "escape_game": "escape_game",
    "fitness_center": "fitness_centre", "sports_center": "sports_centre",
    "stadium": "stadium", "water_park": "water_park", "confectionery": "confectionery",
    "ice_cream_shop": "ice_cream", "zoo": "zoo",
}
RARE_CATEGORIES = {"mall", "library", "theatre", "cinema", "museum", "gallery", "stadium"}
SOURCES = {"meta", "foursquare", "microsoft", "alltheplaces", "brightquery", "pinmeto", "dac", "krick", "renderseo"}
ADDRESS_PREFIX_MISMATCH_IDS = {
    "6107a684-e34d-479c-b46a-934fd617f829",  # Festival Avenue / Dostyk 4
    "d10ba25c-7914-4961-bd0b-d7a5c7bdd2c7",  # TC Green Mall / Syganak 17P
    "0fe823d3-4f33-4999-9177-0217c759a7a8",  # Khan Shatyr Mall / Turan 37
    "c8cccf3c-a72b-451b-9b77-622c0d820fec",  # TC Moskva / Dostyk 18
}


def tokens(value: str) -> list[str]:
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).casefold().translate(KAZAKH_TO_COMMON))


def address_key(value: str) -> str:
    """Keep every house number component; 60/5 must never equal 60/1."""
    return " ".join(sorted(token for token in tokens(value) if token not in ADDRESS_WORDS))


def name_key(value: str) -> str:
    return " ".join(tokens(value))


def meters(a: dict, b: dict) -> float:
    return math.hypot(
        (a["lat"] - b["lat"]) * 111_000,
        (a["lon"] - b["lon"]) * 111_000 * math.cos(math.radians(a["lat"])),
    )


def read_overture(path: Path) -> list[dict]:
    places = []
    with path.open(encoding="utf-8") as source:
        for line in source:
            feature = json.loads(line)
            if feature.get("geometry", {}).get("type") != "Point":
                continue
            lon, lat = feature["geometry"]["coordinates"]
            feature["_point"] = {"lat": lat, "lon": lon}
            properties = feature["properties"]
            addresses = properties.get("addresses") or []
            feature["_address"] = (addresses[0] or {}).get("freeform") if addresses else ""
            places.append(feature)
    return places


def scattered_ids(places: list[dict]) -> set[str]:
    by_address = defaultdict(list)
    for place in places:
        address = place["_address"] or ""
        # A low-confidence or unrelated place must not quarantine a stronger one.
        if place["properties"].get("confidence", 0) >= 0.8 and re.search(r"\d", address):
            by_address[address_key(address)].append(place)
    rejected = set()
    for group in by_address.values():
        if any(meters(a["_point"], b["_point"]) > 500
               for index, a in enumerate(group) for b in group[index + 1:]):
            rejected.update(place["id"] for place in group)
    return rejected


def existing_duplicate(name: str, category: str, point: dict, pois: list[dict]) -> bool:
    for poi in pois:
        distance = meters(point, poi)
        if distance > 220:
            continue
        existing = name_key(poi["name"])
        candidate = name_key(name)
        if candidate == existing:
            return True
        if distance <= 100 and SequenceMatcher(None, candidate, existing).ratio() >= 0.78:
            return True
        if distance <= 100 and category in RARE_CATEGORIES and poi["category"] == category:
            return True
    return False


def build(raw_path: Path, osm_path: Path, evidence_path: Path) -> tuple[dict, dict[str, int]]:
    raw = read_overture(raw_path)
    osm_rows = json.loads(osm_path.read_text(encoding="utf-8"))["rows"]
    pois = json.loads(OSM_POIS.read_text(encoding="utf-8"))["pois"]
    existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
    vetted = json.loads(evidence_path.read_text(encoding="utf-8"))
    if vetted.get("schemaVersion") != 1 or vetted.get("candidateOnly") is not True:
        raise ValueError("Vetted evidence must be a reviewed schemaVersion 1 ledger")
    vetted_ids = {place["id"].removeprefix("overture:") for place in vetted["places"]}
    queue = json.loads(RESEARCH_QUEUE.read_text(encoding="utf-8"))["places"]
    manual_excluded_ids = {
        queue[int(index)]["id"].removeprefix("overture:")
        for index in vetted.get("manualExclusions", {})
    }
    official = [place for place in existing["places"]
                if place.get("verification", {}).get("kind") == "official_site"]
    official_ids = {place["id"] for place in official}
    addresses = defaultdict(list)
    for row in osm_rows:
        if (row.get("type") in {"node", "way", "relation"} and row.get("street")
                and row.get("house") and re.search(r"\d", row["house"])):
            addresses[address_key(row["street"] + " " + row["house"])].append(row)
    quarantined = scattered_ids(raw)
    counts = defaultdict(int)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    selected = list(official)
    for feature in raw:
        properties = feature["properties"]
        category = (properties.get("taxonomy") or {}).get("primary")
        confidence = properties.get("confidence")
        if category not in CATEGORIES or not isinstance(confidence, (int, float)) or confidence < 0.8:
            continue
        if feature["id"] not in vetted_ids or feature["id"] in manual_excluded_ids:
            continue
        if feature["id"] in ADDRESS_PREFIX_MISMATCH_IDS:
            continue
        if "overture:" + feature["id"] in official_ids:
            continue
        name = ((properties.get("names") or {}).get("primary") or "").strip().replace("\n", " ")
        address = feature["_address"] or ""
        if not name or not re.search(r"\d", address):
            counts["identity"] += 1
            continue
        if category == "lounge" and not re.search(r"(?:^|[\s-])(?:bar|бар)(?:$|[\s-])", name, re.I):
            counts["ambiguous_lounge"] += 1
            continue
        if re.search(r"(?:^астана\s+ул|\.kz$|\.com$)", name, re.I):
            counts["junk_name"] += 1
            continue
        if feature["id"] in quarantined:
            counts["scattered_address"] += 1
            continue
        matches = sorted(((meters(feature["_point"], row), row)
                          for row in addresses[address_key(address)]), key=lambda item: item[0])
        matches = [item for item in matches if item[0] <= 150]
        if not matches:
            continue
        if existing_duplicate(name, CATEGORIES[category], feature["_point"], pois):
            counts["osm_poi_duplicate"] += 1
            continue
        source = next((source for source in properties.get("sources") or []
                       if source.get("property") == "" and str(source.get("dataset", "")).lower() in SOURCES), None)
        if not source or not source.get("record_id"):
            counts["source"] += 1
            continue
        osm_address = matches[0][1]
        selected.append({
            "id": "overture:" + feature["id"], "name": name, "category": category,
            **feature["_point"], "address": address, "confidence": confidence,
            "provider": "Overture Maps", "sourceProvider": source["dataset"].lower(),
            "sourceRecordId": str(source["record_id"]), "sourceLicense": source["license"],
            "verification": {
                "kind": "osm_address",
                "sourceUrl": f"https://www.openstreetmap.org/{osm_address['type']}/{osm_address['id']}",
                "checkedAt": now,
                "address": osm_address["street"] + " " + osm_address["house"],
                "street": osm_address["street"], "houseNumber": osm_address["house"],
                "lat": osm_address["lat"], "lon": osm_address["lon"],
            },
        })
    if evidence_path:
        selected_ids = {place["id"] for place in selected}
        for place in vetted["places"]:
            raw_id = place["id"].removeprefix("overture:")
            if (place["id"] in selected_ids or raw_id in quarantined
                    or raw_id in ADDRESS_PREFIX_MISMATCH_IDS or raw_id in manual_excluded_ids):
                continue
            if place["category"] == "lounge" and not re.search(
                    r"(?:^|[\s-])(?:bar|бар)(?:$|[\s-])", place["name"], re.I):
                continue
            entry = dict(place)
            entry["provider"] = "Overture Maps"
            entry["verification"] = dict(entry["verification"])
            entry["verification"]["checkedAt"] = now
            selected.append(entry)
            selected_ids.add(entry["id"])
    selected.sort(key=lambda place: (place["category"], place["name"].casefold()))
    existing["places"] = selected
    existing["source"].update({
        "retrievedAt": datetime.fromtimestamp(raw_path.stat().st_mtime, timezone.utc)
        .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "verificationExtractUrl": "https://download.geofabrik.de/asia/kazakhstan-261018.osm.pbf",
        "verificationAttribution": "© OpenStreetMap contributors; ODbL 1.0; https://www.openstreetmap.org/copyright",
        "verificationPolicy": "Official venue map or same full house number and exactly equivalent street after Russian/Kazakh/Latin transliteration within 150 m; confidence >= 0.8, supported activity category, reviewed duplicate exclusions and no scattered-address group. Business status, hours, prices and accessibility are unverified.",
    })
    return existing, dict(counts)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: python scripts/build-overture-verified.py PLACES.geojsonseq OSM-ADDRESSES.json VETTED-EVIDENCE.json")
    snapshot, rejected = build(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(snapshot['places'])} places to {OUTPUT}; filtered: {rejected}")
