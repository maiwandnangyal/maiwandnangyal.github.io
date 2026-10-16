"""Refresh earthquakes/earthquakes.json with the latest earthquakes from the USGS catalogue.

Run by .github/workflows/update-earthquakes.yml every day; standard library only.
Same method as 1_download_earthquakes.py and 2_build_chart.py:
  - USGS FDSN event service, earthquakes of magnitude 4 or more in the map's box
  - each event placed in a district with the district shapes in districts.json
Each run downloads the last 60 days and replaces those 60 days in the published file, so new
events are added and recent ones that the USGS has revised (magnitude, depth, position) or
deleted are brought up to date. Everything older is kept as it is.
Safety: if the download fails or comes back incomplete, or the last 60 days suddenly hold
far fewer events than before, nothing is written and the run fails, so the live chart is
never damaged.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "earthquakes"
JSON_F, HTML_F, GEO_F = OUT / "earthquakes.json", OUT / "earthquakes.html", OUT / "districts.json"
API = "https://earthquake.usgs.gov/fdsnws/event/1/"
UA = {"User-Agent": "frontier-earthquakes-research/1.0 (academic, non-commercial)"}
BOX = {"minlatitude": 24.8, "maxlatitude": 38.6, "minlongitude": 60.4, "maxlongitude": 75.0}
MIN_MAG = 4
WINDOW_DAYS = 60
COLS = ["d", "la", "lo", "z", "m", "t", "u"]


def today():
    return datetime.now(timezone.utc).date()


def get(method, params, tries=4):
    q = dict(BOX, eventtype="earthquake", minmagnitude=MIN_MAG, **params)
    url = API + method + "?" + urllib.parse.urlencode(q)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry in {30 * (i + 1)}s after: {e}")
            time.sleep(30 * (i + 1))


# ---- point in polygon: the same code as in 2_build_chart.py
def _in_ring(x, y, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _polys(geom):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def make_locator(units):
    index = []
    for k, f in enumerate(units["features"]):
        for poly in _polys(f["geometry"]):
            xs = [p[0] for p in poly[0]]
            ys = [p[1] for p in poly[0]]
            index.append((min(xs), max(xs), min(ys), max(ys), poly, k))

    def locate(x, y):
        for x0, x1, y0, y1, poly, k in index:
            if x0 <= x <= x1 and y0 <= y <= y1 and _in_ring(x, y, poly[0]) \
                    and not any(_in_ring(x, y, hole) for hole in poly[1:]):
                return k
        return -1
    return locate


def main():
    old = json.loads(JSON_F.read_text())
    q = old["q"]
    n = len(q["d"])
    if any(len(q[c]) != n for c in COLS):
        sys.exit("The published earthquakes.json is inconsistent (columns of different length). Not writing.")
    epoch = date.fromisoformat(old["epoch"])
    end = today() + timedelta(days=1)
    start = end - timedelta(days=WINDOW_DAYS)
    a, b = start.isoformat(), end.isoformat()

    expected = int(json.loads(get("count", {"format": "geojson", "starttime": a, "endtime": b}))["count"])
    text = get("query", {"format": "csv", "starttime": a, "endtime": b, "orderby": "time-asc"})
    rows = list(csv.DictReader(io.StringIO(text)))
    if len(rows) != expected:
        sys.exit(f"USGS said {expected} events but sent {len(rows)}. Not writing.")
    seen, fresh = set(), []
    for r in rows:
        if r["id"] not in seen:
            seen.add(r["id"])
            fresh.append(r)

    cut = (start - epoch).days
    keep = [i for i in range(n) if q["d"][i] < cut]
    old_window = n - len(keep)
    if old_window >= 10 and len(fresh) < 0.5 * old_window:
        sys.exit(f"The last {WINDOW_DAYS} days now hold {len(fresh)} events against {old_window} before. Not writing.")

    locate = make_locator(json.loads(GEO_F.read_text())["units"])
    types = old["magTypes"]
    new = {c: [q[c][i] for i in keep] for c in COLS}
    for r in sorted(fresh, key=lambda r: r["time"]):
        x, y = float(r["longitude"]), float(r["latitude"])
        u = locate(x, y)
        mt = r["magType"] or "?"
        if mt not in types:
            types.append(mt)
        new["d"].append((date.fromisoformat(r["time"][:10]) - epoch).days)
        new["la"].append(round(y * 100))
        new["lo"].append(round(x * 100))
        new["z"].append(round(float(r["depth"])) if r["depth"] not in ("", None) else None)
        new["m"].append(round(float(r["mag"]) * 10))
        new["t"].append(types.index(mt))
        new["u"].append(u)

    out = dict(old, q=new, magTypes=types, asOf=today().isoformat())
    if out == old:                                 # same day, nothing new
        print("No change since the last update.")
        return
    JSON_F.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    stamp = time.strftime("%Y%m%d%H%M%S")          # cache-busting stamp, as in 2_build_chart.py
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={stamp}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{stamp}"', html)
    HTML_F.write_text(html)
    print(f"Last {WINDOW_DAYS} days: {old_window} events before, {len(fresh)} now. "
          f"Total {len(new['d']):,} events to {today()}.")
    for r in fresh[-5:]:
        print(f"  {r['time'][:16]}  M{float(r['mag']):.1f}  depth {r['depth']} km  {r['place']}")


if __name__ == "__main__":
    main()
