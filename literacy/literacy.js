
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('literacy.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const tip = $('.tooltip');
  $('.source').textContent = D.SOURCE;

  // ------------------------------------------------------------ the model
  const {T0, T1} = D;
  const UN = Object.keys(D.U), GN = ['rest', 'fata', 'bal'], GR = u => GN[D.U[u].f];
  const US = {rest: UN.filter(u => GR(u) === 'rest'), fata: UN.filter(u => GR(u) === 'fata'), bal: UN.filter(u => GR(u) === 'bal')};
  const BR = [[0, 4], [5, 9], [10, 12], [13, 14], [15, 24], [25, 40], [41, 60], [61, 85]];
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const interp = (pts, t) => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (t - a) / (b - a); } return pts[pts.length - 1][1]; };
  const TP = D.TFRPAK, [ya, va] = TP[TP.length - 2], [yb, vb] = TP[TP.length - 1];
  const tfrPak = t => t <= yb ? interp(TP, t) : vb * Math.pow(vb / va, (t - yb) / (yb - ya));
  const QT = {};
  function qtable(sex, t) {
    const key = sex + t; if (QT[key]) return QT[key];
    const [a1, b1, a2, a3, b3] = D.SILER[sex], k = D.K[sex][Math.min(t, T1) - T0];
    const mu = x => k * (a1 * Math.exp(-b1 * x) + a2 + a3 * Math.exp(b3 * x)), q = [];
    for (let x = 0; x <= 110; x++) { let H = 0; for (let j = 0; j < 20; j++) H += mu(x + (j + 0.5) / 20) / 20; q.push(1 - Math.exp(-H)); }
    return (QT[key] = q);
  }
  const asum = d3.sum(D.ASFR), phi = a => (a < 15 || a > 49) ? 0 : D.ASFR[Math.floor((a - 15) / 5)] / 5 / asum;
  // literacy pooled over areas for one age group (1 = 13-14, 2 = 15-24, 3 = 25-40)
  const pooled = (us, s, i) => d3.sum(us, u => D.U[u][s][1][i]) / d3.sum(us, u => D.U[u][s][0][i + 2]);
  // current trends: share of the remaining gap to full literacy closed per year of birth, 15-24 against 25-40
  const pace = (us, s) => { const a = pooled(us, s, 2), b = pooled(us, s, 3); return a > b ? 1 - Math.pow((1 - a) / (1 - b), 1 / D.PACEYEARS) : 0; };
  const PACE = {}; for (const g of GN) PACE[g] = {F: pace(US[g], 'F'), M: pace(US[g], 'M')};
  const BENCH0 = {F: pooled(US.rest, 'F', 1), M: pooled(US.rest, 'M', 1)};

  function run(P) {
    const people = [], W = {}, RG = {};
    UN.forEach((u, k) => RG[u] = rng(2023 + 7919 * k));       // each area has its own random numbers
    for (const u of UN) {
      W[u] = (d3.sum(D.U[u].F[0]) + d3.sum(D.U[u].M[0])) / D.N;
      const r = RG[u];
      for (const s of ['F', 'M']) {
        const [pop, lit] = D.U[u][s];
        pop.forEach((cnt, b) => {
          const x = cnt / W[u]; let n = Math.floor(x); if (r() < x - n) n++;
          const [lo, hi] = BR[b], k = Math.round((b >= 2 ? lit[b - 2] / Math.max(1, cnt) : 0) * n);
          for (let j = 0; j < n; j++) {
            const age = b === 7 ? 61 + Math.floor(-Math.log(1 - r() * 0.95) * 8) % 25 : lo + Math.floor(r() * (hi - lo + 1));
            people.push({u, s, age, lit: j < k});
          }
        });
      }
    }
    // births scaled so each area starts at its region's births per woman
    const norm = {};
    for (const u of UN) { let a = 0, n = 0; for (const p of people) if (p.u === u && p.s === 'F' && p.age >= 15 && p.age <= 49) { a += phi(p.age) * (p.lit ? D.RELLIT : 1); n += phi(p.age); } norm[u] = n / a; }
    // chance that a child in each area can read by age 10: starts at the census figure for 13-14 year olds
    const L = {}; for (const u of UN) L[u] = {F: D.U[u].F[1][1] / D.U[u].F[0][3], M: D.U[u].M[1][1] / D.U[u].M[0][3]};
    const bench = {...BENCH0}, out = {};
    for (const u of UN) out[u] = {F: [], M: []};
    for (let t = T0; t <= T1; t++) {
      if (t > T0) {
        for (const s of ['F', 'M']) bench[s] += PACE.rest[s] * (1 - bench[s]);
        for (const u of UN) for (const s of ['F', 'M']) {
          const g = GR(u);
          L[u][s] += PACE[g][s] * (1 - L[u][s]);
          if (g !== 'rest' && (P.who === 'both' || P.who === g) && t >= P.start) L[u][s] += (P.speed / 100) * (s === 'F' ? P.girls : 1) * Math.max(0, bench[s] - L[u][s]);
          L[u][s] = Math.min(0.995, L[u][s]);
        }
        const qF = qtable('F', t), qM = qtable('M', t), born = [], tp = tfrPak(t) / D.TFRREG.pak;
        for (const p of people) {
          if (p.dead) continue;
          const r = RG[p.u];
          if (p.age >= 100 || r() < (p.s === 'F' ? qF : qM)[p.age]) { p.dead = true; continue; }
          if (p.s === 'F' && p.age >= 15 && p.age <= 49 && r() < D.TFRREG[GR(p.u)] * tp * phi(p.age) * (p.lit ? D.RELLIT : 1) * norm[p.u])
            born.push({u: p.u, s: r() < 1.05 / 2.05 ? 'M' : 'F', age: 0, lit: false});
          p.age++;
          if (p.age === D.AGELIT && !p.lit) p.lit = r() < L[p.u][p.s];
        }
        for (const b of born) people.push(b);
        if (t % 5 === 0) { let j = 0; for (const p of people) if (!p.dead) people[j++] = p; people.length = j; }
      }
      const acc = {}; for (const u of UN) acc[u] = {F: [0, 0], M: [0, 0]};
      for (const p of people) if (!p.dead && p.age >= 10) { acc[p.u][p.s][0]++; if (p.lit) acc[p.u][p.s][1]++; }
      for (const u of UN) for (const s of ['F', 'M']) out[u][s].push([acc[u][s][0] * W[u], acc[u][s][1] * W[u]]);
    }
    return out;
  }

  // ------------------------------------------------------------ the page
  const PRE = D.PRESETS, NAME = {sq: 'Current trends', plan: 'Steady catch-up', fast: 'Fast catch-up', custom: 'Your settings'};
  const COL = {rest: '#2a78d6', fata: '#eb6834', bal: '#1baf7a'}, GNAME = {rest: 'Rest of KP', fata: 'Former FATA', bal: 'Balochistan'};
  const SEXN = {F: 'women', M: 'men', T: 'everyone'}, yrs = d3.range(T0, T1 + 1);
  let P = {...PRE.sq, who: 'both'}, key = 'sq', sex = 'F', year = T0, timer = null, dg = 'fata', runs = {}, cur, base, deb, X, paths;
  const on = g => P.who === 'both' || P.who === g;
  const pct = v => v.toFixed(0) + '%';
  const val = (res, u, i) => { const o = res[u], g = sex === 'T' ? [o.F[i][0] + o.M[i][0], o.F[i][1] + o.M[i][1]] : o[sex][i]; return 100 * g[1] / g[0]; };
  const grp = (res, us, i) => { let n = 0, l = 0; for (const u of us) for (const s of (sex === 'T' ? ['F', 'M'] : [sex])) { n += res[u][s][i][0]; l += res[u][s][i][1]; } return 100 * l / n; };
  const short = u => u.replace('Dera Ismail Khan', 'D.I. Khan');
  const SEXC = () => SEXN[sex][0].toUpperCase() + SEXN[sex].slice(1);

  await new Promise(r => setTimeout(r, 30));          // let the page paint before the first run
  base = cur = runs.sqboth = run(P);

  function syncInputs() {
    ['speed', 'girls', 'start', 'who'].forEach(id => $('#' + id).value = P[id]);
    $('#speedo').textContent = P.speed + '%'; $('#girlso').textContent = '×' + (+P.girls).toFixed(1); $('#starto').textContent = P.start;
    root.querySelectorAll('[data-p]').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === key));
    root.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === sex));
    root.querySelectorAll('[data-d]').forEach(b => b.setAttribute('aria-pressed', b.dataset.d === dg));
    $('.custom').textContent = key === 'custom' ? 'Your settings' : '';
  }
  const matchPreset = () => { for (const k in PRE) if (['speed', 'girls', 'start'].every(f => +PRE[k][f] === +P[f])) return k; return 'custom'; };
  function recompute() {
    key = matchPreset(); syncInputs(); clearTimeout(deb);
    deb = setTimeout(() => {
      const id = key + P.who;
      cur = key === 'sq' ? base : (runs[id] || run(P));
      if (key !== 'custom') runs[id] = cur;
      draw();
    }, 120);
  }
  root.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { P = {...PRE[b.dataset.p], who: P.who}; recompute(); }));
  root.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { sex = b.dataset.s; syncInputs(); draw(); }));
  root.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => { dg = b.dataset.d; syncInputs(); drawYear(); }));
  ['speed', 'girls', 'start'].forEach(id => $('#' + id).addEventListener('input', e => { P[id] = +e.target.value; recompute(); }));
  $('#who').addEventListener('change', e => { P.who = e.target.value; recompute(); });
  $('#year').addEventListener('input', e => { year = +e.target.value; drawYear(); });
  $('#play').addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; $('#play').textContent = '▶'; return; }
    if (year >= T1) year = T0;
    $('#play').textContent = '❚❚';
    timer = setInterval(() => { year++; $('#year').value = year; drawYear(); if (year >= T1) $('#play').click(); }, 150);
  });

  function stats() {
    const gap = (res, g, i) => grp(res, US.rest, i) - grp(res, US[g], i);
    $('.stats').innerHTML = ['fata', 'bal'].flatMap(g => [2050, T1].map(y => [
      `${GNAME[g]}: gap with rest of KP, ${y}`, gap(cur, g, y - T0).toFixed(0) + ' points',
      `${SEXC()}; ${gap(cur, g, 0).toFixed(0)} points in ${T0}` + (key === 'sq' ? '' : `; ${gap(base, g, y - T0).toFixed(0)} on current trends`)]))
      .map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
  }

  const color = d3.scaleSequential(d3.interpolateBlues).domain([0, 100]);
  function drawMap() {
    const el = $('#map'); el.innerHTML = '';
    const w = el.clientWidth || 360, h = w * 1.02, gp = d3.geoPath(d3.geoMercator().fitSize([w, h], D.GEO));
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, w, h]);
    paths = svg.append('g').selectAll('path').data(D.GEO.features).join('path').attr('d', gp)
      .attr('stroke', '#fff').attr('stroke-width', 0.5)
      .on('pointermove', (e, f) => {
        const u = f.properties.n, i = year - T0;
        tip.innerHTML = `<div class="dt">${u}</div><div class="note">${GR(u) === 'rest' ? 'Khyber Pakhtunkhwa' : GNAME[GR(u)]}</div>` +
          `<div>${SEXC()} aged 10+ who can read, ${year}: <b>${pct(val(cur, u, i))}</b></div>` +
          (year > T0 ? `<div class="note">${T0}: ${pct(val(cur, u, 0))}</div>` : '');
        tip.hidden = false;
        const box = root.getBoundingClientRect(), tw = tip.offsetWidth, px = e.clientX - box.left;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (e.clientY - box.top + 14) + 'px';
      }).on('pointerleave', () => tip.hidden = true);
    for (const [g, sw, da] of [['bal', 1, '3 2'], ['fata', 1.5, null]])
      svg.append('path').datum({type: 'FeatureCollection', features: D.GEO.features.filter(f => GR(f.properties.n) === g)}).attr('d', gp)
        .attr('fill', 'none').attr('stroke', '#0b0b0b').attr('stroke-width', sw).attr('stroke-dasharray', da).attr('pointer-events', 'none');
    $('#mleg').innerHTML = [0, 25, 50, 75, 100].map(v => `<span><i class="sq" style="background:${color(v)}"></i>${v}%</span>`).join('') +
      '<span><i class="sw" style="background:#0b0b0b;height:2px"></i>Former FATA</span><span><i class="dash" style="border-color:#0b0b0b"></i>Balochistan</span>';
  }

  function drawLine() {
    const el = $('#line'); el.innerHTML = '';
    const w = el.clientWidth || 360, h = 240, m = {t: 10, r: 40, b: 24, l: 38}, iw = w - m.l - m.r, ih = h - m.t - m.b;
    X = d3.scaleLinear([T0, T1], [0, iw]); const Y = d3.scaleLinear([0, 100], [ih, 0]);
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, w, h]), g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(Y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(Y).ticks(5).tickSize(0).tickPadding(6).tickFormat(v => v + '%')).call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(X).ticks(w < 420 ? 4 : 6).tickFormat(d3.format('d')).tickSizeOuter(0));
    const ln = d3.line().x((v, i) => X(T0 + i)).y(v => Y(v)), ser = (res, gg) => yrs.map((y, i) => grp(res, US[gg], i));
    const dashed = key !== 'sq' ? ['fata', 'bal'].filter(on) : [];
    dashed.forEach(gg => g.append('path').datum(ser(base, gg)).attr('fill', 'none').attr('stroke', COL[gg]).attr('stroke-width', 1.4).attr('stroke-dasharray', '4 3').attr('stroke-opacity', 0.75).attr('d', ln));
    const S = {}, ends = GN.map(gg => { S[gg] = ser(cur, gg); g.append('path').datum(S[gg]).attr('fill', 'none').attr('stroke', COL[gg]).attr('stroke-width', 2.4).attr('stroke-linejoin', 'round').attr('d', ln); return {gg, v: S[gg][T1 - T0], y: Y(S[gg][T1 - T0]) + 4}; }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => g.append('text').attr('x', iw + 5).attr('y', e.y).style('fill', COL[e.gg]).style('font-weight', 600).text(pct(e.v)));
    g.append('line').attr('id', 'lm').attr('y1', 0).attr('y2', ih).attr('stroke', 'var(--ink-2)');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => tip.hidden = true)
      .on('click', e => { year = Math.max(T0, Math.min(T1, Math.round(X.invert(d3.pointer(e, g.node())[0])))); $('#year').value = year; drawYear(); })
      .on('pointermove', e => {
        const t = Math.max(T0, Math.min(T1, Math.round(X.invert(d3.pointer(e, g.node())[0])))), i = t - T0;
        tip.innerHTML = `<div class="dt">${t}</div>` + GN.map(gg => `<div><span style="color:${COL[gg]}">●</span> ${GNAME[gg]}: <b>${pct(S[gg][i])}</b>` +
          (dashed.includes(gg) ? ` <span class="note">(current trends ${pct(ser(base, gg)[i])})</span>` : '') + '</div>').join('') +
          `<div class="note">${SEXC()} aged 10+ who can read</div>`;
        tip.hidden = false;
        const box = root.getBoundingClientRect(), hb = el.getBoundingClientRect(), sc = hb.width / w, px = (m.l + X(t)) * sc + hb.left - box.left, tw = tip.offsetWidth;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (hb.top - box.top + 24) + 'px';
      });
    $('#lleg').innerHTML = GN.map(gg => `<span><i class="sw" style="background:${COL[gg]}"></i>${GNAME[gg]}</span>`).join('') + (dashed.length ? '<span><i class="dash"></i>Current trends</span>' : '');
  }

  function drawDum() {
    const el = $('#dum'); el.innerHTML = '';
    const us = US[dg].slice().sort((a, b) => val(cur, b, 0) - val(cur, a, 0)), w = el.clientWidth || 360, rh = 15, h = us.length * rh + 6, l = 112, c = COL[dg];
    const x = d3.scaleLinear([0, 100], [l, w - 36]);
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, w, h]).attr('role', 'img').attr('aria-label', `Literacy by district, ${GNAME[dg]}, ${T0} and ${year}`);
    us.forEach((u, k) => {
      const y = k * rh + 8, a = val(cur, u, 0), b = val(cur, u, year - T0);
      svg.append('text').attr('x', l - 6).attr('y', y + 4).attr('text-anchor', 'end').style('font-size', '11.5px').text(short(u));
      svg.append('line').attr('x1', x(a)).attr('x2', x(b)).attr('y1', y).attr('y2', y).attr('stroke', c).attr('stroke-opacity', 0.45).attr('stroke-width', 3);
      svg.append('circle').attr('cx', x(a)).attr('cy', y).attr('r', 3.2).attr('fill', '#fff').attr('stroke', c);
      svg.append('circle').attr('cx', x(b)).attr('cy', y).attr('r', 3.8).attr('fill', c);
      svg.append('text').attr('x', x(Math.max(a, b)) + 7).attr('y', y + 4).style('font-size', '11.5px').text(pct(b));
    });
  }

  function drawYear() {
    $('#yearo').textContent = year;
    const i = year - T0;
    paths.attr('fill', f => color(val(cur, f.properties.n, i)));
    d3.select(root).select('#lm').attr('x1', X(year)).attr('x2', X(year));
    $('#maph').textContent = `Share of ${SEXN[sex]} aged 10+ who can read and write, ${year}`;
    $('#dumh').textContent = year === T0 ? `By district, ${T0}` : `By district, ${T0} (hollow) and ${year} (filled)`;
    drawDum();
  }
  function draw() { stats(); $('#lineh').textContent = `Literacy of ${SEXN[sex]} aged 10+: ${NAME[key].toLowerCase()}`; drawMap(); drawLine(); drawYear(); }
  syncInputs(); draw();
  let lw = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lw) < 2) return; lw = root.clientWidth; clearTimeout(window.__rz); window.__rz = setTimeout(draw, 120); }).observe(root);

  if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed'); document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'literacy.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
