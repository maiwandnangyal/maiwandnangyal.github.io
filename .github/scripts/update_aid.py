"""Refresh aid/aid.json: humanitarian appeals for Afghanistan and the funding reported against them.

Run by .github/workflows/update-aid.yml every week; standard library only. Also used by
1_download_aid.py and 2_build_chart.py, so the local copy and the live site use the same method.
  - UN appeals and the funding reported against them, overall and by sector, from OCHA's Financial
    Tracking Service (FTS) as published on the Humanitarian Data Exchange (HDX), updated daily there.
  - Every reported contribution to Afghanistan since 2000, from the FTS API (api.hpc.tools), giving the
    donor and the sector of each one. As in FTS's own totals, only money paid or committed counts
    (pledges do not), and contributions shared with other countries or years are left out.
Safety: if a download fails, or a year at least two years back suddenly shows a quarter less funding than
the published file, nothing is written and the run fails, so the live chart is never damaged.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "aid"
JSON_F, HTML_F = OUT / "aid.json", OUT / "aid.html"
UA = {"User-Agent": "afghanistan-aid-chart/1.0 (academic website)", "Accept": "application/json,text/csv,*/*"}
HDX = "https://data.humdata.org/api/3/action/package_show?id=6a60da4e-253f-474f-8683-7c9ed9a20bf9"
REQ_CSV, SECTOR_CSV = "fts_requirements_funding_afg.csv", "fts_requirements_funding_globalcluster_afg.csv"
FTS = "https://api.hpc.tools/v1/public/fts/flow?countryISO3=AFG&year={y}"
FIRST_YEAR = 2000
TOP_DONORS = 12          # donors named in each year's flows; the rest are "Other donors"
FLOW_COLS = ["year", "flow_id", "status", "flow_type", "amount_usd", "donor_reported", "donor", "sector"]

# sectors: FTS global clusters, grouped
SECTORS = ["Food and agriculture", "Health", "Nutrition", "Water and sanitation", "Shelter", "Protection", "Education",
           "Multi-sector", "Cash", "Early recovery", "Coordination", "Logistics", "Other", "Several sectors", "Not specified"]
CLUSTER = {"Food Security": "Food and agriculture", "Agriculture": "Food and agriculture", "Health": "Health",
           "COVID-19": "Health", "Nutrition": "Nutrition", "Water Sanitation Hygiene": "Water and sanitation",
           "Emergency Shelter and NFI": "Shelter", "Camp Coordination / Management": "Shelter", "Education": "Education",
           "Multi-sector": "Multi-sector", "Multipurpose Cash": "Cash", "Early Recovery": "Early recovery",
           "Coordination and support services": "Coordination", "Logistics": "Logistics",
           "Emergency Telecommunications": "Logistics", "Other": "Other",
           "Multiple clusters/sectors (shared)": "Several sectors", "Not specified": "Not specified"}
# donors: shorter names, and agencies of the same government or union counted together
DONOR = {"United States of America": "United States", "United States Department of State": "United States",
         "United States Agency for International Development": "United States",
         "European Commission's Humanitarian Aid and Civil Protection Department": "European Union",
         "European Commission": "European Union", "Swedish International Development Cooperation Agency (SIDA)": "Sweden",
         "Central Emergency Response Fund": "UN emergency fund (CERF)", "Private (individuals & organizations)": "Private donors",
         "Korea, Republic of": "South Korea", "Saudi Arabia (Kingdom of)": "Saudi Arabia",
         "United Kingdom of Great Britain and Northern Ireland": "United Kingdom"}
SOURCE = ("Source: UN OCHA Financial Tracking Service (FTS), via the Humanitarian Data Exchange and the FTS API. Appeals are "
          "the UN's humanitarian response plans and flash appeals for Afghanistan; funding is money paid or committed in US "
          "dollars of the day, as reported by donors and agencies, so recent years may still rise. Sectors are FTS's global "
          "clusters, grouped. Updated automatically every week.")


def sector(name):
    return "Protection" if name.startswith("Protection") else CLUSTER.get(name, "Other")


def donor(name):
    name = DONOR.get(name, name)
    name = re.sub(r", Government of$", "", name)
    return DONOR.get(name, name) or "Not reported"


def fetch(url, tries=4, timeout=120):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode("utf-8-sig")
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry in {20 * (i + 1)}s after: {e}")
            time.sleep(20 * (i + 1))


def hdx_files():
    """{file name: CSV text} for the two HDX files, found by name so changed links do not matter."""
    pkg = json.loads(fetch(HDX))["result"]
    urls = {r["name"]: r["url"] for r in pkg["resources"]}
    missing = [n for n in (REQ_CSV, SECTOR_CSV) if n not in urls]
    if missing:
        raise ValueError(f"HDX no longer has {missing}")
    return {n: fetch(urls[n]) for n in (REQ_CSV, SECTOR_CSV)}


def fts_year(year):
    """(rows, FTS's own funding total) for one year: one row per contribution that counts."""
    url, flows, total = FTS.format(y=year), [], None
    while url:
        js = json.loads(fetch(url))
        if total is None:
            total = float(((js.get("data") or {}).get("incoming") or {}).get("fundingTotal") or 0)
        flows += js["data"]["flows"]
        url = (js.get("meta") or {}).get("nextLink")
    rows = []
    for f in flows:
        if f.get("boundary") != "incoming" or f.get("status") == "pledge" or f.get("onBoundary") != "single":
            continue
        src = [o for o in f.get("sourceObjects") or [] if o.get("type") == "Organization"]
        cl = [o["name"] for o in f.get("destinationObjects") or [] if o.get("type") == "GlobalCluster"]
        reported = " | ".join(o["name"] for o in src)
        rows.append({"year": year, "flow_id": f.get("id"), "status": f.get("status"), "flow_type": f.get("flowType"),
                     "amount_usd": float(f.get("amountUSD") or 0), "donor_reported": reported,
                     "donor": donor(src[0]["name"]) if src else "Not reported",
                     "sector": "Not specified" if not cl else "Several sectors" if len(cl) > 1 else sector(cl[0])})
    return rows, total


def download(last_year, log=print):
    """Everything from the internet: the two HDX tables (text) and the contributions of every year."""
    files = hdx_files()
    log(f"HDX: {REQ_CSV} and {SECTOR_CSV} downloaded")
    flows, totals = [], {}
    for y in range(FIRST_YEAR, last_year + 1):
        rows, totals[y] = fts_year(y)
        flows += rows
        s = sum(r["amount_usd"] for r in rows)
        gap = "" if not totals[y] or abs(s / totals[y] - 1) < 0.01 else f"  (FTS total ${totals[y] / 1e6:,.0f}m)"
        log(f"FTS {y}: {len(rows):4d} contributions, ${s / 1e6:,.0f}m{gap}")
    return files, flows, totals


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def aggregate(req_text, sector_text, flows, last_year, updated):
    """The data for the page, from the two HDX tables and the contributions."""
    years = list(range(FIRST_YEAR, last_year + 1))
    appeal = {y: {"req": 0.0, "plan": 0.0, "out": 0.0, "plans": []} for y in years}
    for r in csv.DictReader(io.StringIO(req_text)):
        y = int(num(r.get("year")))
        if y not in appeal:
            continue
        if (r.get("id") or "").strip():
            appeal[y]["req"] += num(r.get("requirements"))
            appeal[y]["plan"] += num(r.get("funding"))
            appeal[y]["plans"].append([r.get("name", ""), r.get("typeName", ""), round(num(r.get("requirements"))),
                                       round(num(r.get("funding")))])
        else:
            appeal[y]["out"] += num(r.get("funding"))
    sectors = {}
    for r in csv.DictReader(io.StringIO(sector_text)):
        y = int(num(r.get("year")))
        if y not in appeal:
            continue
        s = sectors.setdefault(y, {}).setdefault(sector(r.get("cluster") or ""), [0.0, 0.0])
        s[0] += num(r.get("requirements"))
        s[1] += num(r.get("funding"))
    flow = {}
    for r in flows:
        y = int(r["year"])
        if y in appeal and float(r["amount_usd"]) > 0:
            d = flow.setdefault(y, {}).setdefault(r["donor"], {})
            d[r["sector"]] = d.get(r["sector"], 0.0) + float(r["amount_usd"])
    out_flows = {}
    for y, ds in flow.items():
        ranked = sorted(ds, key=lambda k: -sum(ds[k].values()))
        named = [k for k in ranked if k not in ("Not reported",)][:TOP_DONORS]
        names = named + ["Other donors"]
        m = {}
        for k, secs in ds.items():
            i = names.index(k) if k in named else len(named)
            for s, v in secs.items():
                key = (i, SECTORS.index(s))
                m[key] = m.get(key, 0.0) + v
        out_flows[str(y)] = {"d": names, "m": [[i, j, round(v)] for (i, j), v in sorted(m.items()) if round(v) > 0]}
    return {
        "years": years, "sectors": SECTORS, "updated": updated, "source": SOURCE,
        "appeal": {str(y): {"req": round(a["req"]), "plan": round(a["plan"]), "out": round(a["out"]), "plans": a["plans"]}
                   for y, a in appeal.items()},
        "bySector": {str(y): [[s, round(v[0]), round(v[1])] for s, v in sorted(ss.items(), key=lambda kv: SECTORS.index(kv[0]))]
                     for y, ss in sectors.items()},
        "flows": out_flows}


def check(new, old):
    """Problems that should stop the update: a year two or more years back losing a quarter of its funding."""
    problems = []
    last = new["years"][-1]
    for y, a in (old.get("appeal") or {}).items():
        b = new["appeal"].get(y)
        if int(y) <= last - 2 and b is not None:
            was, now = a["plan"] + a["out"], b["plan"] + b["out"]
            if was > 0 and now < 0.75 * was:
                problems.append(f"{y}: funding ${was / 1e6:,.0f}m before, ${now / 1e6:,.0f}m now")
    if len([y for y, a in new["appeal"].items() if a["req"] > 0]) < 15:
        problems.append("fewer than 15 years with a UN appeal")
    return problems


def main():
    today = datetime.now(timezone.utc).date()
    files, flows, _ = download(today.year)
    new = aggregate(files[REQ_CSV], files[SECTOR_CSV], flows, today.year, today.isoformat())
    old = json.loads(JSON_F.read_text()) if JSON_F.exists() else {}
    problems = check(new, old)
    if problems:
        sys.exit("Not updating, the new data look wrong: " + "; ".join(problems))
    if {k: v for k, v in new.items() if k != "updated"} == {k: v for k, v in old.items() if k != "updated"}:
        print("No new data since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":"), ensure_ascii=False))
    v = time.strftime("%Y%m%d%H%M%S")
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    a = new["appeal"][str(today.year)]
    print(f"Updated: {today.year} appeal ${a['req'] / 1e6:,.0f}m, funded ${a['plan'] / 1e6:,.0f}m so far.")


if __name__ == "__main__":
    main()
