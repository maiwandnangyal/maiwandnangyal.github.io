"""Refresh funds/funds.json: prices of a short list of London-listed ETFs, in pounds, with dividends.

Version 3 (30 October 2026): updated every hour while the London market is open, with the exact time of
each fund's latest trade and a series of today's prices; returns include dividends, worked out here
from each fund's dividend list and checked (Yahoo's own adjusted prices leave most of them out for funds
quoted in pence); dollar prices are converted at the exchange rate at the time of each price.
Version 2 is in _TO_BE_DELETED/16_fund_tracker_v2.
Version 4 (30 October 2026): a missing dollar rate no longer stops a fund. Yahoo's hourly GBP/USD rate has
gaps (none at all from Friday 30 January to Monday 2 February 2026), which made ISDE and IGDA fail in
version 3's first run; such times now use the ECB's daily rate, and a day with no rate at all is left
out rather than the whole fund. Version 3 is in _TO_BE_DELETED/16_fund_tracker_v3.

Run by .github/workflows/update-funds.yml every hour on weekdays; standard library only.
  - Prices: Yahoo Finance chart API (ticker.L): daily closes for about 400 days, today's prices every
    5 minutes, and the latest trade with its exact time. Yahoo delays London prices by 20 minutes.
  - Glitches in prices are corrected as in version 2: days quoted 100 times too small or large (pounds
    for pence, or the other way round) are rescaled, and single days far off both neighbours are dropped.
  - Dividends: Yahoo's list of each fund's dividends. An amount under 0.05% or over 5% of the previous
    close is rescaled if it is 100 times off (as Yahoo's May 2025 amounts for ISDE and ISUS are), and
    left out otherwise; every dividend used is printed. Returns treat each dividend as reinvested on the
    day the fund goes ex-dividend: earlier prices are multiplied by (1 - dividend / previous close), the
    standard way of adjusting prices for dividends.
  - Pounds: prices in pence are divided by 100; prices in US dollars are converted at Yahoo's GBP/USD
    rate at the time of the price (5-minute rates for the last five days, hourly before that; 16:30
    London time for daily closes). Where Yahoo has no rate within an hour (5-minute rates) or six hours
    (hourly rates) of the time, the European Central Bank's daily rate via api.frankfurter.dev is used;
    a past day with no rate at all is left out, and listed in the log.
  - Stooq's daily closes are used only for a fund that Yahoo does not answer for and that has no
    published series yet; they have no dividends and no prices during the day. (On 30 October 2026
    Stooq answered scripts with a bot check, so at present this fallback does not work.)
Safety: a fund whose download fails, or whose new series would end earlier than the published one,
keeps its published series. If no fund can be updated, nothing is written and the run fails. If no
price has changed since the last run, nothing is written, so the site is rebuilt only when prices move.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from bisect import bisect_left, bisect_right
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
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={step}"
STOOQ = "https://stooq.com/q/d/l/?s={sym}.uk&i=d"
FX = "https://api.frankfurter.dev/v2/rates?from={start}&to={end}&base=USD&quotes=GBP"
DIV_MIN, DIV_MAX = 0.0005, 0.05      # plausible dividend, as a share of the previous close
SOURCE = ("Prices from Yahoo Finance, which delays London prices by 20 minutes; funds priced in dollars are converted "
          "to pounds at the GBP/USD rate at the time of each price. Returns include dividends, as if each was reinvested "
          "on the day the fund went ex-dividend (a broker account shows them as cash instead), and the funds' own fees, "
          "but not trading costs. Updated every hour while the London market is open.")


# ---------- London time (British Summer Time: last Sunday of March to last Sunday of October, from 01:00 UTC)

def last_sunday(year, month):
    d = date(year, month + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - 6) % 7)


def london_offset(ts):
    """Seconds London is ahead of UTC at time ts (seconds since 1970)."""
    dt = datetime.fromtimestamp(ts, timezone.utc)
    start = datetime.combine(last_sunday(dt.year, 3), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    end = datetime.combine(last_sunday(dt.year, 10), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    return 3600 if start <= dt < end else 0


def london(ts):
    """London wall-clock time of ts, as a datetime labelled UTC."""
    return datetime.fromtimestamp(ts + london_offset(ts), timezone.utc)


def lon_date(ts):
    return london(ts).date().isoformat()


def lon_time(ts):
    return london(ts).strftime("%H:%M:%S")


def close_time(day):
    """16:30 London time on a date (YYYY-MM-DD), the London close, as seconds since 1970."""
    d = date.fromisoformat(day)
    t = datetime(d.year, d.month, d.day, 16, 30, tzinfo=timezone.utc).timestamp()
    return int(t - london_offset(t))


# ---------- downloads

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


def yahoo(sym, rng, step, divs=False):
    """One Yahoo chart result."""
    js = json.loads(fetch(YAHOO.format(sym=sym, rng=rng, step=step) + ("&events=div" if divs else "")))
    res = (js.get("chart") or {}).get("result") or []
    if not res:
        raise ValueError(f"no result: {json.dumps(js)[:200]}")
    return res[0]


def bars(r):
    """[(time, open, close)] of a Yahoo chart result, for bars that have a price."""
    ts = r.get("timestamp") or []
    q = (((r.get("indicators") or {}).get("quote") or [{}])[0]) or {}
    op = q.get("open") or [None] * len(ts)
    cl = q.get("close") or [None] * len(ts)
    return [(int(t), o, float(c)) for t, o, c in zip(ts, op, cl) if c is not None and c > 0]


def from_yahoo(sym):
    """Daily closes, dividends, today's 5-minute prices and the latest trade, in the quoted currency."""
    d = yahoo(f"{sym}.L", "2y", "1d", divs=True)
    meta = d.get("meta") or {}
    closes = {datetime.fromtimestamp(t, timezone.utc).date().isoformat(): c for t, o, c in bars(d)}
    if not closes:
        raise ValueError("no prices")
    divs = {}
    for ev in ((d.get("events") or {}).get("dividends") or {}).values():
        if ev.get("amount") and ev.get("date"):
            divs[datetime.fromtimestamp(ev["date"], timezone.utc).date().isoformat()] = float(ev["amount"])
    today = []
    try:
        i = yahoo(f"{sym}.L", "1d", "5m")
        meta = i.get("meta") or meta
        today = [(t, c) for t, o, c in bars(i)]
    except Exception as e:
        print(f"  {sym}: today's prices failed ({e}); using the daily data only")
    t, p = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
    return {"closes": closes, "divs": divs, "today": today, "cur": meta.get("currency"),
            "last": (int(t), float(p)) if t and p else None}


def from_stooq(sym):
    """Daily closes from Stooq's CSV (not adjusted for dividends)."""
    text = fetch(STOOQ.format(sym=sym.lower()))
    closes = {}
    for rec in csv.DictReader(io.StringIO(text)):
        try:
            v = float(rec["Close"])
            if v > 0:
                closes[rec["Date"]] = v
        except (KeyError, ValueError, TypeError):
            continue
    if not closes:
        raise ValueError(f"no rows: {text[:120]!r}")
    return {"closes": closes, "divs": {}, "today": [], "cur": None, "last": None}


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


class Rate:
    """Pounds per US dollar at a given time: Yahoo's GBP/USD rate (5-minute for the last five days,
    hourly before that), or the ECB's daily rate where Yahoo has none near that time."""

    def __init__(self, start, end):
        self.m5, self.h1, self.ecb, self.start, self.end, self.tried = [], [], {}, start, end, False
        try:
            self.h1 = [(t, 2 / ((o or c) + c)) for t, o, c in bars(yahoo("GBPUSD=X", "2y", "60m"))]
            print(f"Dollar rate: Yahoo GBP/USD every hour, {lon_date(self.h1[0][0])} to {lon_date(self.h1[-1][0])}")
        except Exception as e:
            print(f"Hourly dollar rate from Yahoo failed: {e}")
        try:
            self.m5 = [(t, 1 / c) for t, o, c in bars(yahoo("GBPUSD=X", "5d", "5m"))]
            print(f"Dollar rate: Yahoo GBP/USD every 5 minutes from {lon_date(self.m5[0][0])}, "
                  f"latest {1 / self.m5[-1][1]:.4f} at {lon_time(self.m5[-1][0])} London time")
        except Exception as e:
            print(f"5-minute dollar rate from Yahoo failed: {e}")
        self.m5t, self.h1t, self.days = [t for t, _ in self.m5], [t for t, _ in self.h1], []
        if not self.h1:
            self.load_ecb()

    def load_ecb(self):
        """The ECB's daily rates, downloaded the first time they are needed."""
        if self.tried:
            return
        self.tried = True
        try:
            self.ecb = usd_to_gbp(self.start, self.end)
            self.days = sorted(self.ecb)
            print(f"Dollar rate: ECB daily via Frankfurter, {len(self.ecb)} days to {self.days[-1]}, "
                  f"for times when Yahoo has none")
        except Exception as e:
            print(f"ECB dollar rate download failed: {e}")

    def at(self, ts):
        """Pounds per dollar at time ts: the Yahoo rate for the 5-minute or hourly bar that ts falls in, or
        the nearest one within an hour (5-minute) or six hours (hourly); otherwise the ECB rate for that day
        or the day before; None if there is none."""
        for times, vals, width, gap in ((self.m5t, self.m5, 300, 3600), (self.h1t, self.h1, 3600, 6 * 3600)):
            i = bisect_right(times, ts) - 1
            if i >= 0 and ts - times[i] < width:
                return vals[i][1]
            near = [k for k in (i, i + 1) if 0 <= k < len(times) and abs(ts - times[k]) <= gap]
            if near:
                return vals[min(near, key=lambda k: abs(ts - times[k]))][1]
        self.load_ecb()
        i = bisect_right(self.days, datetime.fromtimestamp(ts, timezone.utc).date().isoformat()) - 1
        return self.ecb[self.days[i]] if i >= 0 else None


# ---------- corrections and dividends

def clean(sym, rows):
    """{date: price} with feed glitches corrected: prices 100 times too small or large (pounds given for
    pence, or the other way round) are rescaled, and a single day that is more than 15% above or below
    both neighbours, which agree with each other within 5%, is dropped. Prints what it changed."""
    if len(rows) < 5:
        return dict(rows)
    days = sorted(rows)
    vals = sorted(rows.values())
    med = vals[len(vals) // 2]
    out = {d: rescale(rows[d], med) for d in days}
    rescaled = [d for d in days if out[d] != rows[d]]
    dropped = []
    for i in range(1, len(days) - 1):
        a, b, c = out[days[i - 1]], out[days[i]], out[days[i + 1]]
        if abs(b / a - 1) > 0.15 and abs(b / c - 1) > 0.15 and abs(c / a - 1) < 0.05 and (b - a) * (b - c) > 0:
            dropped.append(days[i])
    for d in dropped:
        del out[d]
    if rescaled or dropped:
        print(f"  {sym}: rescaled {len(rescaled)} days quoted 100 times too high or low {rescaled[:6]}; "
              f"dropped {len(dropped)} one-day spikes {dropped[:6]}")
    return out


def rescale(v, ref):
    """v times or divided by 100 if it is about 100 times off ref."""
    return v * 100 if v < ref / 30 else v / 100 if v > ref * 30 else v


def check_divs(sym, divs, closes, cur):
    """({ex-date: amount}, records): implausible amounts rescaled or left out; prints every dividend used."""
    days = sorted(closes)
    out, recs = {}, []
    for d in sorted(divs):
        i = bisect_left(days, d) - 1
        if i < 0 or d > days[-1]:
            continue                     # before the data, or not yet ex-dividend: no effect
        a, p = divs[d], closes[days[i]]
        share, note = a / p, "as reported"
        if share < DIV_MIN and DIV_MIN <= share * 100 <= DIV_MAX:
            a, note = a * 100, f"rescaled from {divs[d]:g}, 100 times too small"
        elif share > DIV_MAX and DIV_MIN <= share / 100 <= DIV_MAX:
            a, note = a / 100, f"rescaled from {divs[d]:g}, 100 times too large"
        elif not DIV_MIN <= share <= DIV_MAX:
            recs.append([d, divs[d], cur, round(share, 6), "left out: implausible"])
            print(f"  {sym}: dividend of {divs[d]:g} {cur} on {d} left out, {share:.3%} of the price")
            continue
        out[d] = a
        recs.append([d, round(a, 6), cur, round(a / p, 6), note])
    if recs:
        print(f"  {sym} dividends: " + "; ".join(f"{d} {a:g} {c} ({s:.2%}{'' if n == 'as reported' else ', ' + n})"
                                                for d, a, c, s, n in recs))
    return out, recs


def adjust(closes, divs):
    """{date: price}, each price multiplied by (1 - dividend / previous close) for every later ex-dividend
    date, so that returns include dividends reinvested on the ex-dividend day."""
    days = sorted(closes)
    ratio = {}
    for d, a in divs.items():
        i = bisect_left(days, d) - 1
        if i >= 0:
            ratio[d] = 1 - a / closes[days[i]]
    exd, out, f, j = sorted(ratio, reverse=True), {}, 1.0, 0
    for day in reversed(days):
        while j < len(exd) and exd[j] > day:
            f *= ratio[exd[j]]
            j += 1
        out[day] = closes[day] * f
    return out


def pounds(v, cur, ts, rate):
    if cur in ("GBp", "GBX"):
        return v / 100
    if cur == "GBP":
        return v
    if cur == "USD":
        r = rate.at(ts) if rate else None
        if r is None:
            raise ValueError("needs the dollar rate, which is unavailable")
        return v * r
    raise ValueError(f"unknown currency {cur}")


def process(sym, y, cur, rate, src):
    """(fund for funds.json, raw data for the local copy) from one fund's downloads."""
    closes = dict(y["closes"])
    t_last = None
    if y["last"]:
        t_last, p = y["last"]
        closes[lon_date(t_last)] = p           # the latest trade is the latest day's price so far
    closes = clean(sym, closes)
    days = sorted(closes)
    last_day = days[-1]
    if t_last and lon_date(t_last) != last_day:
        t_last = None
    divs, recs = check_divs(sym, y["divs"], closes, cur)
    adj = adjust(closes, divs)
    cut = (date.fromisoformat(last_day) - timedelta(days=KEEP_DAYS)).isoformat()
    rows, gaps = [], []
    for d in days:
        if d < cut:
            continue
        try:
            rows.append([d, round(pounds(adj[d], cur, t_last if d == last_day and t_last else close_time(d), rate), 6)])
        except ValueError:
            if d == last_day:
                raise                            # without the latest price the fund cannot be updated
            gaps.append(d)
    if gaps:
        print(f"  {sym}: left out {len(gaps)} days with no dollar rate {gaps[:6]}")
    if len(rows) < 5:
        raise ValueError(f"only {len(rows)} days")
    today, pts = [], []
    if t_last:
        ref = closes[last_day]
        pts = [(t, rescale(v, ref)) for t, v in y["today"] if lon_date(t) == last_day and t + 300 <= t_last]
        pts.append((t_last, ref))
        for t, v in pts[:-1]:
            try:
                today.append([t, round(pounds(v, cur, t, rate), 6)])
            except ValueError:
                pass                             # a price with no dollar rate near it is left out
        today.append([t_last, rows[-1][1]])
    fund = {"src": src, "cur": cur, "rows": rows, "t": t_last, "today": today}
    raw = {"closes": closes, "adj": adj, "divs": recs, "cut": cut, "today": pts}
    return fund, raw


def build(old_funds, today=None):
    """({ticker: fund}, [tickers updated], {ticker: raw data})."""
    today = today or datetime.now(timezone.utc).date()
    rate = Rate((today - timedelta(days=KEEP_DAYS + 10)).isoformat(), today.isoformat())
    funds, updated, raws = {}, [], {}
    for sym, default_cur in FUNDS.items():
        new, old = None, old_funds.get(sym)
        sources = [("Yahoo", from_yahoo)] + ([] if old else [("Stooq", from_stooq)])
        for name, fn in sources:
            try:
                y = fn(sym)
                cur = y["cur"] or default_cur
                new, raws[sym] = process(sym, y, cur, rate, name)
                n = len(new["today"])
                when = f"latest trade {lon_time(new['t'])} London time" if new["t"] else "no trade time"
                print(f"{sym}: {name}, {len(new['rows'])} days to {new['rows'][-1][0]}, {when}, "
                      f"{n} price{'' if n == 1 else 's'} that day ({cur})")
                break
            except Exception as e:
                print(f"{sym}: {name} failed: {e}")
        if new and old and new["rows"][-1][0] < old["rows"][-1][0]:
            print(f"{sym}: new data end before the published data; keeping the published series")
            new = None
        if new:
            funds[sym] = new
            updated.append(sym)
        elif old:
            funds[sym] = old
            print(f"{sym}: kept the published series, to {old['rows'][-1][0]}")
    return funds, updated, raws


def make(old):
    """(the new funds.json as a dict, or None if no fund could be updated; raw data per fund)."""
    funds, updated, raws = build(old.get("funds", {}))
    if not updated:
        return None, raws
    order = [s for s in FUNDS if s in funds]
    ts = [f["t"] for f in funds.values() if f.get("t")]
    new = {"funds": {s: funds[s] for s in order}, "order": order, "last": max(f["rows"][-1][0] for f in funds.values()),
           "asof": max(ts) if ts else None, "updated": int(time.time()), "source": SOURCE}
    print(f"Updated {len(updated)} of {len(FUNDS)} funds" +
          (f"; latest trade {lon_time(new['asof'])} London time on {lon_date(new['asof'])}." if new["asof"] else "."))
    return new, raws


def same(a, b):
    """True if two versions of funds.json differ at most in when they were made."""
    return {k: v for k, v in a.items() if k != "updated"} == {k: v for k, v in b.items() if k != "updated"}


def main():
    old = json.loads(JSON_F.read_text()) if JSON_F.exists() else {}
    new, _ = make(old)
    if new is None:
        sys.exit("No fund could be downloaded in this run. The published file is unchanged; check the log above.")
    if same(new, old):
        print("No new prices since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    print("Written funds.json.")


if __name__ == "__main__":
    main()
