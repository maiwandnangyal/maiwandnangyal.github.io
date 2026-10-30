"""Refresh funds/funds.json: daily prices of a short list of London-listed ETFs, in pounds.

Run by .github/workflows/update-funds.yml every weekday; standard library only.
  - Prices: Yahoo Finance chart API (adjusted close, so dividends are included), with Stooq
    daily closes as a fallback when Yahoo does not answer.
  - Funds quoted in pence are divided by 100; funds quoted in US dollars are converted to
    pounds with the daily European Central Bank rate via api.frankfurter.dev.
  - Keeps about 400 days, enough for the one-year view.
Safety: a fund whose download fails, or whose new series would end earlier or be shorter than
the published one, keeps its published series. If no fund at all can be updated and there is no
published file, nothing is written and the run fails.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "funds"
JSON_F, HTML_F = OUT / "funds.json", OUT / "funds.html"
UA = {"User-Agent": "Mozilla/5.0 (fund-chart; academic website)", "Accept": "application/json,text/csv,*/*"}
KEEP_DAYS = 400

# Ticker on the London Stock Exchange -> currency to assume if the price source does not say.
# To add or remove a fund, edit this list; the page picks up whatever is in funds.json.
FUNDS = {
    "ISWD": "GBp",
    "ISDE": "USD",
    "HIWS": "GBP",
    "IGDA": "USD",
    "MWIX": "GBp",
    "ISUS": "GBp",
    "HIES": "GBP",
    "HBKS": "GBP",
}
HELD = ["ISWD", "ISDE"]
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}.L?range=2y&interval=1d&includeAdjustedClose=true"
STOOQ = "https://stooq.com/q/d/l/?s={sym}.uk&i=d"
FX = "https://api.frankfurter.dev/v2/rates?from={start}&to={end}&base=USD&quotes=GBP"
SOURCE = ("Sources: Yahoo Finance daily prices (adjusted for dividends), with Stooq as a fallback; dollar-priced "
          "funds converted to pounds at the European Central Bank daily rate via api.frankfurter.dev. "
          "Returns are in pounds and include fund fees but not trading costs. Updated automatically every weekday.")


def fetch(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry in {20 * (i + 1)}s after: {e}")
            time.sleep(20 * (i + 1))


def from_yahoo(sym):
    """({date: price}, currency) from Yahoo, using the adjusted close where available."""
    js = json.loads(fetch(YAHOO.format(sym=sym)))
    res = (js.get("chart") or {}).get("result") or []
    if not res:
        raise ValueError(f"no result: {json.dumps(js)[:200]}")
    r = res[0]
    ts = r.get("timestamp") or []
    ind = r.get("indicators") or {}
    adj = ((ind.get("adjclose") or [{}])[0] or {}).get("adjclose")
    close = ((ind.get("quote") or [{}])[0] or {}).get("close")
    vals = adj if adj and any(v is not None for v in adj) else close
    if not ts or not vals:
        raise ValueError("no prices")
    rows = {}
    for t, v in zip(ts, vals):
        if v is not None and v > 0:
            rows[datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat()] = float(v)
    return rows, (r.get("meta") or {}).get("currency")


def from_stooq(sym):
    """({date: close}, None) from Stooq's daily CSV (closes, not adjusted for dividends)."""
    text = fetch(STOOQ.format(sym=sym.lower()))
    rows = {}
    for rec in csv.DictReader(io.StringIO(text)):
        try:
            v = float(rec["Close"])
            if v > 0:
                rows[rec["Date"]] = v
        except (KeyError, ValueError, TypeError):
            continue
    if not rows:
        raise ValueError(f"no rows: {text[:120]!r}")
    return rows, None


def usd_to_gbp(start, end):
    """{date: pounds per dollar} from the ECB via Frankfurter."""
    js = json.loads(fetch(FX.format(start=start, end=end)))
    if isinstance(js, dict) and "rates" in js:
        js = js["rates"]
    rows = {}
    if isinstance(js, dict):
        rows = {d: float(v["GBP"]) for d, v in js.items() if isinstance(v, dict) and "GBP" in v}
    elif isinstance(js, list):
        rows = {r["date"]: float(r["rate"]) for r in js if isinstance(r, dict) and r.get("quote") == "GBP"}
    if not rows:
        raise ValueError(f"no FX rows: {json.dumps(js)[:200]}")
    return rows


def to_pounds(rows, cur, fx):
    """Convert a price series to pounds. fx is {date: GBP per USD}; earlier rates carry forward."""
    if cur in ("GBp", "GBX"):
        return {d: v / 100 for d, v in rows.items()}
    if cur == "GBP":
        return dict(rows)
    if cur == "USD":
        if not fx:
            raise ValueError("needs the dollar rate, which is unavailable")
        fdays = sorted(fx)
        out, j, last = {}, 0, None
        for d in sorted(rows):
            while j < len(fdays) and fdays[j] <= d:
                last = fx[fdays[j]]
                j += 1
            if last is not None:
                out[d] = rows[d] * last
        return out
    raise ValueError(f"unknown currency {cur}")


def build(old_funds, today=None):
    today = today or date.today()
    start = (today - timedelta(days=KEEP_DAYS + 10)).isoformat()
    fx = None
    try:
        fx = usd_to_gbp(start, today.isoformat())
        print(f"Dollar rate: {len(fx)} days, {min(fx)} to {max(fx)}")
    except Exception as e:
        print(f"Dollar rate download failed: {e}")
    cut = (today - timedelta(days=KEEP_DAYS)).isoformat()
    funds, updated = {}, []
    for sym, default_cur in FUNDS.items():
        new = None
        for name, fn in (("Yahoo", from_yahoo), ("Stooq", from_stooq)):
            try:
                rows, cur = fn(sym)
                cur = cur or default_cur
                gbp = {d: round(v, 6) for d, v in to_pounds(rows, cur, fx).items() if d >= cut}
                if len(gbp) < 5:
                    raise ValueError(f"only {len(gbp)} days")
                new = {"src": name, "cur": cur, "rows": [[d, gbp[d]] for d in sorted(gbp)]}
                print(f"{sym}: {name}, {len(gbp)} days to {max(gbp)} ({cur})")
                break
            except Exception as e:
                print(f"{sym}: {name} failed: {e}")
        old = old_funds.get(sym)
        if new and old and (new["rows"][-1][0] < old["rows"][-1][0]):
            print(f"{sym}: new data end before the published data; keeping the published series")
            new = None
        if new:
            new["held"] = sym in HELD
            funds[sym] = new
            updated.append(sym)
        elif old:
            funds[sym] = old
    return funds, updated


def main():
    old = json.loads(JSON_F.read_text()) if JSON_F.exists() else {}
    old_funds = old.get("funds", {})
    funds, updated = build(old_funds)
    if not updated:
        sys.exit("No fund could be downloaded in this run. The published file is unchanged; check the log above.")
    last = max(f["rows"][-1][0] for f in funds.values())
    new = {"funds": funds, "order": [s for s in FUNDS if s in funds], "last": last, "source": SOURCE}
    if new == old:
        print("No new data since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    print(f"Updated {len(updated)} of {len(FUNDS)} funds; latest prices {last}.")


if __name__ == "__main__":
    main()
