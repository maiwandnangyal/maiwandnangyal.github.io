"""Refresh attention/attention.json: how much the world looked at Afghanistan, from 2017 to the last
complete month.

Run by .github/workflows/update-attention.yml on the 3rd and 10th of each month; standard library only.
Same sources and method as 1_download_attention.py and 2_build_chart.py:
  - Wikimedia pageviews API: daily views of the English Wikipedia article 'Afghanistan', user traffic.
  - GDELT DOC 2.0 API (mode=timelinevol): daily share of monitored online news mentioning "Afghanistan".
  - Each series is divided by its own 2017-2020 daily average (1 = a normal month). Monthly values are
    the mean of the days available; 2021 is also kept day by day. The caption figures (peak month, the
    average since 2023, the number of days GDELT is missing) are computed from the data.
Safety: if either download fails, or the new data would end earlier or hold fewer months than the
published file, nothing is written and the run fails, so the live chart is never damaged.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "attention"
JSON_F, HTML_F = OUT / "attention.json", OUT / "attention.html"
UA = "Afghanistan-attention-research-script/1.0 (academic, non-commercial)"
TERM = "Afghanistan"
BASE = ("2017-01-01", "2020-12-31")      # GDELT starts in 2017, so both use 2017-2020
START, FOCUS = "2017-01-01", "2021"
EVENTS = [
    ("2021-04-14", "US announces full withdrawal"),
    ("2021-08-15", "Fall of Kabul"),
    ("2021-08-26", "Kabul airport bombing"),
    ("2021-08-30", "Last US troops leave"),
]


def last_complete_month_end(today=None):
    return (today or date.today()).replace(day=1) - timedelta(days=1)


def get_json(url, tries, waits):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tries - 1:
                raise
            wait = waits[min(i, len(waits) - 1)]
            print(f"   retrying in {wait}s after error: {e}")
            time.sleep(wait)


def wikipedia(end):
    """{'YYYY-MM-DD': views} for the article, from START to end."""
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
           f"{urllib.parse.quote(TERM, safe='')}/daily/{START.replace('-', '')}00/{end:%Y%m%d}00")
    items = get_json(url, 3, (5, 10))["items"]
    return {f"{i['timestamp'][:4]}-{i['timestamp'][4:6]}-{i['timestamp'][6:8]}": i["views"] for i in items}


def gdelt(end):
    """{'YYYY-MM-DD': % of monitored news} for the term, from START to end. GDELT omits some days."""
    q = urllib.parse.quote(f'"{TERM}"')
    url = (f"https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=timelinevol&format=json"
           f"&startdatetime={START.replace('-', '')}000000&enddatetime={end:%Y%m%d}000000")
    # GDELT throttles hard: back off for 30s, 60s, 120s, 240s before giving up
    tl = get_json(url, 5, (30, 60, 120, 240))["timeline"][0]["data"]
    return {f"{d['date'][:4]}-{d['date'][4:6]}-{d['date'][6:8]}": d["value"] for d in tl}


def mean(xs):
    return sum(xs) / len(xs)


def rnd(x, n):
    """Round as numpy does (2_build_chart.py rounds numpy numbers), so both give the same file."""
    return round(x * 10 ** n) / 10 ** n


def assemble(wiki, news):
    """Build the chart's data from two {day: value} series. Mirrors build() in 2_build_chart.py."""
    wiki = {d: v for d, v in wiki.items() if d >= START and v is not None}
    news = {d: v for d, v in news.items() if d >= START and v is not None}
    end = min(max(wiki), max(news))
    wiki = {d: v for d, v in sorted(wiki.items()) if d <= end}
    news = {d: v for d, v in sorted(news.items()) if d <= end}
    bw = mean([v for d, v in wiki.items() if BASE[0] <= d <= BASE[1]])
    bn = mean([v for d, v in news.items() if BASE[0] <= d <= BASE[1]])

    def row(d, w, n):
        return {"d": d, "wi": rnd(w / bw, 3), "ni": None if n is None else rnd(n / bn, 3),
                "wr": round(w), "nr": None if n is None else rnd(n, 3)}

    months = sorted({d[:7] for d in wiki})
    monthly = []
    for m in months:
        w = [v for d, v in wiki.items() if d[:7] == m]
        n = [v for d, v in news.items() if d[:7] == m]
        monthly.append(row(m + "-01", mean(w), mean(n) if n else None))
    daily = [row(d, v, news.get(d)) for d, v in wiki.items() if d[:4] == FOCUS]

    after_w = mean([v for d, v in wiki.items() if d >= "2023"]) / bw
    after_n = mean([v for d, v in news.items() if d >= "2023"]) / bn
    peak_m = max(monthly, key=lambda r: r["wi"])
    first, last = date.fromisoformat(min(news)), date.fromisoformat(end)
    missing = sum(1 for i in range((last - first).days + 1) if (first + timedelta(days=i)).isoformat() not in news)
    return {
        "term": TERM, "monthly": monthly, "daily": daily,
        "events": [{"d": d, "label": l} for d, l in EVENTS],
        "base": f"{BASE[0][:4]}-{BASE[1][:4]}",
        "baseRaw": {"wiki": round(bw), "news": rnd(bn, 3)},
        "summary": {"peakMonth": peak_m["d"], "peakWiki": peak_m["wi"], "peakNews": peak_m["ni"],
                    "afterWiki": rnd(after_w, 2), "afterNews": rnd(after_n, 2)},
        "source": (f"Sources: Wikimedia pageviews API (English Wikipedia article “{TERM}”, user traffic); "
                   f"GDELT DOC 2.0 API (share of monitored online news mentioning “{TERM}”). "
                   f"Each line is divided by its own {BASE[0][:4]}–{BASE[1][:4]} daily average. "
                   f"GDELT is missing {missing} days; monthly values average the days available."),
    }


def main():
    end = last_complete_month_end()
    print(f"Window: {START} to {end}")
    try:
        wiki = wikipedia(end)
        print(f" Wikipedia: {len(wiki)} days, to {max(wiki)}")
        news = gdelt(end)
        print(f" GDELT: {len(news)} days, to {max(news)}")
    except Exception as e:
        sys.exit(f"Download failed ({e}). Nothing written; the published chart is unchanged.")
    if len(wiki) < 3000 or len(news) < 3000:
        sys.exit(f"Too few days (Wikipedia {len(wiki)}, GDELT {len(news)}). Nothing written.")
    new = assemble(wiki, news)

    old = json.loads(JSON_F.read_text()) if JSON_F.exists() else None
    if old:
        o_last, n_last = old["monthly"][-1]["d"], new["monthly"][-1]["d"]
        if n_last < o_last or len(new["monthly"]) < len(old["monthly"]):
            sys.exit(f"New data end {n_last} with {len(new['monthly'])} months; the published file ends {o_last} "
                     f"with {len(old['monthly'])}. Nothing written.")
        if new == old:
            print("No change.")
            return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")              # cache-busting stamp, as in 2_build_chart.py
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    s = new["summary"]
    print(f"Written: {len(new['monthly'])} months to {new['monthly'][-1]['d'][:7]}; peak {s['peakMonth'][:7]} "
          f"x{s['peakWiki']}; since 2023 Wikipedia x{s['afterWiki']}, news x{s['afterNews']}")


if __name__ == "__main__":
    main()
