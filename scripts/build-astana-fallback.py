"""Build an Astana POI snapshot from a Geofabrik Kazakhstan OSM PBF.

Usage:
  python scripts/build-astana-fallback.py --input path/to/kazakhstan.osm.pbf
  python scripts/build-astana-fallback.py

The second form downloads Geofabrik's latest Kazakhstan extract to a temporary
file. The generated JSON is a fallback for unavailable live place search, not a
claim that every venue is present, open, or suitable for a particular request.
Requires ``pip install osmium`` (PyOsmium).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import osmium
import osmium.replication


ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_PATH = ROOT / "data" / "astana-boundary.geojson"
DEFAULT_OUTPUT = ROOT / "data" / "astana-dynamic-fallback.json"
DEFAULT_PBF_URL = "https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf"

# Categories are broad discovery candidates, not a handpicked venue list.
PLACE_TAGS = {
    "amenity": {
        "arts_centre", "bar", "biergarten", "cafe", "cinema", "community_centre",
        "events_venue", "fast_food", "food_court", "ice_cream", "library",
        "music_venue", "nightclub", "planetarium", "pub", "restaurant", "theatre",
    },
    "tourism": {"artwork", "attraction", "gallery", "museum", "viewpoint", "zoo"},
    "leisure": {
        "bowling_alley", "escape_game", "fitness_centre", "garden", "marina",
        "park", "playground", "sports_centre", "stadium", "water_park",
    },
    "historic": {"archaeological_site", "memorial", "monument"},
    "shop": {"art", "books", "coffee", "confectionery", "gift", "mall"},
}
LANDMARK_TAGS = {
    "aeroway": {"aerodrome", "terminal"},
    "railway": {"station", "halt"},
    "public_transport": {"station"},
    "amenity": {"bus_station", "university"},
    "shop": {"mall"},
    "leisure": {"park", "stadium"},
    "tourism": {"attraction", "museum"},
    "place": {"borough", "neighbourhood", "quarter", "suburb"},
}
RETAIN_TAGS = {
    "name", "name:ru", "name:kk", "name:en", "amenity", "tourism", "leisure",
    "historic", "shop", "aeroway", "railway", "public_transport", "place",
    "building", "opening_hours", "website", "contact:website", "phone",
    "addr:city", "addr:street", "addr:housenumber", "wheelchair", "fee",
    "internet_access", "internet_access:fee", "socket", "outdoor_seating",
    "live_music", "music", "description",
}
BLOCKED_LIFECYCLE_KEYS = {"disused", "abandoned", "demolished", "proposed", "construction"}
LONG_VISIT = {"museum", "gallery", "zoo", "water_park", "park", "cinema", "theatre"}
SHORT_VISIT = {"artwork", "monument", "memorial", "viewpoint", "attraction"}


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ring_contains(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat):
            crossing_lon = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lon < crossing_lon:
                inside = not inside
        previous = current
    return inside


def polygon_contains(lon: float, lat: float, polygons: list) -> bool:
    for polygon in polygons:
        if polygon and ring_contains(lon, lat, polygon[0]):
            if not any(ring_contains(lon, lat, hole) for hole in polygon[1:]):
                return True
    return False


def choose_category(tags: dict[str, str], groups: dict[str, set[str]]) -> str | None:
    for key, allowed in groups.items():
        if tags.get(key) in allowed:
            if key == "shop" and tags[key] == "books":
                return "bookshop"
            if key == "amenity" and tags[key] == "pub":
                return "bar"
            return tags[key]
    return None


def normalized_name(tags: dict[str, str]) -> str:
    return (tags.get("name:ru") or tags.get("name:kk") or tags.get("name") or tags.get("name:en") or "").strip()


def is_active(tags: dict[str, str]) -> bool:
    if tags.get("access") in {"private", "no"}:
        return False
    if any(key in tags for key in BLOCKED_LIFECYCLE_KEYS):
        return False
    if any(key.startswith(tuple(f"{state}:" for state in BLOCKED_LIFECYCLE_KEYS)) for key in tags):
        return False
    return True


def visit_minutes(category: str) -> int:
    if category in LONG_VISIT:
        return 75
    if category in SHORT_VISIT:
        return 20
    if category in {"bar", "nightclub", "pub", "restaurant", "events_venue"}:
        return 90
    return 45


def build_poi(osm_type: str, osm_id: int, tags: dict[str, str], lat: float, lon: float,
              category: str) -> dict:
    names = {code: tags[f"name:{code}"] for code in ("ru", "kk", "en") if tags.get(f"name:{code}")}
    point = {
        "id": f"osm:{osm_type}:{osm_id}",
        "name": normalized_name(tags),
        "category": category,
        "description": f"{category} по данным OpenStreetMap; условия посещения не проверены.",
        "descriptionSource": "category_template",
        "lat": round(lat, 7),
        "lon": round(lon, 7),
        "visitMinutes": visit_minutes(category),
        "sourceUrl": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
        "osmType": osm_type,
        "osmId": osm_id,
        "tags": {key: value for key, value in tags.items() if key in RETAIN_TAGS},
    }
    if names:
        point["names"] = names
    return point


class AstanaCollector(osmium.SimpleHandler):
    def __init__(self, polygons: list) -> None:
        super().__init__()
        self.polygons = polygons
        self.nodes: dict[int, tuple[float, float]] = {}
        self.pois: list[dict] = []
        self.landmarks: list[dict] = []
        points = [point for polygon in polygons for ring in polygon for point in ring]
        self.west = min(point[0] for point in points)
        self.east = max(point[0] for point in points)
        self.south = min(point[1] for point in points)
        self.north = max(point[1] for point in points)
        self.stats = Counter()

    def in_bbox(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east

    def accept(self, osm_type: str, osm_id: int, tags: dict[str, str], lat: float, lon: float) -> None:
        if not normalized_name(tags) or not is_active(tags):
            return
        place_category = choose_category(tags, PLACE_TAGS)
        landmark_category = choose_category(tags, LANDMARK_TAGS)
        if not place_category and not landmark_category:
            return
        if not polygon_contains(lon, lat, self.polygons):
            return
        if place_category:
            self.pois.append(build_poi(osm_type, osm_id, tags, lat, lon, place_category))
            self.stats[f"poi:{place_category}"] += 1
        if landmark_category:
            self.landmarks.append(build_poi(osm_type, osm_id, tags, lat, lon, landmark_category))
            self.stats[f"landmark:{landmark_category}"] += 1

    def node(self, node: osmium.osm.Node) -> None:
        if not node.location.valid():
            return
        lat, lon = node.location.lat, node.location.lon
        if not self.in_bbox(lat, lon):
            return
        self.nodes[node.id] = (lat, lon)
        if not node.tags:
            return
        self.accept("node", node.id, dict(node.tags), lat, lon)

    def way(self, way: osmium.osm.Way) -> None:
        tags = dict(way.tags)
        if not normalized_name(tags) or not is_active(tags):
            return
        if not choose_category(tags, PLACE_TAGS) and not choose_category(tags, LANDMARK_TAGS):
            return
        points = [self.nodes.get(ref.ref) for ref in way.nodes]
        points = [point for point in points if point is not None]
        if not points:
            return
        # A way point is the centre of its OSM nodes' bounding box, not an entrance.
        lat = (min(point[0] for point in points) + max(point[0] for point in points)) / 2
        lon = (min(point[1] for point in points) + max(point[1] for point in points)) / 2
        self.accept("way", way.id, tags, lat, lon)


def fetch_pbf(url: str, target: Path) -> None:
    """Download in verified 8 MiB ranges, resuming a matching cached extract."""
    headers = {"User-Agent": "SmartCityAstanaSnapshot/1.0"}
    probe = Request(url, headers={**headers, "Range": "bytes=0-0"})
    with urlopen(probe, timeout=60) as response:
        content_range = response.headers.get("Content-Range", "")
        match = re.fullmatch(r"bytes 0-0/(\d+)", content_range)
        if response.status != 206 or match is None:
            raise RuntimeError("Geofabrik did not return a byte range for the PBF probe")
        total = int(match.group(1))
        identity = {
            "url": url,
            "bytes": total,
            "etag": response.headers.get("ETag"),
            "lastModified": response.headers.get("Last-Modified"),
        }

    metadata_path = target.with_name(target.name + ".meta.json")
    try:
        cached_identity = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        cached_identity = None
    if cached_identity != identity or (target.exists() and target.stat().st_size > total):
        target.write_bytes(b"")
        metadata_path.write_text(json.dumps(identity), encoding="utf-8")
    elif not target.exists():
        target.touch()

    chunk_size = 8 * 1024 * 1024
    while (start := target.stat().st_size) < total:
        end = min(start + chunk_size, total) - 1
        request = Request(url, headers={**headers, "Range": f"bytes={start}-{end}"})
        for attempt in range(5):
            try:
                with urlopen(request, timeout=60) as response:
                    expected_range = f"bytes {start}-{end}/{total}"
                    if response.status != 206 or response.headers.get("Content-Range") != expected_range:
                        raise RuntimeError(f"Unexpected PBF range: {response.headers.get('Content-Range')}")
                    payload = response.read(end - start + 1)
                    if len(payload) != end - start + 1:
                        raise IOError(f"Incomplete PBF range {start}-{end}: {len(payload)} bytes")
                with target.open("ab") as output:
                    output.write(payload)
                print(f"Downloaded {end + 1:,}/{total:,} bytes", file=sys.stderr)
                break
            except Exception:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Local Kazakhstan OSM PBF; omit to download the latest")
    parser.add_argument("--url", default=DEFAULT_PBF_URL, help="PBF source URL when --input is omitted")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--source-url", help="Original extract URL when --input points to a downloaded PBF")
    args = parser.parse_args()

    boundary = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
    feature = boundary["features"][0]
    assert feature["geometry"]["type"] == "MultiPolygon"
    polygons = feature["geometry"]["coordinates"]

    pbf = args.input
    if pbf is None:
        pbf = Path(tempfile.gettempdir()) / "smart-city-kazakhstan-latest.osm.pbf"
        print(f"Downloading {args.url}", file=sys.stderr)
        fetch_pbf(args.url, pbf)
    if not pbf.is_file():
        parser.error(f"PBF not found: {pbf}")

    collector = AstanaCollector(polygons)
    collector.apply_file(str(pbf))
    header = osmium.replication.get_replication_header(str(pbf))
    osm_time = header.timestamp.isoformat().replace("+00:00", "Z") if header.timestamp else None

    if len(collector.pois) < 100:
        raise RuntimeError(f"Only {len(collector.pois)} POIs extracted; refusing to replace fallback")

    key = lambda poi: (poi["name"].casefold(), poi["id"])
    collector.pois.sort(key=key)
    collector.landmarks.sort(key=key)
    data = {
        "schemaVersion": 1,
        "zone": {
            "id": "astana",
            "name": "Астана",
            "center": {"lat": 51.1282, "lon": 71.4304},
            "radiusMeters": 35000,
            "boundarySourceUrl": feature["properties"]["sourceUrl"],
        },
        "source": {
            "provider": "OpenStreetMap",
            "importedAt": timestamp(),
            "osmBaseTimestamp": osm_time,
            "attribution": "© OpenStreetMap contributors",
            "licenseUrl": "https://www.openstreetmap.org/copyright",
            "extractUrl": args.source_url or args.url,
            "extractProvider": "Geofabrik",
        },
        "pois": collector.pois,
        "landmarks": collector.landmarks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(collector.pois)} POIs and {len(collector.landmarks)} landmarks to {args.output}")
    print(json.dumps(collector.stats.most_common(20), ensure_ascii=False))


if __name__ == "__main__":
    main()
