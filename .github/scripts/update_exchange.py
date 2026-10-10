"""Refresh exchange/exchange.json with the latest Da Afghanistan Bank and World Bank rates.

Run by .github/workflows/update-exchange.yml every day; standard library only.
Same method as 12_afn_exchange_rate.py and 13_exchange_chart.py:
  - World Bank WDI PA.NUS.FCRF, annual: AFN per USD, and AFN per GBP = AFN/USD divided by GBP/USD
  - DAB daily rates via api.frankfurter.dev from 2019, cleaned: values more than 50% away from
    the 15-day centred median are dropped (data-entry errors)
  - chart data: WDI annual, DAB monthly means, last 30 days of DAB daily
Safety: if a download fails, or the new data would end earlier or have fewer days than the
published file, nothing is written and the run fails, so the live chart is never damaged.
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
FF = "https://api.frankfurter.dev/v2/rates?from=2019-01-01&to={end}&base={base}&quotes=AFN&providers=DAB"
RECENT_DAYS = 30
SOURCE = ("Sources: World Bank WDI official exchange rate (PA.NUS.FCRF), annual averages, with sterling "
          "derived from the UK series; Da Afghanistan Bank daily rates from April 2019 via "
          "api.frankfurter.dev (data-entry errors removed). Higher values mean a weaker afghani. "
          "Updated automatically every day.")


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


def wdi(old):
    try:
        def one(iso):
            js = get(WDI.format(iso=iso))
            return {int(r["date"]): r["value"] for r in js[1] if r["value"] is not None}
        afn, gbp = one("AFG"), one("GBR")
        rows = [{"d": f"{y}-07-01", "USD": round(afn[y], 3),
                 "GBP": round(afn[y] / gbp[y], 3) if y in gbp else None} for y in sorted(afn)]
        print(f"World Bank: {len(rows)} years, to {rows[-1]['d'][:4]}")
        return rows
    except Exception as e:                      # annual data rarely changes: keep the published copy
        print(f"World Bank download failed ({e}); keeping the published annual series")
        return old["wdi"]


def dab(base):
    js = get(FF.format(end=date.today().isoformat(), base=base))
    if isinstance(js, dict) and "rates" in js:
        js = js["rates"]
    rows = {}
    if isinstance(js, dict):
        rows = {d: float(v["AFN"]) for d, v in js.items() if isinstance(v, dict) and "AFN" in v}
    elif isinstance(js, list):
        rows = {r["date"]: float(r["rate"]) for r in js
                if isinstance(r, dict) and r.get("quote") == "AFN" and r.get("base", base) == base}
    if not rows:
        sys.exit(f"No DAB rows for {base}. First 300 characters: {json.dumps(js)[:300]}")
    s = sorted(rows.items())
    keep = []
    for i, (d, v) in enumerate(s):              # pandas rolling(15, center=True, min_periods=5).median()
        win = [x for _, x in s[max(0, i - 7): i + 8]]
        med = statistics.median(win) if len(win) >= 5 else None
        if med is not None and abs(v / med - 1) > 0.5:
            print(f"  {base}: dropped {d}: {v:,.2f} (15-day median {med:,.2f})")
        else:
            keep.append((d, v))
    print(f"DAB AFN per {base}: {len(keep)} days, {keep[0][0]} to {keep[-1][0]}")
    return dict(keep)


def main():
    old = json.loads(JSON_F.read_text())
    usd, gbp = dab("USD"), dab("GBP")
    days = sorted(set(usd) | set(gbp))
    last = days[-1]

    # Guard: never publish less than is already live
    old_last = old["lastDate"]
    old_days = old.get("nDays")
    if last < old_last or (old_days and len(days) < old_days):
        sys.exit(f"New data ends {last} with {len(days)} days; published file ends {old_last}. Not writing.")

    month = defaultdict(lambda: {"USD": [], "GBP": []})
    for d in days:
        for cur, s in (("USD", usd), ("GBP", gbp)):
            if d in s:
                month[d[:7]][cur].append(s[d])
    monthly = [{"d": f"{m}-01", **{c: round(sum(v) / len(v), 3) if v else None for c, v in month[m].items()}}
               for m in sorted(month)]
    start = (date.fromisoformat(last) - timedelta(days=RECENT_DAYS - 1)).isoformat()
    recent = [{"d": d, "USD": round(usd[d], 3) if d in usd else None,
               "GBP": round(gbp[d], 3) if d in gbp else None} for d in days if d >= start]

    new = {"wdi": wdi(old), "dabMonthly": monthly, "recent": recent,
           "lastDate": last, "nDays": len(days), "source": SOURCE}
    if {k: v for k, v in new.items() if k != "source"} == {k: v for k, v in old.items() if k != "source"}:
        print("No new data since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")            # cache-busting stamp, as in 13_exchange_chart.py
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    for cur, s in (("USD", usd), ("GBP", gbp)):
        d = max(s)
        print(f"Latest: {s[d]:.2f} AFN per {cur} on {d}")


if __name__ == "__main__":
    main()
