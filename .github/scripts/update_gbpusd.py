"""Refresh gbpusd/gbpusd.json: US dollars per pound sterling, daily, for roughly the last 13 months,
from two sources the page lets visitors switch between or compare.

Version 6 (5 November 2026): Wise's rates now come from Wise's public rate history, at 00:00 UTC each
day, so every day is taken at the same time and the series starts about 13 months back instead of today;
the cost of converting $1,000 uses that day's 00:00 rate and the fee from Wise's quote that day.
Version 5 is in _TO_BE_DELETED/19_pound_and_dollar_v5.
Version 5 (5 November 2026). Changes from the handoff (version 1, in _TO_BE_DELETED/gbpusd_chart_v1):
Wise's current quote address is tried if the older one fails; the exact time of the latest Wise rate is
kept; the source note gives no fixed time of day, because GitHub often starts scheduled runs late; and
each day records Wise's price for converting $1,000 into pounds (the fee in dollars and the pounds
received). Earlier versions are in _TO_BE_DELETED.

Run by .github/workflows/update-gbpusd.yml every day; standard library only.
  - ECB: European Central Bank euro reference rates (published on TARGET working days around 16:00 CET),
    crossed through the euro, via api.frankfurter.dev with the ECB as the only provider.
  - Wise rates: Wise's public rate history (wise.com/rates/history+live, the service behind the charts on
    Wise's website; no account needed, but not a documented API), USD to GBP at 00:00 UTC each day for
    about 13 months, including today's 00:00 rate from the hourly history. Saved as US dollars per pound
    (1 / Wise's rate) like the ECB series.
  - Wise cost: Wise's public quote endpoint (POST /v3/quotes, or /2026Q4/quotes if that fails; no account
    or token needed) for converting $1,000 into pounds within Wise (Wise's BALANCE pay-in and pay-out
    option) gives that day's fee in dollars. The pounds received are ($1,000 minus the fee) times that
    day's 00:00 rate, so the cost line is at the same time of day as the rates. Kept as "cost_usd_gbp"
    next to the rates, from the first run on; Wise publishes no fee history. These are Wise's standard
    prices; an account with volume discounts may pay a little less.
  - If the rate history fails, today's rate and pounds received come from the quote instead, at the time
    of the run, as in version 5.
Safety: if the ECB download fails, or would end earlier or hold far fewer days than the published file,
nothing is written and the run fails. If the Wise request fails, the published Wise series is kept
unchanged and the ECB update still goes ahead. The live chart is never damaged.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "gbpusd"
JSON_F, HTML_F = OUT / "gbpusd.json", OUT / "gbpusd.html"
UA = {"User-Agent": "gbpusd-chart/1.0 (academic website)", "Accept": "application/json"}
ECB_URL = ("https://api.frankfurter.dev/v2/rates?from={start}&to={end}"
           "&base=GBP&quotes=USD&providers=ECB")
WISE_URLS = ["https://api.wise.com/v3/quotes", "https://api.wise.com/2026Q4/quotes"]
WISE_HISTORY = "https://wise.com/rates/history+live?source=USD&target=GBP&length={n}&resolution={res}&unit={unit}"
WISE_BODY = {"sourceCurrency": "USD", "targetCurrency": "GBP", "sourceAmount": 1000, "payOut": "BALANCE"}
DAYS_BACK = 400
SOURCES = {
    "ecb": ("ECB: European Central Bank euro reference rates, crossed through the euro, via api.frankfurter.dev, "
            "published on European working days."),
    "wise": ("Wise: Wise's rate between the pound and the US dollar before fees, at 00:00 UTC each day, from Wise's "
             "public rate history. 'Wise after fees' is the pounds received per dollar when converting $1,000 at that "
             "rate after Wise's fee that day, at Wise's standard prices, recorded daily from November 2026."),
}
NOTE = "Updated automatically every day."


def get(url, headers=None, body=None, tries=4):
    h = dict(UA, **(headers or {}))
    data = None
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode("utf-8"), "application/json"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404) or i == tries - 1:   # no point retrying a refused request
                raise
            print(f"  retry in {30 * (i + 1)}s after: {e}")
            time.sleep(30 * (i + 1))
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry in {30 * (i + 1)}s after: {e}")
            time.sleep(30 * (i + 1))


def check(rows, label):
    bad = {d: v for d, v in rows.items() if not 0.5 < v < 3}
    if bad:
        raise ValueError(f"{label}: implausible rates {bad}")


def ecb():
    """{date: US dollars per pound} from the ECB, via Frankfurter."""
    end = date.today()
    js = get(ECB_URL.format(start=(end - timedelta(days=DAYS_BACK)).isoformat(), end=end.isoformat()))
    if isinstance(js, dict) and "rates" in js:
        js = js["rates"]
    rows = {}
    if isinstance(js, list):                        # v2: one row per date and quote
        rows = {r["date"]: float(r["rate"]) for r in js
                if isinstance(r, dict) and r.get("quote") == "USD" and r.get("base", "GBP") == "GBP"}
    elif isinstance(js, dict):                      # older layout: {date: {"USD": rate}}
        rows = {d: float(v["USD"]) for d, v in js.items() if isinstance(v, dict) and "USD" in v}
    if not rows:
        sys.exit(f"No ECB GBP to USD rows. First 300 characters: {json.dumps(js)[:300]}")
    check(rows, "ECB")
    print(f"ECB GBP to USD: {len(rows)} days, {min(rows)} to {max(rows)}")
    return rows


def wise_today():
    """(date, US dollars per pound, time of the rate, cost) right now, from Wise's quote for converting
    $1,000 into pounds."""
    for i, url in enumerate(WISE_URLS):
        try:
            js = get(url, body=WISE_BODY, tries=2)
            break
        except Exception as e:
            if i == len(WISE_URLS) - 1:
                raise
            print(f"  Wise {url} failed ({e}); trying {WISE_URLS[i + 1]}")
    if js.get("sourceCurrency") != "USD" or js.get("targetCurrency") != "GBP":
        raise ValueError(f"unexpected quote currencies: {js.get('sourceCurrency')} to {js.get('targetCurrency')}")
    pounds_per_dollar = float(js["rate"])
    rate = 1 / pounds_per_dollar                    # saved as US dollars per pound, like the ECB series
    check({"today": rate}, "Wise")
    when = js.get("rateTimestamp") or js.get("createdTime") or ""
    day = when[:10] or date.today().isoformat()
    print(f"Wise GBP to USD: {rate:.5f} on {day} (USD to GBP {pounds_per_dollar})" + (f", rate time {when} (UTC)" if when else ""))
    return day, rate, when, balance_cost(js, pounds_per_dollar)


def balance_cost(js, rate):
    """(fee in dollars, pounds received) for $1,000 converted into pounds within Wise, or None if the quote
    does not have that option or its numbers do not add up. rate is pounds per dollar.
    Wise marks the option 'disabled' in a quote made without an account, but still prices it."""
    opt = [o for o in js.get("paymentOptions") or [] if o.get("payIn") == "BALANCE" and o.get("payOut") == "BALANCE"]
    if not opt:
        print("  Wise: no balance-to-balance price in the quote; recording the rate only")
        return None
    o = opt[0]
    try:
        fee, got, paid = float(o["fee"]["total"]), float(o["targetAmount"]), float(o.get("sourceAmount") or 1000)
    except (KeyError, TypeError, ValueError) as e:
        print(f"  Wise: could not read the balance price ({e}); recording the rate only")
        return None
    if not (0 <= fee <= 0.05 * paid and paid == WISE_BODY["sourceAmount"] and abs(got / ((paid - fee) * rate) - 1) < 0.005):
        print(f"  Wise: balance price does not add up (fee {fee}, received {got}, rate {rate}); recording the rate only")
        return None
    print(f"  Wise: ${paid:,.0f} converted to pounds gives £{got:,.2f} after a ${fee:.2f} fee ({fee / paid:.2%})")
    return round(fee, 2), round(got, 2)


def wise_history():
    """{date: US dollars per pound} at 00:00 UTC each day for about 13 months, today included, from Wise's
    public rate history; {} if it fails."""
    try:
        daily = get(WISE_HISTORY.format(n=13, res="daily", unit="month"), tries=2)
        hourly = get(WISE_HISTORY.format(n=1, res="hourly", unit="day"), tries=2)
    except Exception as e:
        print(f"Wise rate history failed ({e}); using today's quote instead")
        return {}
    rows = {}
    for r in (daily or []) + (hourly or []):
        try:
            t, v = int(r["time"]) // 1000, float(r["value"])
        except (KeyError, TypeError, ValueError):
            continue
        if t % 86400 == 0 and r.get("source") == "USD" and r.get("target") == "GBP" and v > 0:
            rows[time.strftime("%Y-%m-%d", time.gmtime(t))] = 1 / v      # only the 00:00 UTC values
    if not rows:
        print("Wise rate history had no daily values; using today's quote instead")
        return {}
    try:
        check(rows, "Wise history")
    except ValueError as e:
        print(f"{e}; using today's quote instead")
        return {}
    print(f"Wise rate history: {len(rows)} days at 00:00 UTC, {min(rows)} to {max(rows)}")
    return rows


def series(rows):
    days = sorted(rows)
    return {"rates": [[d, round(rows[d], 5)] for d in days], "last": days[-1]}


def make(old):
    """The new gbpusd.json as a dict, from the published one (old); stops the run if the ECB data look wrong."""
    old_ecb = old.get("ecb") or ({"rates": old["rates"], "last": old["last"]} if "rates" in old else None)
    old_wise = old.get("wise")

    new_ecb = series(ecb())
    if old_ecb:                                     # guard: never publish less than is already live
        if new_ecb["last"] < old_ecb["last"]:
            sys.exit(f"ECB data end {new_ecb['last']}, published file ends {old_ecb['last']}. Not writing.")
        if len(new_ecb["rates"]) < 0.9 * len(old_ecb["rates"]):
            sys.exit(f"ECB data have {len(new_ecb['rates'])} days, published {len(old_ecb['rates'])}. Not writing.")

    new_wise = {k: v for k, v in old_wise.items() if k != "cost"} if old_wise else None   # version 3 costs were pounds into dollars
    hist = wise_history()
    try:
        quote = wise_today()
    except Exception as e:
        print(f"Wise quote failed ({e})")
        quote = None
    if hist or quote:
        rows = {d: v for d, v in (old_wise or {"rates": []})["rates"]}
        rows.update(hist)                           # Wise's own 00:00 UTC rates replace earlier ones
        costs = {d: [f, g] for d, f, g in (old_wise or {}).get("cost_usd_gbp", [])}
        if quote:
            day, rate, when, cost = quote
            if day in hist:                         # the day's 00:00 rate, and the pounds received at that rate
                when = day + "T00:00:00Z"
                if cost:
                    cost = (cost[0], round((1000 - cost[0]) / hist[day], 2))
                    print(f"  Saved at the day's 00:00 UTC rate: $1,000 gives £{cost[1]:,.2f} after the ${cost[0]:.2f} fee")
            else:
                rows[day] = rate                    # no history for today: the quote's rate, at the time of the run
            if cost:
                costs[day] = list(cost)
            elif day in costs and day not in hist:
                del costs[day]                      # an older price for today would not match today's new rate
        else:
            when = max(hist) + "T00:00:00Z"
            print("  keeping the saved Wise costs; no new one today")
        cutoff = (date.today() - timedelta(days=DAYS_BACK)).isoformat()
        new_wise = series({d: v for d, v in rows.items() if d >= cutoff})
        if when:
            new_wise["time"] = when                 # time of the latest Wise rate, UTC
        if costs:                                   # [date, fee in dollars, pounds received] for $1,000
            new_wise["cost_usd_gbp"] = [[d] + costs[d] for d in sorted(costs) if d >= cutoff]
    else:
        print("Wise rate history and quote both failed: keeping the published Wise series")

    sources = {"ecb": SOURCES["ecb"] + " " + NOTE}
    if new_wise:
        sources["wise"] = SOURCES["wise"]           # already says it is recorded by the daily update
    return {"ecb": new_ecb, "wise": new_wise, "sources": sources}


def main():
    old = json.loads(JSON_F.read_text()) if JSON_F.exists() else {}
    new = make(old)
    if new == old:
        print("No new data since the last update.")
        return

    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")              # cache-busting stamp so browsers fetch the new data
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    print(f"Latest ECB: {new['ecb']['rates'][-1][1]} on {new['ecb']['last']}")
    if new["wise"]:
        print(f"Latest Wise: {new['wise']['rates'][-1][1]} on {new['wise']['last']}")


if __name__ == "__main__":
    main()
