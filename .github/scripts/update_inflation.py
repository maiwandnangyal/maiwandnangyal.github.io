"""Refresh inflation/inflation.json: consumer price inflation in Afghanistan and Pakistan.

Run by .github/workflows/update-inflation.yml every day; standard library only. 2_build_chart.py
also uses assemble() from this file, so the website data are built the same way locally and online.
Same method as 1_download_inflation.py:
  - Annual: World Bank WDI, inflation, consumer prices (FP.CPI.TOTL.ZG): Pakistan from 1960,
    Afghanistan from 2005. Afghanistan 2003 and 2004: IMF World Economic Outlook (PCPIPCH), the
    only earlier figures, from an older price index. Years after the World Bank's last year:
    average index of the year over the average of the year before, as the World Bank does.
  - Monthly: IMF Consumer Price Index (CPI), all items index, for both countries (Pakistan to the
    latest month; Afghanistan to January 2025). Afghanistan after that: the consumer price index
    of NSIA (National Statistics and Information Authority; same index, April 2015 = 100), typed
    in by hand from where it is published (the World Bank's Afghanistan Economic Monitor, or an
    NSIA release): data/afg_cpi_nsia.csv in the research folder, carried in the published file
    as "nsia". Inflation for a month = index / index 12 months earlier - 1.
  - The current, incomplete year: average index so far over the same months a year earlier.
Safety: if the IMF download fails, or a country would end earlier or have fewer years than the
published file, nothing is written and the run fails, so the live chart is never damaged.
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "inflation"
JSON_F, HTML_F = OUT / "inflation.json", OUT / "inflation.html"
UA = "afghanistan-pakistan-inflation-research/1.0 (academic)"
COUNTRIES = ("AFG", "PAK")
WDI = ("https://api.worldbank.org/v2/country/AFG;PAK/indicator/FP.CPI.TOTL.ZG"   # both countries, one request
       "?format=json&per_page=500&date=1950:2035")
IMF = "https://api.imf.org/external/sdmx/2.1/data/"
IMF_CPI = IMF + "IMF.STA,CPI/AFG+PAK.CPI._T.IX.M?detail=dataonly"     # all-items index, monthly
IMF_WEO = IMF + "IMF.RES,WEO/AFG.PCPIPCH.A?detail=dataonly"           # average consumer prices, % change
SDMX_CSV = "application/vnd.sdmx.data+csv;version=1.0.0"
RECENT_MONTHS = 36          # monthly figures published for the 'this year' tab
TIMEOUT, WAIT = 60, 30      # seconds per attempt, and the wait before the first retry (doubles after)


def fetch(url, accept="application/json", tries=4):
    """The reply as text. The World Bank's server sometimes stalls without answering, so each
    attempt gives up after TIMEOUT seconds and is tried again."""
    for i in range(tries):
        t0 = time.time()
        print(f"  downloading {url.split('//')[1][:70]}...", end="", flush=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                text = r.read().decode("utf-8")
            print(f" done ({time.time() - t0:.1f}s)")
            return text
        except Exception as e:
            print(f" failed after {time.time() - t0:.0f}s: {e}")
            if i == tries - 1:
                raise
            print(f"  trying again in {WAIT * 2 ** i}s")
            time.sleep(WAIT * 2 ** i)


def wdi_annual():
    """{country: {year: % change}} from the World Bank."""
    js = json.loads(fetch(WDI))
    if not isinstance(js, list) or len(js) < 2 or not js[1] or js[0].get("pages", 1) > 1:
        raise ValueError(f"unexpected World Bank reply: {str(js)[:200]}")
    out = {c: {} for c in COUNTRIES}
    for r in js[1]:
        if r.get("countryiso3code") in out and r["value"] is not None:
            out[r["countryiso3code"]][int(r["date"])] = float(r["value"])
    for c, v in out.items():
        if not v:
            raise ValueError(f"no World Bank figures for {c}")
    print("World Bank: " + ", ".join(f"{c} {min(v)} to {max(v)}" for c, v in out.items()))
    return out


def sdmx_rows(text):
    """(country, period, value) from an IMF SDMX-CSV reply. The csv module copes with the quoted
    commas and line breaks in the IMF's metadata columns."""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "TIME_PERIOD" not in rows[0] or "OBS_VALUE" not in rows[0]:
        raise ValueError(f"unexpected IMF reply: {text[:200]}")
    out = []
    for r in rows:
        try:
            v = float(r["OBS_VALUE"])
        except (TypeError, ValueError):
            continue
        if v == v:                                  # skip NaN
            out.append((r["COUNTRY"], r["TIME_PERIOD"], v))
    return out


def imf_index():
    """{country: {'YYYY-MM': index}} from the IMF CPI dataset."""
    out = {c: {} for c in COUNTRIES}
    for c, p, v in sdmx_rows(fetch(IMF_CPI, SDMX_CSV)):
        m = re.fullmatch(r"(\d{4})-M(\d\d)", p)
        if c in out and m:
            out[c][f"{m[1]}-{m[2]}"] = v
    for c, s in out.items():
        if not s:
            raise ValueError(f"no IMF consumer price index for {c}")
    print("IMF CPI index: " + ", ".join(f"{c} {min(s)} to {max(s)}" for c, s in out.items()))
    return out


def weo_afg():
    """{year: % change} for Afghanistan from the IMF World Economic Outlook."""
    out = {int(p): v for c, p, v in sdmx_rows(fetch(IMF_WEO, SDMX_CSV)) if c == "AFG" and p.isdigit()}
    if not out:
        raise ValueError("no WEO figures for Afghanistan")
    return out


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs)


def assemble(wdi, weo, imf, nsia):
    """The website data.
    wdi: {country: {year: %}}; weo: {year: %} (Afghanistan); imf: {country: {'YYYY-MM': index}};
    nsia: [[month, index, via, issue, url]] for Afghanistan, NSIA's index typed in by hand."""
    idx = {c: dict(imf[c]) for c in COUNTRIES}
    last_imf = max(idx["AFG"])
    used = [r for r in sorted(nsia) if r[0] > last_imf]         # the IMF's own figures come first
    for m, v, *_ in used:
        idx["AFG"][m] = float(v)

    data = {"annual": {}, "ytd": {}, "months": {}, "last": {}}
    for c in COUNTRIES:
        ix = idx[c]
        months = sorted(ix)
        yoy = {}
        for m in months:
            prev = f"{int(m[:4]) - 1}{m[4:]}"
            if prev in ix:
                yoy[m] = (ix[m] / ix[prev] - 1) * 100
        by_year = defaultdict(dict)
        for m in months:
            by_year[int(m[:4])][m[5:]] = ix[m]

        ann = {y: (v, "wdi") for y, v in wdi[c].items()}
        if c == "AFG" and ann:
            ann.update({y: (v, "weo") for y, v in weo.items() if y < min(ann)})
        for y, cur in by_year.items():           # full years after the World Bank's last one
            prev = by_year.get(y - 1, {})
            if y not in ann and (not ann or y > max(ann)) and len(cur) == 12 and len(prev) == 12:
                ann[y] = (mean(cur.values()) / mean(prev.values()) - 1) * 100, "cpi"
        data["annual"][c] = [[y, round(v, 2), s] for y, (v, s) in sorted(ann.items())]

        y = int(months[-1][:4])                  # the current year, if incomplete
        cur, prev = by_year[y], by_year.get(y - 1, {})
        keys = sorted(cur)
        if (len(keys) < 12 and keys == [f"{i:02d}" for i in range(1, len(keys) + 1)]
                and all(k in prev for k in keys) and y not in ann):
            data["ytd"][c] = [y, len(keys), round((mean(cur.values()) / mean(prev[k] for k in keys) - 1) * 100, 2)]
        data["months"][c] = [[m, round(v, 2)] for m, v in sorted(yoy.items())][-RECENT_MONTHS:]
        data["last"][c] = months[-1]

    via = []
    for r in used:
        if r[2] not in via:
            via.append(r[2])
    data["nsia"] = [list(r) for r in sorted(nsia)]
    data["source"] = (
        "Sources: World Bank WDI, inflation, consumer prices (FP.CPI.TOTL.ZG), annual; International "
        "Monetary Fund, Consumer Price Index (CPI), data.imf.org, monthly index"
        + (f"; Afghanistan from {month_name(used[0][0])} to {month_name(used[-1][0])}: the consumer price index of "
           f"NSIA (National Statistics and Information Authority), via {' and '.join(via)}" if used else "")
        + "; Afghanistan 2003 and 2004: International Monetary Fund, World Economic Outlook. Annual figures "
        "compare average prices over the year with the year before; monthly figures compare each month "
        "with the same month a year earlier. Updated automatically every day.")
    return data


def month_name(m):
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September",
            "October", "November", "December"][int(m[5:]) - 1] + " " + m[:4]


def main():
    old = json.loads(JSON_F.read_text())
    imf = imf_index()                              # required: without it the run fails
    try:
        wdi = wdi_annual()
    except Exception as e:                         # annual data rarely change: keep the published copy
        print(f"World Bank download failed ({e}); keeping the published annual series")
        wdi = {c: {y: v for y, v, s in old["annual"][c] if s == "wdi"} for c in COUNTRIES}
    try:
        weo = weo_afg()
    except Exception as e:
        print(f"IMF WEO download failed ({e}); keeping the published 2003-2004 figures")
        weo = {y: v for y, v, s in old["annual"]["AFG"] if s == "weo"}
    new = assemble(wdi, weo, imf, old["nsia"])

    for c in COUNTRIES:                            # guard: never publish less than is already live
        if new["last"][c] < old["last"][c] or len(new["annual"][c]) < len(old["annual"][c]):
            sys.exit(f"{c}: new data end {new['last'][c]} with {len(new['annual'][c])} years; published "
                     f"file ends {old['last'][c]} with {len(old['annual'][c])}. Not writing.")
    if new == old:
        print("No new data since the last update.")
        return
    JSON_F.write_text(json.dumps(new, separators=(",", ":")))
    v = time.strftime("%Y%m%d%H%M%S")              # cache-busting stamp, as in 2_build_chart.py
    html = HTML_F.read_text()
    html = re.sub(r'\?v=\d{14}', f"?v={v}", html)
    html = re.sub(r'data-v="\d{14}"', f'data-v="{v}"', html)
    HTML_F.write_text(html)
    for c in COUNTRIES:
        m = new["months"][c][-1]
        print(f"Latest {c}: {m[1]}% in {m[0]}; latest year {new['annual'][c][-1][:2]}"
              + (f"; {new['ytd'][c][0]} so far ({new['ytd'][c][1]} months) {new['ytd'][c][2]}%" if c in new["ytd"] else ""))


if __name__ == "__main__":
    main()
