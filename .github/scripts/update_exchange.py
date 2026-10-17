"""Refresh exchange/exchange.json: the afghani and the Pakistani rupee against the US dollar and
pound sterling, and the afghani against the rupee.

Run by .github/workflows/update-exchange.yml every day; standard library only. 2_build_chart.py
also uses assemble() from this file, so the website data are built the same way locally and online.
Same method as 1_download_exchange_rates.py:
  - World Bank WDI PA.NUS.FCRF, annual, local currency per USD for Afghanistan, Pakistan and the
    UK. Per GBP = per USD / (GBP per USD); AFN per PKR = AFN per USD / PKR per USD, same year.
  - Daily central bank rates via api.frankfurter.dev: Da Afghanistan Bank (AFN per USD, GBP and
    PKR, from April 2019) and State Bank of Pakistan (PKR per USD and GBP, from July 2013; the
    State Bank publishes its daily rates once a month). Cleaned: values more than 50% away from
    the 15-day centred median are dropped as data-entry errors.
  - Chart data for each pair: World Bank annual, bank monthly means, last 30 days of bank daily.
    The afghani against the rupee is stored per 100 rupees; the page also shows its inverse.
Safety: if a download fails, or any pair would end earlier or have fewer days than the published
file, nothing is written and the run fails, so the live chart is never damaged.
"""
import json
import re
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "exchange"
JSON_F, HTML_F = OUT / "exchange.json", OUT / "exchange.html"
UA = {"User-Agent": "afn-exchange-rate-research/1.0 (academic)", "Accept": "application/json"}
WDI = ("https://api.worldbank.org/v2/country/{iso}/indicator/PA.NUS.FCRF"
       "?format=json&per_page=100&date=2000:2035")
FF = "https://api.frankfurter.dev/v2/rates?from={start}&to={end}&base={base}&quotes={quote}&providers={prov}"
RECENT_DAYS = 30
# pair: (currency, against, Frankfurter provider, bank name, first day)
PAIRS = {
    "AFN_USD": ("AFN", "USD", "DAB", "Da Afghanistan Bank", "2019-01-01"),
    "AFN_GBP": ("AFN", "GBP", "DAB", "Da Afghanistan Bank", "2019-01-01"),
    "AFN_PKR": ("AFN", "PKR", "DAB", "Da Afghanistan Bank", "2019-01-01"),
    "PKR_USD": ("PKR", "USD", "SBP", "State Bank of Pakistan", "2013-01-01"),
    "PKR_GBP": ("PKR", "GBP", "SBP", "State Bank of Pakistan", "2013-01-01"),
}
SCALE = {"AFN_PKR": 100}                   # afghani per 100 rupees, so the numbers are readable
SOURCE = ("Sources: World Bank WDI official exchange rate (PA.NUS.FCRF), annual averages, with sterling "
          "and the afghani-rupee rate derived from the UK and Pakistan series; Da Afghanistan Bank daily "
          "rates from April 2019 and State Bank of Pakistan daily rates from July 2013 (published once a "
          "month), via api.frankfurter.dev, with data-entry errors removed. Higher values mean a weaker "
          "afghani or rupee. Updated automatically every day.")


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry in {30 * (i + 1)}s after: {e}")
            time.sleep(30 * (i + 1))


def wdi_annual():
    """{pair: {year: rate}} from the World Bank, per 1 unit (no scaling)."""
    def one(iso):
        js = get(WDI.format(iso=iso))
        return {int(r["date"]): float(r["value"]) for r in js[1] if r["value"] is not None}
    afn, pkr, gbr = one("AFG"), one("PAK"), one("GBR")
    out = {"AFN_USD": afn, "PKR_USD": pkr,
           "AFN_GBP": {y: v / gbr[y] for y, v in afn.items() if y in gbr},
           "PKR_GBP": {y: v / gbr[y] for y, v in pkr.items() if y in gbr},
           "AFN_PKR": {y: v / pkr[y] for y, v in afn.items() if y in pkr}}
    print("World Bank: " + ", ".join(f"{k} {min(v)} to {max(v)}" for k, v in out.items()))
    return out


def clean(rows, label):
    """Drop values more than 50% away from the 15-day centred median (data-entry errors)."""
    s = sorted(rows.items())
    keep = {}
    for i, (d, v) in enumerate(s):              # pandas rolling(15, center=True, min_periods=5).median()
        win = [x for _, x in s[max(0, i - 7): i + 8]]
        med = statistics.median(win) if len(win) >= 5 else None
        if med is not None and abs(v / med - 1) > 0.5:
            print(f"  {label}: dropped {d}: {v:,.4f} (15-day median {med:,.4f})")
        else:
            keep[d] = v
    return keep


def bank(pair):
    """{date: rate} for one pair from the central bank, cleaned, per 1 unit."""
    cur, against, prov, name, start = PAIRS[pair]
    js = get(FF.format(start=start, end=date.today().isoformat(), base=against, quote=cur, prov=prov))
    if isinstance(js, dict) and "rates" in js:
        js = js["rates"]
    rows = {}
    if isinstance(js, dict):
        rows = {d: float(v[cur]) for d, v in js.items() if isinstance(v, dict) and cur in v}
    elif isinstance(js, list):
        rows = {r["date"]: float(r["rate"]) for r in js
                if isinstance(r, dict) and r.get("quote") == cur and r.get("base", against) == against}
    if not rows:
        sys.exit(f"No {name} rows for {cur} per {against}. First 300 characters: {json.dumps(js)[:300]}")
    rows = clean(rows, pair)
    print(f"{name} {cur} per {against}: {len(rows)} days, {min(rows)} to {max(rows)}")
    return rows


def assemble(wdi, daily):
    """The website data: for each pair, World Bank annual, bank monthly means and the last 30 days."""
    pairs = {}
    for key, (cur, against, prov, name, start) in PAIRS.items():
        k = SCALE.get(key, 1)
        dly = daily[key]
        days = sorted(dly)
        month = defaultdict(list)
        for d in days:
            month[d[:7]].append(dly[d])
        first = (date.fromisoformat(days[-1]) - timedelta(days=RECENT_DAYS - 1)).isoformat()
        pairs[key] = {
            "wdi": [[f"{y}-07-01", round(v * k, 3)] for y, v in sorted(wdi[key].items())],
            "monthly": [[f"{m}-01", round(sum(v) / len(v) * k, 3)] for m, v in sorted(month.items())],
            "recent": [[d, round(dly[d] * k, 3)] for d in days if d >= first],
            "last": days[-1], "nDays": len(days), "bank": name,
        }
    return {"pairs": pairs, "source": SOURCE}


def main():
    old = json.loads(JSON_F.read_text())
    old_pairs = old.get("pairs", {})               # an older file (afghani only) has none
    daily = {key: bank(key) for key in PAIRS}
    try:
        wdi = wdi_annual()
    except Exception as e:                         # annual data rarely change: keep the published copy
        if not all(k in old_pairs for k in PAIRS):
            sys.exit(f"World Bank download failed ({e}) and there is no published copy to keep. Not writing.")
        print(f"World Bank download failed ({e}); keeping the published annual series")
        wdi = None
    new = assemble(wdi or {k: {} for k in PAIRS}, daily)
    if wdi is None:
        for k in PAIRS:
            new["pairs"][k]["wdi"] = old_pairs[k]["wdi"]

    for k, p in old_pairs.items():                 # guard: never publish less than is already live
        n = new["pairs"].get(k)
        if n is None or n["last"] < p["last"] or n["nDays"] < p["nDays"]:
            sys.exit(f"{k}: new data end {n and n['last']} with {n and n['nDays']} days; published file ends "
                     f"{p['last']} with {p['nDays']}. Not writing.")
    if new == old:
        print("No new data since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")              # cache-busting stamp, as in 2_build_chart.py
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    for k, p in new["pairs"].items():
        print(f"Latest {k}: {p['recent'][-1][1]} on {p['last']}" + (" (per 100)" if k in SCALE else ""))


if __name__ == "__main__":
    main()
