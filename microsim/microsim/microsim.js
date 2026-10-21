
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('microsim.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const tip = $('.tooltip');
  $('.source').textContent = D.SOURCE;

  // ------------------------------------------------------------ the model
  const {T0, T1, POP, SILER, K, ASFR, REL, WREL, ADULT, ADULTYRS, GDPPC0, LFP0, U0, ALPHA, DELTA} = D;
  const SHAPE = a => a < 15 ? 0 : a < 20 ? 0.45 : a < 25 ? 0.85 : a < 55 ? 1 : a < 60 ? 0.88 : a < 65 ? 0.7 : a < 70 ? 0.45 : 0.2;
  const hcap = s => Math.exp(0.134 * Math.min(s, 4) + 0.101 * Math.min(Math.max(s - 4, 0), 4) + 0.068 * Math.max(s - 8, 0));
  const lvl = s => s === 0 ? 0 : s <= 6 ? 1 : s <= 12 ? 2 : 3;
  const MIGW = a => a < 15 ? 0.7 : a < 40 ? 2 : 0.4;
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  const interp = (pts, t) => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (t - a) / (b - a); } return pts[pts.length - 1][1]; };
  const TP = D.TFR, [ya, va] = TP[TP.length - 2], [yb, vb] = TP[TP.length - 1];
  const tfrWB = t => t <= yb ? interp(TP, t) : vb * Math.pow(vb / va, (t - yb) / (yb - ya));
  const TFR75WB = tfrWB(T1);
  const QT = {};
  function qtable(sex, t) {
    const key = sex + t; if (QT[key]) return QT[key];
    const [a1, b1, a2, a3, b3] = SILER[sex], k = K[sex][Math.min(t, T1) - T0];
    const mu = x => k * (a1 * Math.exp(-b1 * x) + a2 + a3 * Math.exp(b3 * x));
    const q = [];
    for (let x = 0; x <= 110; x++) { let H = 0; for (let j = 0; j < 20; j++) H += mu(x + (j + 0.5) / 20) / 20; q.push(1 - Math.exp(-H)); }
    return (QT[key] = q);
  }
  const enterRate = (sex, t) => interp(D.SCHOOL[sex].enter, t);
  function schoolRates(sex, t, P) {
    const S = D.SCHOOL[sex];
    if (sex === 'M') return {enter: enterRate('M', t), prim: S.prim, trans: S.trans, sec: S.sec, uni: S.uni, ter: S.ter, banned: false};
    const banSec = t >= D.BAN.secondary && t < P.reopen, banUni = t >= D.BAN.university && t < P.reopen;
    return {enter: enterRate('F', t), prim: S.prim, trans: banSec ? 0 : S.trans, sec: banSec ? 0 : S.sec, uni: banUni ? 0 : S.uni, ter: banUni ? 0 : S.ter, banned: banSec};
  }
  function schoolStep(p, t, P, r) {
    if (p.age < 7 || p.age > 24) { p.enr = false; return; }
    const R = schoolRates(p.sex, t, P);
    if (p.age === 7 && !p.started) { p.started = true; if (r() < R.enter) { p.s = 1; p.enr = true; } return; }
    if (p.blocked && !R.banned && p.age <= 20 && !p.retried) { p.retried = true; p.blocked = false; if (r() < 0.5) p.enr = true; else return; }
    if (!p.enr || p.s >= 16) return;
    const pr = p.s < 6 ? R.prim : p.s === 6 ? R.trans : p.s < 12 ? R.sec : p.s === 12 ? R.uni : R.ter;
    if (r() < pr) p.s++;
    else { p.enr = false; if (p.sex === 'F' && R.banned && p.s >= 6 && p.s < 12) p.blocked = true; }
  }
  function run(P, opts = {}) {
    const r = rng(opts.seed || 12345), N0 = opts.n || 20000;
    const total = d3.sum(POP.F) + d3.sum(POP.M), W = total / N0;
    let people = [];
    for (const sex of ['F', 'M']) POP[sex].forEach((cnt, g) => {
      const ages = g < 16 ? [0, 1, 2, 3, 4].map(i => 5 * g + i) : [80, 81, 82, 83, 84, 85, 86, 87, 88, 89];
      const wts = g < 16 ? [1, 1, 1, 1, 1] : ages.map((_, i) => Math.pow(0.8, i)), sw = d3.sum(wts);
      ages.forEach((age, i) => {
        const x = cnt * wts[i] / sw / W; let n = Math.floor(x); if (r() < x - n) n++;
        for (let j = 0; j < n; j++) people.push({sex, age, s: 0, enr: false, started: age > 7});
      });
    });
    for (const p of people) {
      if (p.age >= 24) {
        const gi = Math.min(7, Math.floor((p.age - 9 - 15) / 5)), row = ADULT[p.sex][gi];
        let u = r() * d3.sum(row), c = 0;
        while (c < 5 && u > row[c]) { u -= row[c]; c++; }
        p.s = ADULTYRS[c];
      } else if (p.age >= 7) {
        const birth = T0 - p.age, real = p.age; p.started = false;
        for (let a = 7; a <= real; a++) { p.age = a; schoolStep(p, birth + a, P, r); }
        p.age = real;
      }
    }
    const asum = d3.sum(ASFR), phi = a => (a < 15 || a > 49) ? 0 : ASFR[Math.floor((a - 15) / 5)] / 5 / asum;
    const relS = new Array(50).fill(0), relN = new Array(50).fill(0);
    for (const p of people) if (p.sex === 'F' && p.age >= 15 && p.age <= 49) { relS[p.age] += REL[lvl(p.s)]; relN[p.age]++; }
    let num = 0, den = 0;
    for (let a = 15; a <= 49; a++) if (relN[a]) { num += phi(a) * relS[a] / relN[a]; den += phi(a); }
    const tfr0 = tfrWB(T0), tfrNoEdu0 = tfr0 / (num / den);
    const tfrPath = t => tfrWB(t) * Math.pow(P.tfr75 / TFR75WB, (t - T0) / (T1 - T0));
    const flfp = t => t >= 2050 ? P.flfp50 : t <= 2025 ? LFP0.F : LFP0.F + (P.flfp50 - LFP0.F) * (t - 2025) / 25;
    const migW0 = d3.mean(people, p => MIGW(p.age));
    const out = [], snaps = {}, bA = new Array(50).fill(0), wA = new Array(50).fill(0), Hs = {}, pops = {};
    let Kc, A, Yprev, A25, K25;
    for (let t = T0; t <= T1; t++) {
      if (t > T0) {
        const qF = qtable('F', t), qM = qtable('M', t), born = [], scale = tfrNoEdu0 * tfrPath(t) / tfr0;
        const mig = t > 2025 ? D.MIG / 1000 * Math.max(0, (T1 - t) / (T1 - 2026)) : 0;
        bA.fill(0); wA.fill(0);
        for (const p of people) {
          if (p.dead) continue;
          if (p.age >= 110 || r() < (p.sex === 'F' ? qF : qM)[Math.min(p.age, 110)]) { p.dead = true; continue; }
          if (mig < 0 && r() < -mig * MIGW(p.age) / migW0) { p.dead = true; continue; }
          if (p.sex === 'F' && p.age >= 15 && p.age <= 49) {
            const pb = scale * phi(p.age) * REL[lvl(p.s)]; wA[p.age]++; bA[p.age] += pb;
            if (r() < pb) born.push({sex: r() < 1.05 / 2.05 ? 'M' : 'F', age: 0, s: 0, enr: false, started: false});
          }
          p.age++;
          schoolStep(p, t, P, r);
        }
        if (t === 2025) {
          const live = people.filter(p => !p.dead), n = Math.round(D.RETURNS25 / W);
          for (let i = 0; i < n; i++) people.push({...live[Math.floor(r() * live.length)]});
        }
        for (const b of born) people.push(b);
        if (t % 5 === 0) people = people.filter(p => !p.dead);
      }
      const alive = people.filter(p => !p.dead), pop = alive.length * W;
      let lfF = 0, lfM = 0, n15F = 0, n15M = 0, wsF = 0, wsM = 0, H = 0;
      const sumS = {F: 0, M: 0}, n25 = {F: 0, M: 0};
      for (const p of alive) {
        if (p.age >= 25) { sumS[p.sex] += p.s; n25[p.sex]++; }
        if (p.age < 15) continue;
        if (p.sex === 'F') { n15F++; wsF += SHAPE(p.age) * WREL[lvl(p.s)]; } else { n15M++; wsM += SHAPE(p.age); }
      }
      const levF = flfp(t) / 100 * n15F / wsF, levM = LFP0.M / 100 * n15M / wsM;
      for (const p of alive) {
        if (p.age < 15) continue;
        const pr = Math.min(0.98, p.sex === 'F' ? levF * SHAPE(p.age) * WREL[lvl(p.s)] : levM * SHAPE(p.age));
        if (p.sex === 'F') lfF += pr; else lfM += pr;
        H += pr * (1 - U0) * hcap(p.s);
      }
      H *= W; Hs[t] = H; pops[t] = pop;
      let Y;
      if (t === T0) { Y = GDPPC0 * pop; Kc = D.KY0 * Y; A = Y / (Math.pow(Kc, ALPHA) * Math.pow(H, 1 - ALPHA)); }
      else {
        Kc = (1 - DELTA) * Kc + P.inv / 100 * Yprev;
        if (t === 2025) { Y = Yprev * (1 + D.GROWTH25); A = Y / (Math.pow(Kc, ALPHA) * Math.pow(H, 1 - ALPHA)); A25 = A; K25 = Kc; }
        else { A *= 1 + P.tfp / 100; Y = A * Math.pow(Kc, ALPHA) * Math.pow(H, 1 - ALPHA); }
      }
      out.push({t, pop, gdp: Y, gdppc: Y / pop, emp100: 100 * (lfF + lfM) * (1 - U0) / alive.length,
        yrsF: sumS.F / n25.F, yrsM: sumS.M / n25.M, flfp: 100 * lfF / n15F,
        tfr: t === T0 ? tfr0 : bA.reduce((z, b, a) => z + (wA[a] ? b / wA[a] : 0), 0)});
      Yprev = Y;
      if (opts.snaps) {
        const sn = {F: [], M: []};
        for (const sx of ['F', 'M']) for (let g = 0; g < 17; g++) sn[sx].push([0, 0, 0, 0, 0]);
        for (const p of alive) sn[p.sex][Math.min(16, Math.floor(p.age / 5))][p.age < 7 && p.s === 0 ? 4 : lvl(p.s)] += W;
        snaps[t] = sn;
      }
    }
    const rb = rng(777), Dn = opts.band || 200, paths = [], r25 = out[1];
    for (let d = 0; d < Dn; d++) {
      let k = K25, a = A25, yprev = r25.gdp; const path = [];
      for (let t = 2026; t <= T1; t++) {
        k = (1 - DELTA) * k + P.inv / 100 * yprev;
        a *= (1 + P.tfp / 100) * Math.exp(D.SIGP * gauss(rb) - D.SIGP * D.SIGP / 2);
        const y = a * Math.exp(D.SIGT * gauss(rb) - D.SIGT * D.SIGT / 2) * Math.pow(k, ALPHA) * Math.pow(Hs[t], 1 - ALPHA);
        path.push(y / pops[t]); yprev = y;
      }
      paths.push(path);
    }
    const band = [];
    for (let i = 0; i <= T1 - 2026; i++) {
      const v = paths.map(p => p[i]).sort((x, y) => x - y), q = f => v[Math.floor(f * (Dn - 1))];
      band.push({t: 2026 + i, lo: q(0.1), hi: q(0.9)});
    }
    return {rows: out, snaps, band};
  }

  // ------------------------------------------------------------ the page
  const PRE = D.PRESETS, NAME = {sq: 'Status quo', reform: 'Reform', crisis: 'Crisis', custom: 'Your settings'};
  const COL = {sq: '#2a78d6', reform: '#1baf7a', crisis: '#eb6834', custom: '#4a3aa7'}, GREY = '#898781';
  const EDC = ['#d3d1c7', '#9fe1cb', '#1d9e75', '#085041', '#f1efe8'], EDN = ['No schooling', 'Primary', 'Secondary', 'Higher', 'Under 7'];
  const money = v => '$' + d3.format(',.0f')(v), ids = ['flfp50', 'tfp', 'inv', 'tfr75'];
  const fmt = {flfp50: v => v + '%', tfp: v => (v > 0 ? '+' : '') + (+v).toFixed(1) + '%', inv: v => v + '%', tfr75: v => (+v).toFixed(1)};
  let P = {...PRE.sq}, key = 'sq', year = T1, timer = null, X, Y, deb, runs = {}, cur, H25;

  await new Promise(r => setTimeout(r, 30));          // let the page paint before the first runs
  for (const k of Object.keys(PRE)) runs[k] = run(PRE[k], {snaps: k === 'sq'});
  cur = runs.sq; H25 = cur.rows[1].gdppc;

  function syncInputs() {
    $('#reopen').value = String(P.reopen);
    ids.forEach(id => { $('#' + id).value = P[id]; $('#' + id + 'o').textContent = fmt[id](P[id]); });
    root.querySelectorAll('.pills button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === key));
    $('.custom').textContent = key === 'custom' ? 'Your settings' : '';
  }
  const matchPreset = () => { for (const k in PRE) if (Object.keys(PRE[k]).every(f => +PRE[k][f] === +P[f])) return k; return 'custom'; };
  function recompute() {
    key = matchPreset(); syncInputs(); clearTimeout(deb);
    deb = setTimeout(() => {
      if (!(runs[key] && runs[key].snaps[T0])) { cur = run(P, {snaps: true}); if (PRE[key]) runs[key] = cur; }
      else cur = runs[key];
      draw();
    }, 120);
  }
  root.querySelectorAll('.pills button').forEach(b => b.addEventListener('click', () => { P = {...PRE[b.dataset.p]}; recompute(); }));
  $('#reopen').addEventListener('change', e => { P.reopen = +e.target.value; recompute(); });
  ids.forEach(id => $('#' + id).addEventListener('input', e => { P[id] = +e.target.value; $('#' + id + 'o').textContent = fmt[id](P[id]); recompute(); }));
  $('#year').addEventListener('input', e => { year = +e.target.value; drawYear(); });
  $('#play').addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; $('#play').textContent = '▶'; return; }
    if (year >= T1) year = T0;
    $('#play').textContent = '❚❚';
    timer = setInterval(() => { year++; $('#year').value = year; drawYear(); if (year >= T1) $('#play').click(); }, 140);
  });

  function stats() {
    const r = cur.rows, a = r[0], z = r[r.length - 1], b = cur.band[cur.band.length - 1];
    const cagr = 100 * (Math.pow(z.gdppc / a.gdppc, 1 / (z.t - a.t)) - 1);
    $('.stats').innerHTML = [
      ['GDP per person, 2075', money(z.gdppc), 'likely range ' + money(b.lo) + ' to ' + money(b.hi)],
      ['Growth per person', (cagr >= 0 ? '+' : '') + cagr.toFixed(1) + '%', 'a year, from ' + money(a.gdppc) + ' in 2024'],
      ['Population, 2075', (z.pop / 1e6).toFixed(0) + 'm', 'from ' + (a.pop / 1e6).toFixed(1) + 'm in 2024'],
      ['Size of the economy, 2075', '$' + (z.gdp / 1e9).toFixed(0) + 'bn', (z.gdp / a.gdp).toFixed(1) + ' times its 2024 size ($' + (a.gdp / 1e9).toFixed(0) + 'bn)']
    ].map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
  }

  function drawMain() {
    const el = $('#main'); el.innerHTML = '';
    const width = el.clientWidth || 800, narrow = width < 560, height = Math.max(260, Math.min(380, width * 0.42));
    const m = {t: 12, r: narrow ? 50 : 56, b: 26, l: 48}, iw = width - m.l - m.r, ih = height - m.t - m.b;
    const lines = Object.keys(PRE).map(k => ({k, rows: runs[k].rows}));
    if (key === 'custom') lines.push({k: 'custom', rows: cur.rows});
    const ymax = d3.max(lines.flatMap(l => l.rows.map(r => r.gdppc)).concat([D.LIC * 1.1], cur.band.map(b => b.hi)));
    X = d3.scaleLinear([2000, T1], [0, iw]); Y = d3.scaleLinear([0, ymax], [ih, 0]).nice();
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(Y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(Y).ticks(5).tickSize(0).tickPadding(6).tickFormat(v => '$' + d3.format(',')(v))).call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(X).ticks(narrow ? 4 : 8).tickFormat(d3.format('d')).tickSizeOuter(0));
    g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', Y(D.LIC)).attr('y2', Y(D.LIC)).attr('stroke', GREY).attr('stroke-dasharray', '2 4');
    g.append('text').attr('class', 'lab2').attr('x', 4).attr('y', Y(D.LIC) - 4).text(`Low-income countries, ${T0}`);
    g.append('line').attr('x1', X(T0)).attr('x2', X(T0)).attr('y1', 0).attr('y2', ih).attr('stroke', 'var(--axis)');
    g.append('text').attr('class', 'lab2').attr('x', X(T0) - 4).attr('y', 11).attr('text-anchor', 'end').text('Actual');
    g.append('text').attr('class', 'lab2').attr('x', X(T0) + 4).attr('y', 11).text('Projected');
    const ln = d3.line().x(r => X(r.t)).y(r => Y(r.gdppc));
    g.append('path').datum([{t: 2025, lo: H25, hi: H25}, ...cur.band]).attr('fill', COL[key]).attr('fill-opacity', 0.14)
      .attr('d', d3.area().x(b => X(b.t)).y0(b => Y(b.lo)).y1(b => Y(b.hi)));
    g.append('path').datum(D.HIST.map(([t, v]) => ({t, gdppc: v}))).attr('fill', 'none').attr('stroke', GREY).attr('stroke-width', 2).attr('d', ln);
    g.append('path').datum([{t: T0, gdppc: D.HIST[D.HIST.length - 1][1]}, {t: 2025, gdppc: H25}]).attr('fill', 'none').attr('stroke', GREY).attr('stroke-width', 2).attr('stroke-dasharray', '3 3').attr('d', ln);
    const ends = [];
    lines.forEach(l => {
      const on = l.k === key;
      g.append('path').datum(l.rows).attr('fill', 'none').attr('stroke', COL[l.k]).attr('stroke-width', on ? 2.6 : 1.4)
        .attr('stroke-opacity', on ? 1 : 0.55).attr('stroke-linejoin', 'round').attr('d', ln);
      const z = l.rows[l.rows.length - 1]; ends.push({k: l.k, y: Y(z.gdppc), v: z.gdppc, on});
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => g.append('text').attr('x', iw + 5).attr('y', e.y + 4).style('fill', COL[e.k]).style('font-size', narrow ? '11px' : '12px').style('font-weight', e.on ? 650 : 400).text(money(e.v)));
    g.append('line').attr('id', 'ym').attr('y1', 0).attr('y2', ih).attr('stroke', 'var(--ink-2)');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => tip.hidden = true)
      .on('click', e => { const t = Math.round(X.invert(d3.pointer(e, g.node())[0])); if (t >= T0) { year = Math.min(T1, t); $('#year').value = year; drawYear(); } })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), t = Math.max(2000, Math.min(T1, Math.round(X.invert(mx))));
        let html = `<div class="dt">${t}</div>`;
        if (t <= T0) { const h = D.HIST.find(x => x[0] === t); html += `<div class="row"><span class="nm">Actual</span><span class="vv">${h ? money(h[1]) : 'n/a'}</span></div>`; }
        else if (t === 2025) html += `<div class="row"><span class="nm">World Bank estimate</span><span class="vv">${money(H25)}</span></div><div class="note">GDP up 4.8%; population up about 11% with 3.7 million returnees</div>`;
        else {
          lines.forEach(l => { const r = l.rows.find(x => x.t === t); html += `<div class="row"><span class="kk" style="background:${COL[l.k]}"></span><span class="nm">${NAME[l.k]}</span><span class="vv">${money(r.gdppc)}</span></div>`; });
          const bb = cur.band.find(x => x.t === t); html += `<div class="note">${NAME[key]}: likely range ${money(bb.lo)} to ${money(bb.hi)}</div>`;
        }
        tip.innerHTML = html + '<div class="note">GDP per person, US$ at 2015 prices</div>';
        tip.hidden = false;
        const box = root.getBoundingClientRect(), hb = el.getBoundingClientRect(), sc = hb.width / width;
        const px = (m.l + X(t)) * sc + hb.left - box.left, tw = tip.offsetWidth;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (hb.top - box.top + 20) + 'px';
      });
    $('#leg').innerHTML = `<span><i class="sw" style="background:${GREY}"></i>Actual</span>` +
      lines.map(l => `<span><i class="sw" style="background:${COL[l.k]}"></i>${NAME[l.k]}</span>`).join('') +
      `<span><i class="sq" style="background:${COL[key]};opacity:.3"></i>Likely range (8 in 10 runs)</span>`;
  }

  const SP = [
    {k: 'Population', f: r => r.pop / 1e6, v: v => v.toFixed(0) + 'm', wb: D.WBPOP},
    {k: 'Births per woman', f: r => r.tfr, v: v => v.toFixed(1), wb: D.WBTFR},
    {k: 'People in work per 100 people', f: r => r.emp100, v: v => v.toFixed(0)},
    {k: 'Years of schooling, adults 25+', f: r => r.yrsF, f2: r => r.yrsM, v: (v, v2) => `women ${v.toFixed(1)}, men ${v2.toFixed(1)}`}
  ];
  function drawSparks() {
    const el = $('#sparks'); el.innerHTML = '';
    const width = el.clientWidth || 320, h = 56;
    SP.forEach((s, i) => {
      const d = document.createElement('div'); d.className = 'spark';
      d.innerHTML = `<div class="k"><span>${s.k}</span><b id="sv${i}"></b></div>`; el.appendChild(d);
      const x = d3.scaleLinear([T0, T1], [2, width - 4]);
      const vals = cur.rows.map(s.f).concat(s.f2 ? cur.rows.map(s.f2) : []).concat(s.wb ? s.wb.map(w => w[1]) : []);
      const y = d3.scaleLinear([Math.min(0, d3.min(vals)), d3.max(vals) * 1.08], [h - 3, 3]);
      const svg = d3.select(d).append('svg').attr('viewBox', [0, 0, width, h]);
      if (s.wb) svg.append('path').datum(s.wb).attr('fill', 'none').attr('stroke', GREY).attr('stroke-dasharray', '3 3').attr('d', d3.line().x(w => x(w[0])).y(w => y(w[1])));
      svg.append('path').datum(cur.rows).attr('fill', 'none').attr('stroke', COL[key]).attr('stroke-width', 2).attr('d', d3.line().x(r => x(r.t)).y(r => y(s.f(r))));
      if (s.f2) svg.append('path').datum(cur.rows).attr('fill', 'none').attr('stroke', COL[key]).attr('stroke-width', 1.4).attr('stroke-dasharray', '4 3').attr('d', d3.line().x(r => x(r.t)).y(r => y(s.f2(r))));
      svg.append('line').attr('class', 'sm').attr('y1', 0).attr('y2', h).attr('stroke', 'var(--ink-2)');
      s.x = x; s.svg = svg;
    });
    el.insertAdjacentHTML('beforeend', `<div class="legend"><span><i class="sw" style="background:${GREY}"></i>World Bank projection, made before the 2025 returns</span><span>Schooling: women solid, men dashed</span></div>`);
  }

  function drawPyr() {
    const el = $('#pyr'); el.innerHTML = '';
    const sn = cur.snaps[year], width = el.clientWidth || 360, h = 240, mid = width / 2, bh = h / 17;
    const max = d3.max(Object.values(cur.snaps).flatMap(s => ['F', 'M'].flatMap(x => s[x].map(g => d3.sum(g)))));
    const x = d3.scaleLinear([0, max], [0, mid - 22]);
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, h + 16]).attr('role', 'img').attr('aria-label', `Population pyramid for ${year} by sex, age group and schooling`);
    for (let gi = 0; gi < 17; gi++) {
      const yy = h - (gi + 1) * bh;
      for (const sx of ['F', 'M']) {
        let acc = 0;
        for (const c of [4, 0, 1, 2, 3]) {
          const w = x(sn[sx][gi][c]);
          svg.append('rect').attr('x', sx === 'M' ? mid - 18 - acc - w : mid + 18 + acc).attr('y', yy + 0.5).attr('width', Math.max(0, w)).attr('height', bh - 1).attr('fill', EDC[c]);
          acc += w;
        }
      }
      if (gi % 2 === 0) svg.append('text').attr('x', mid).attr('y', yy + bh - 2).attr('text-anchor', 'middle').style('font-size', '11px').text(gi < 16 ? 5 * gi : '80+');
    }
    svg.append('text').attr('x', 2).attr('y', h + 13).text('Men');
    svg.append('text').attr('x', width - 2).attr('y', h + 13).attr('text-anchor', 'end').text('Women');
    $('#pleg').innerHTML = [4, 0, 1, 2, 3].map(c => `<span><i class="sq" style="background:${EDC[c]}"></i>${EDN[c]}</span>`).join('');
  }

  function drawYear() {
    $('#yearo').textContent = year; $('#pyy').textContent = year;
    d3.select(root).select('#ym').attr('x1', X(year)).attr('x2', X(year));
    const r = cur.rows.find(x => x.t === year);
    SP.forEach((s, i) => { $('#sv' + i).textContent = s.v(s.f(r), s.f2 && s.f2(r)); s.svg.select('.sm').attr('x1', s.x(year)).attr('x2', s.x(year)); });
    drawPyr();
  }
  function draw() { stats(); drawMain(); drawSparks(); drawYear(); }
  syncInputs(); draw();
  let lw = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lw) < 2) return; lw = root.clientWidth; clearTimeout(window.__rz); window.__rz = setTimeout(draw, 120); }).observe(root);

  if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed'); document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'microsim.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
