/* The pound and the US dollar: last week, month, quarter and year, as ECB reference rates, Wise rates before
   and after fees, or all three. Reads gbpusd.json (rebuilt every day by .github/workflows/update-gbpusd.yml).
   No libraries needed. Version 5 (5 November 2026); earlier versions are in _TO_BE_DELETED. */
(async function () {
  const root = document.querySelector('.viz-root');
  const $ = s => root.querySelector(s);
  const holder = $('.chart'), tip = $('.tooltip');
  const NS = 'http://www.w3.org/2000/svg';

  if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed');
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'gbpusd.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }

  let raw;
  try {
    const r = await fetch('gbpusd.json?v=' + (root.dataset.v || ''));
    if (!r.ok) throw new Error(r.status);
    raw = await r.json();
  } catch (e) {
    holder.innerHTML = '<p class="msg">The exchange rate data could not be loaded. Please try again later.</p>';
    return;
  }

  const parse = s => new Date(s + 'T00:00:00Z');
  const toRows = a => a.map(([d, v]) => ({date: parse(d), usd: v, gbp: 1 / v}));
  // An older data file holds ECB rates only ({rates, last, source}): read it the same way
  const S = {
    ecb: {name: 'ECB reference rate', color: 'var(--a)', rows: toRows((raw.ecb || raw).rates)},
    wise: {name: 'Wise rate', color: 'var(--b)', rows: raw.wise && raw.wise.rates.length ? toRows(raw.wise.rates) : null},
    // [date, fee in dollars, pounds received for $1,000] -> pounds received per dollar
    net: {name: 'Wise after fees', color: 'var(--c, #1baf7a)',
          rows: raw.wise && raw.wise.cost_usd_gbp && raw.wise.cost_usd_gbp.length
            ? raw.wise.cost_usd_gbp.map(([d, fee, got]) => ({date: parse(d), gbp: got / 1000, usd: 1000 / got, fee, got})) : null}
  };
  const SRC = {
    ecb: (raw.sources && raw.sources.ecb) || raw.source,
    wise: raw.sources && raw.sources.wise,
    net: raw.sources && raw.sources.wise
  };

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fLong = d => `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const fShort = d => `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  const fMonth = d => `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  const fmt = v => v.toFixed(4);

  const DIR = {
    usd: {sym: '$', unit: 'US dollars per pound', short: 'per £1', rise: 'pound stronger', fall: 'pound weaker'},
    gbp: {sym: '£', unit: 'pounds per US dollar', short: 'per US$1', rise: 'dollar stronger', fall: 'dollar weaker'}
  };
  const PER = {
    week: {label: 'last 7 days', back: d => d.setUTCDate(d.getUTCDate() - 7)},
    month: {label: 'last month', back: d => d.setUTCMonth(d.getUTCMonth() - 1)},
    quarter: {label: 'last 3 months', back: d => d.setUTCMonth(d.getUTCMonth() - 3)},
    year: {label: 'last 12 months', back: d => d.setUTCFullYear(d.getUTCFullYear() - 1)}
  };
  let period = 'month', dir = 'gbp', mode = 'ecb';

  if (!S.wise.rows) {                               // no Wise data yet: offer the ECB series only
    root.querySelectorAll('.src button[data-s="wise"], .src button[data-s="net"], .src button[data-s="both"]').forEach(b => {
      b.disabled = true; b.title = 'Wise rates are not available yet';
    });
  } else if (!S.net.rows) {
    const b = root.querySelector('.src button[data-s="net"]');
    if (b) { b.disabled = true; b.title = 'Wise fees are not available yet'; }
  }

  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    period = b.dataset.p;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw(true);
  }));
  root.querySelectorAll('.src button').forEach(b => b.addEventListener('click', () => {
    if (b.disabled) return;
    mode = b.dataset.s;
    root.querySelectorAll('.src button').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw(true);
  }));
  root.querySelectorAll('.dir button').forEach(b => b.addEventListener('click', () => {
    dir = b.dataset.d;
    root.querySelectorAll('.dir button').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw(true);
  }));

  const keys = () => mode === 'both' ? ['ecb', 'wise'].concat(S.net.rows ? ['net'] : []) : [mode];

  // the latest cost of converting $1,000 into pounds at Wise
  function feeStat() {
    const c = S.net.rows && S.net.rows[S.net.rows.length - 1];
    if (!c) return '';
    return `<div class="stat"><div class="k">Converting $1,000 at Wise, ${fShort(c.date)}</div>
      <div class="v">£${c.got.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
      <div class="s">after a $${c.fee.toFixed(2)} fee (${(c.fee / 10).toFixed(2)}%)</div></div>`;
  }

  function windowed(ks) {
    const end = new Date(Math.max(...ks.map(k => S[k].rows[S[k].rows.length - 1].date.getTime())));
    const start = new Date(end.getTime());
    PER[period].back(start);
    const out = {};
    ks.forEach(k => {
      out[k] = S[k].rows.filter(r => r.date >= start);
      if (!out[k].length) out[k] = S[k].rows.slice(-1);      // e.g. Wise rates missing for a while: show the latest
    });
    return {data: out, end, start};
  }

  // the latest value on or before a date, so series with different calendars can be compared
  const asOf = (rows, d) => { let r = null; for (const x of rows) { if (x.date <= d) r = x; else break; } return r; };

  // a series that starts after the window opens (the Wise history builds up daily) is labelled 'since ...'
  const partial = (rows, start) => rows[0].date.getTime() - start.getTime() > 3 * 864e5;
  const span = (rows, start) => partial(rows, start)
    ? `since ${fShort(rows[0].date)} ${rows[0].date.getUTCFullYear()}` : `over the ${PER[period].label}`;

  function stats(data, ks, start) {
    const D = DIR[dir], box = $('.stats');
    if (ks.length === 1) {
      const rows = data[ks[0]], a = rows[0][dir], zr = rows[rows.length - 1], z = zr[dir], ch = z / a - 1, lab = span(rows, start);
      const vals = rows.map(r => r[dir]), lo = Math.min(...vals), hi = Math.max(...vals);
      const cls = ch > 0 ? 'up' : ch < 0 ? 'down' : '';
      box.innerHTML = `
        <div class="stat"><div class="k">Latest, ${fShort(zr.date)} ${zr.date.getUTCFullYear()}${ks[0] === 'wise' ? wiseTime(zr) : ''}</div>
          <div class="v">${D.sym}${fmt(z)}</div><div class="s">${D.short}</div></div>
        <div class="stat"><div class="k">Change ${lab}</div>
          <div class="v ${cls}">${ch > 0 ? '+' : ''}${(ch * 100).toFixed(2)}%</div><div class="s">${ch > 0 ? D.rise : ch < 0 ? D.fall : 'unchanged'}</div></div>
        <div class="stat"><div class="k">Range ${lab}</div>
          <div class="v">${D.sym}${fmt(lo)}–${fmt(hi)}</div><div class="s">low to high</div></div>` + (ks[0] === 'net' ? feeStat() : '');
      return;
    }
    const e = data.ecb[data.ecb.length - 1], w = data.wise[data.wise.length - 1];
    const wiseOn = new Map(data.wise.map(r => [r.date.getTime(), r]));
    const both = data.ecb.filter(r => wiseOn.has(r.date.getTime()));      // days with a rate from both sources
    const gap = r => (wiseOn.get(r.date.getTime())[dir] / r[dir] - 1) * 100, sg = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    let third;
    if (both.length) {
      const lastBoth = both[both.length - 1], avg = both.reduce((s, r) => s + gap(r), 0) / both.length;
      third = `<div class="stat"><div class="k">Wise against ECB, ${fShort(lastBoth.date)}</div>
        <div class="v">${sg(gap(lastBoth))}</div><div class="s">average over ${both.length} day${both.length > 1 ? 's' : ''}: ${sg(avg)}</div></div>`;
    } else {
      third = `<div class="stat"><div class="k">Wise against ECB</div>
        <div class="v">–</div><div class="s">no day with both rates yet</div></div>`;
    }
    box.innerHTML = `
      <div class="stat"><div class="k">ECB, ${fShort(e.date)} ${e.date.getUTCFullYear()}</div>
        <div class="v">${D.sym}${fmt(e[dir])}</div><div class="s">${D.short}</div></div>
      <div class="stat"><div class="k">Wise, ${fShort(w.date)} ${w.date.getUTCFullYear()}${wiseTime(w)}</div>
        <div class="v">${D.sym}${fmt(w[dir])}</div><div class="s">${D.short}</div></div>` + third + feeStat();
  }

  // the exact time of the latest Wise rate, in UK time, if the data file has it
  function wiseTime(r) {
    const t = raw.wise && raw.wise.time ? new Date(raw.wise.time) : null;
    if (!t || isNaN(t) || t.toISOString().slice(0, 10) !== r.date.toISOString().slice(0, 10)) return '';
    return ', ' + t.toLocaleTimeString('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}) + ' UK time';
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo, rough = span / n, mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toFixed(6));
    return {ticks: out, step};
  }

  function draw(animate) {
    const ks = keys(), D = DIR[dir], {data, end, start} = windowed(ks);
    holder.innerHTML = ''; tip.hidden = true;
    stats(data, ks, start);
    const what = ks.length > 2 ? 'ECB reference rates and Wise rates before and after fees'
      : ks.length > 1 ? 'ECB reference and Wise rates'
      : mode === 'wise' ? 'Wise rates' : mode === 'net' ? 'Wise rates after fees' : 'ECB reference rates';
    const one = ks.length === 1 && partial(data[ks[0]], start);
    const when = one ? `from ${fLong(data[ks[0]][0].date)}` : `over the ${PER[period].label}`;
    const note = ks.length > 1 && partial(data.wise, start) ? ` Wise rates are recorded from ${fLong(data.wise[0].date)}.` : '';
    $('.subtitle').textContent = `${D.unit[0].toUpperCase() + D.unit.slice(1)}, daily ${what}, ${when} to ${fLong(end)}.${note}`;
    $('.legend').innerHTML = ks.length > 1 ? ks.map(k => `<span><span class="sw" style="background:${S[k].color}"></span>${S[k].name}</span>`).join('') : '';
    $('.source').textContent = [...new Set(ks.map(k => SRC[k]).filter(Boolean))].join(' ');

    const W = Math.max(320, holder.clientWidth), H = W < 520 ? 260 : 330;
    const m = {t: 12, r: 64, b: 30, l: 52}, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, width: W, height: H}, holder);
    const g = el('g', {transform: `translate(${m.l},${m.t})`}, svg);

    const all = ks.flatMap(k => data[k]);
    const vals = all.map(r => r[dir]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo || hi * 0.002) * 0.12; lo -= pad; hi += pad;
    const t0 = Math.min(...all.map(r => r.date.getTime())), t1 = end.getTime();
    const x = d => (t1 === t0 ? iw / 2 : (d.getTime() - t0) / (t1 - t0) * iw);
    const y = v => ih - (v - lo) / (hi - lo) * ih;

    const yt = niceTicks(lo, hi, 5);
    const dp = Math.max(2, Math.min(4, -Math.floor(Math.log10(yt.step)) + 1));
    const grid = el('g', {class: 'grid'}, g), yax = el('g', {class: 'axis'}, g);
    yt.ticks.forEach(v => {
      el('line', {x1: 0, x2: iw, y1: y(v), y2: y(v)}, grid);
      el('text', {x: -8, y: y(v) + 4, 'text-anchor': 'end'}, yax).textContent = D.sym + v.toFixed(dp);
    });
    el('line', {class: 'baseline', x1: 0, x2: iw, y1: ih, y2: ih}, g);

    const xax = el('g', {class: 'axis'}, g);
    let xt = [];
    if (period === 'week' || period === 'month') {
      const days = [...new Set(all.map(r => r.date.getTime()))].sort((a, b) => a - b).map(t => new Date(t));
      const every = period === 'week' ? (W < 520 ? 2 : 1) : Math.ceil(days.length / (W < 520 ? 4 : 6));   // fewer labels on phones
      xt = days.filter((_, i) => i % every === 0);
    } else {
      const d = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1));
      const stepM = period === 'quarter' ? 1 : 2;
      for (; d <= end; d.setUTCMonth(d.getUTCMonth() + stepM)) xt.push(new Date(d));
    }
    const lab = period === 'week' ? (d => `${DAY[d.getUTCDay()]} ${d.getUTCDate()}`) : period === 'month' ? fShort : fMonth;
    xt.forEach(d => { el('text', {x: x(d), y: ih + 20, 'text-anchor': 'middle'}, xax).textContent = lab(d); });

    const drawn = {};
    ks.forEach((k, idx) => {
      const rows = data[k], col = S[k].color;
      const pts = rows.map(r => [x(r.date), y(r[dir])]);
      const dLine = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
      if (ks.length === 1) el('path', {class: 'area', fill: col, d: dLine + `L${pts[pts.length - 1][0].toFixed(1)},${ih}L${pts[0][0].toFixed(1)},${ih}Z`}, g);
      const line = el('path', {class: 'line', stroke: col, d: dLine}, g);
      const lp = pts[pts.length - 1];
      const lastDot = el('circle', {class: 'lastdot', fill: col, cx: lp[0], cy: lp[1], r: 4.5}, g);
      const lastLab = el('text', {class: 'lastlab', x: lp[0] + 9, y: lp[1] + 4}, g);
      lastLab.textContent = D.sym + fmt(rows[rows.length - 1][dir]);
      if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const len = line.getTotalLength();
        line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
        lastDot.style.opacity = 0; lastLab.style.opacity = 0;
        requestAnimationFrame(() => {
          line.style.transition = 'stroke-dashoffset 0.9s ease-out';
          line.style.strokeDashoffset = 0;
          setTimeout(() => { lastDot.style.opacity = 1; lastLab.style.opacity = 1; }, 850);
        });
      }
      drawn[k] = {rows, pts, lastLab};
    });
    // end labels: all to the right of the last dots, and at least 13 pixels apart
    const labX = Math.max(...ks.map(k => drawn[k].pts[drawn[k].pts.length - 1][0])) + 9;
    const labs = ks.map(k => ({t: drawn[k].lastLab, y: +drawn[k].lastLab.getAttribute('y')})).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
    labs.forEach(l => { l.t.setAttribute('y', l.y); l.t.setAttribute('x', labX); });

    const cross = el('line', {class: 'cross', y1: 0, y2: ih, visibility: 'hidden'}, g);
    const dots = ks.map(k => el('circle', {class: 'dot', fill: S[k].color, r: 5, visibility: 'hidden'}, g));
    const hit = el('rect', {x: 0, y: 0, width: iw, height: ih, fill: 'transparent'}, g);
    const days = [...new Set(all.map(r => r.date.getTime()))].sort((a, b) => a - b).map(t => new Date(t));
    function move(ev) {
      const b = svg.getBoundingClientRect(), sx = W / b.width;
      const mx = (ev.clientX - b.left) * sx - m.l;
      let day = days[0], best = Infinity;
      days.forEach(d => { const dd = Math.abs(x(d) - mx); if (dd < best) { best = dd; day = d; } });
      const px = x(day);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      let html = `<div class="dt">${DAY[day.getUTCDay()]} ${fLong(day)}</div>`, topY = ih;
      ks.forEach((k, i) => {
        const r = asOf(drawn[k].rows, day);
        if (!r) { dots[i].setAttribute('visibility', 'hidden'); return; }
        const cy = y(r[dir]); topY = Math.min(topY, cy);
        dots[i].setAttribute('cx', x(r.date)); dots[i].setAttribute('cy', cy); dots[i].setAttribute('visibility', 'visible');
        const stale = r.date.getTime() !== day.getTime() ? ` <span style="color:var(--muted)">(${fShort(r.date)})</span>` : '';
        html += ks.length > 1
          ? `<div class="row"><span class="k" style="background:${S[k].color}"></span><span class="nm">${S[k].name}${stale}</span><span class="v">${D.sym}${fmt(r[dir])}</span></div>`
          : `<div><span class="v">${D.sym}${fmt(r[dir])}</span> ${D.short}</div>`;
        if (ks.length === 1) {
          const i2 = drawn[k].rows.indexOf(r), prev = drawn[k].rows[i2 - 1];
          if (prev) { const ch = (r[dir] / prev[dir] - 1) * 100; html += `<div style="color:var(--ink-2)">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% on the previous rate</div>`; }
        }
      });
      tip.innerHTML = html; tip.hidden = false;
      const rb = root.getBoundingClientRect(), hb = holder.getBoundingClientRect();
      let left = hb.left - rb.left + (px + m.l) / sx + 14;
      if (left + 200 > rb.width) left -= 220;
      tip.style.left = left + 'px';
      tip.style.top = (hb.top - rb.top + (topY + m.t) / sx - 20) + 'px';
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => {
      tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden'));
    });
  }

  draw(true);
  let lastW = holder.clientWidth;
  new ResizeObserver(() => { if (holder.clientWidth !== lastW) { lastW = holder.clientWidth; draw(false); } }).observe(holder);
})();
