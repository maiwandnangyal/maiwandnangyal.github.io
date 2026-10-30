
(async function(){
  const root = document.querySelector('.viz-root');
  const $ = s => root.querySelector(s);
  const tip = $('.tooltip');
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();

  if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed'); document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'aid.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }

  let D;
  try { D = await d3.json('aid.json?v=' + (root.dataset.v || '')); }
  catch (e) { $('#bars').innerHTML = '<p class="wait">The figures could not be loaded.</p>'; return; }
  $('.source').textContent = D.source || '';
  if (!D.years || !D.years.length) { $('#bars').innerHTML = '<p class="wait">Waiting for the first automatic update.</p>'; return; }

  const YS = D.years, LAST = YS[YS.length - 1], A = y => D.appeal[String(y)];
  const money = v => { const a = Math.abs(v); return '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'bn' : a >= 1e6 ? Math.round(a / 1e6).toLocaleString('en-GB') + 'm' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a)); };
  const yl = y => y === LAST ? `${y} so far` : String(y);
  // the latest full year with an appeal, to start with
  let year = [...YS].reverse().find(y => y < LAST && A(y).req > 0) || LAST;

  function place(ev) {
    tip.hidden = false;
    const box = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
    if (x + tw > box.width) x = ev.clientX - box.left - 14 - tw;
    if (y + th > box.height) y = Math.max(0, ev.clientY - box.top - 14 - th);
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = y + 'px';
  }
  const rows = rs => rs.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');

  // ------------------------------------------------------------ flows for a year, or for all years
  function flowsFor(sel) {
    const keys = sel === 'all' ? Object.keys(D.flows) : [String(sel)];
    const m = new Map();
    keys.forEach(k => { const f = D.flows[k]; if (!f) return; f.m.forEach(([i, j, v]) => { const key = f.d[i] + '\u0001' + j; m.set(key, (m.get(key) || 0) + v); }); });
    const byD = d3.rollup([...m], v => d3.sum(v, x => x[1]), x => x[0].split('\u0001')[0]);
    let donors = [...byD].filter(([d]) => d !== 'Other donors').sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const keep = new Set(donors.slice(0, 12));
    const links = new Map();
    for (const [key, v] of m) {
      const [d, j] = key.split('\u0001'), dd = keep.has(d) ? d : 'Other donors', k2 = dd + '\u0001' + j;
      links.set(k2, (links.get(k2) || 0) + v);
    }
    donors = [...keep];
    if ([...links.keys()].some(k => k.startsWith('Other donors\u0001'))) donors.push('Other donors');
    return {donors, links: [...links].map(([k, v]) => { const [d, j] = k.split('\u0001'); return {d, s: D.sectors[+j], v}; })};
  }

  // ------------------------------------------------------------ headline figures for the chosen year
  function stats() {
    const sel = year;
    if (sel === 'all') {
      const t = d3.sum(YS, y => A(y).plan + A(y).out), r = d3.sum(YS, y => A(y).req), p = d3.sum(YS, y => A(y).plan);
      const f = flowsFor('all'), top = d3.rollup(f.links, v => d3.sum(v, x => x.v), x => x.d), best = [...top].filter(x => x[0] !== 'Other donors').sort((a, b) => b[1] - a[1])[0];
      $('.stats').innerHTML = [['Reported funding, ' + YS[0] + '-' + LAST, money(t), 'in US dollars of each year'],
        ['UN appeals asked for', money(r), money(p) + ' received for them (' + Math.round(100 * p / r) + '%)'],
        ['Largest donor', best[0], money(best[1]) + ', ' + Math.round(100 * best[1] / d3.sum(f.links, x => x.v)) + '% of the total']]
        .map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
      return;
    }
    const a = A(sel), f = flowsFor(sel), top = d3.rollup(f.links, v => d3.sum(v, x => x.v), x => x.d);
    const best = [...top].filter(x => x[0] !== 'Other donors').sort((a2, b) => b[1] - a2[1])[0], tf = d3.sum(f.links, x => x.v);
    const cards = [];
    cards.push(a.req > 0 ? ['UN appeal, ' + yl(sel), money(a.req), a.plans.length > 1 ? a.plans.length + ' appeals' : 'asked for'] : ['UN appeal, ' + yl(sel), 'None', 'no appeal this year']);
    if (a.req > 0) cards.push(['Received for the appeal', money(a.plan), Math.round(100 * a.plan / a.req) + '% of what was asked']);
    cards.push(['Received outside the appeal', money(a.out), 'total reported ' + money(a.plan + a.out)]);
    if (best) cards.push(['Largest donor', best[0], money(best[1]) + ', ' + Math.round(100 * best[1] / tf) + '% of reported funding']);
    $('.stats').innerHTML = cards.map(([k, v, s]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
  }

  // ------------------------------------------------------------ asked for and received, every year
  function drawBars() {
    const el = $('#bars'); el.innerHTML = '';
    const width = el.clientWidth || 900, narrow = width < 600, height = Math.max(240, Math.min(340, width * 0.36));
    const m = {t: 10, r: 6, b: 24, l: narrow ? 42 : 48}, iw = width - m.l - m.r, ih = height - m.t - m.b;
    const x = d3.scaleBand(YS, [0, iw]).paddingInner(0.18).paddingOuter(0.05);
    const ymax = d3.max(YS, y => Math.max(A(y).req, A(y).plan + A(y).out));
    const yS = d3.scaleLinear([0, ymax], [ih, 0]).nice();
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    g.append('g').selectAll('rect').data(YS).join('rect').attr('class', y => 'yband' + (y === year ? ' on' : ''))
      .attr('x', y => x(y) - x.step() * x.paddingInner() / 2).attr('width', x.step()).attr('y', 0).attr('height', ih)
      .attr('fill-opacity', y => y === year ? 1 : 0);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(yS).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(yS).ticks(5).tickSize(0).tickPadding(6).tickFormat(v => v ? '$' + (v / 1e9) + 'bn' : '0'))
      .call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(YS.filter(y => y === LAST || (y % (narrow ? 5 : 2) === 0 && LAST - y >= (narrow ? 3 : 2)))).tickFormat(y => y === LAST ? y + '*' : y).tickSizeOuter(0));
    const bw = x.bandwidth() / 2;
    YS.forEach(y => {
      const a = A(y), x0 = x(y), gg = g.append('g');
      if (a.req > 0) gg.append('rect').attr('x', x0).attr('width', bw - 0.5).attr('y', yS(a.req)).attr('height', ih - yS(a.req)).attr('fill', css('--ask'));
      gg.append('rect').attr('x', x0 + bw).attr('width', bw).attr('y', yS(a.plan)).attr('height', ih - yS(a.plan)).attr('fill', css('--got'));
      gg.append('rect').attr('x', x0 + bw).attr('width', bw).attr('y', yS(a.plan + a.out)).attr('height', yS(a.plan) - yS(a.plan + a.out)).attr('fill', css('--out'));
    });
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('pointerleave', () => tip.hidden = true)
      .on('pointermove', ev => {
        const [mx] = d3.pointer(ev, g.node()), y = YS[Math.max(0, Math.min(YS.length - 1, Math.floor((mx - x(YS[0]) + x.step() * x.paddingInner() / 2) / x.step())))];
        const a = A(y);
        tip.innerHTML = `<div class="dt">${yl(y)}</div>` + rows([
          ['UN appeal asked for', a.req > 0 ? money(a.req) : 'no appeal'],
          ...(a.req > 0 ? [['Received for the appeal', money(a.plan) + ' (' + Math.round(100 * a.plan / a.req) + '%)']] : []),
          ['Received outside it', money(a.out)], ['Total reported', money(a.plan + a.out)]]) +
          (a.plans.length ? `<div class="nt">${a.plans.map(p => p[0]).join('; ')}</div>` : '') + '<div class="nt">Click to see this year by sector and donor</div>';
        place(ev);
      })
      .on('click', ev => {
        const [mx] = d3.pointer(ev, g.node()), y = YS[Math.max(0, Math.min(YS.length - 1, Math.floor((mx - x(YS[0]) + x.step() * x.paddingInner() / 2) / x.step())))];
        setYear(y);
      });
    $('#bleg').innerHTML = `<span><i class="sq" style="background:${css('--ask')}"></i>UN appeal: asked for</span>` +
      `<span><i class="sq" style="background:${css('--got')}"></i>Received for the appeal</span>` +
      `<span><i class="sq" style="background:${css('--out')}"></i>Received outside the appeal</span><span>* ${LAST} so far</span>`;
  }

  // ------------------------------------------------------------ by sector
  function drawSectors() {
    const el = $('#sec'); el.innerHTML = '';
    let rs;
    if (year === 'all') {
      const t = new Map();
      Object.values(D.bySector).forEach(list => list.forEach(([s, r, f]) => { const o = t.get(s) || [0, 0]; o[0] += r; o[1] += f; t.set(s, o); }));
      rs = [...t].map(([s, [r, f]]) => [s, r, f]);
    } else rs = (D.bySector[String(year)] || []).slice();
    rs = rs.filter(r => r[1] > 0 || r[2] > 0).sort((a, b) => (b[1] || b[2] * 1e-6) - (a[1] || a[2] * 1e-6));
    $('#seck').textContent = 'UN appeal by sector, ' + (year === 'all' ? 'all years' : yl(year));
    if (!rs.length) { el.innerHTML = '<p class="note">No UN appeal this year, so no requirements by sector.</p>'; return; }
    const width = el.clientWidth || 440, narrow = width < 420, lw = narrow ? 118 : 140, rh = 24, rw = narrow ? 92 : 150;
    const height = rs.length * rh + 6, xmax = d3.max(rs, r => Math.max(r[1], r[2]));
    const x = d3.scaleLinear([0, xmax], [0, width - lw - rw]);
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    rs.forEach(([s, r, f], i) => {
      const y = i * rh + 3, g = svg.append('g');
      g.append('text').attr('x', lw - 8).attr('y', y + 13).attr('text-anchor', 'end').style('font-size', narrow ? '11.5px' : '12px').text(s);
      if (r > 0) g.append('rect').attr('x', lw).attr('y', y).attr('width', Math.max(1, x(r))).attr('height', 17).attr('rx', 2).attr('fill', css('--ask'));
      g.append('rect').attr('x', lw).attr('y', y + 4).attr('width', Math.max(f > 0 ? 1 : 0, x(f))).attr('height', 9).attr('rx', 2).attr('fill', css('--got'));
      g.append('text').attr('x', lw + Math.max(x(r), x(f)) + 6).attr('y', y + 13).style('font-size', '11.5px')
        .text(r > 0 ? (narrow ? `${Math.round(100 * f / r)}% of ${money(r)}` : `${money(f)} of ${money(r)} (${Math.round(100 * f / r)}%)`) : money(f) + (narrow ? '' : ', no requirement'));
      g.append('rect').attr('x', 0).attr('y', y - 3).attr('width', width).attr('height', rh).attr('fill', 'transparent')
        .on('pointermove', ev => { tip.innerHTML = `<div class="dt">${s}</div>` + rows([['Asked for', r > 0 ? money(r) : 'none set'], ['Received', money(f)]]) +
          (s === 'Several sectors' ? '<div class="nt">Funding given to more than one sector at once</div>' : s === 'Not specified' ? '<div class="nt">Funding for the appeal not assigned to a sector</div>' : ''); place(ev); })
        .on('pointerleave', () => tip.hidden = true);
    });
  }

  // ------------------------------------------------------------ who paid for what
  function drawFlow() {
    const el = $('#flow'); el.innerHTML = '';
    const {donors, links} = flowsFor(year);
    $('#flowk').textContent = 'Who paid for what, ' + (year === 'all' ? YS[0] + '-' + LAST : yl(year));
    if (!links.length) { el.innerHTML = '<p class="note">No contributions reported for this year.</p>'; $('#flown').textContent = ''; return; }
    const secs = D.sectors.filter(s => links.some(l => l.s === s));
    const tot = d3.sum(links, l => l.v), dv = d => d3.sum(links.filter(l => l.d === d), l => l.v), sv = s => d3.sum(links.filter(l => l.s === s), l => l.v);
    const width = el.clientWidth || 500, narrow = width < 460, lw = narrow ? 104 : 190, rw = narrow ? 112 : 170, gap = 4;
    const SHORT = {'Asian Development Bank': 'Asian Dev. Bank', 'UN emergency fund (CERF)': 'UN CERF', 'Qatar Fund for Development': 'Qatar Fund',
      'Afghanistan Humanitarian Fund': 'Afghan. Hum. Fund', 'World Food Programme': 'WFP', 'Food and agriculture': 'Food and agric.',
      'Water and sanitation': 'Water, sanitation', 'Saudi Arabia': 'Saudi Arabia', 'United Kingdom': 'UK', 'United States': 'US', 'European Union': 'EU'};
    const short = nm => SHORT[nm] || (nm.length > 15 ? nm.slice(0, 14) + '\u2026' : nm);
    const height = Math.max(340, Math.min(560, 28 * Math.max(donors.length, secs.length)));
    const k = (height - gap * (Math.max(donors.length, secs.length) - 1)) / tot;
    const x0 = lw, x1 = width - rw, nw = 10;
    const pos = (names, val, n) => { let y = 0; const spare = height - k * tot - gap * (n - 1), o = {}; names.forEach(nm => { o[nm] = {y: y + spare / 2, h: Math.max(1, k * val(nm))}; y += o[nm].h + gap; }); return o; };
    const L = pos(donors, dv, donors.length), R = pos(secs, sv, secs.length);
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    const lo = Object.fromEntries(donors.map(d => [d, 0])), ro = Object.fromEntries(secs.map(s => [s, 0]));
    const ordered = links.slice().sort((a, b) => donors.indexOf(a.d) - donors.indexOf(b.d) || secs.indexOf(a.s) - secs.indexOf(b.s));
    ordered.forEach(l => { l.h = Math.max(0.5, k * l.v); l.y0 = L[l.d].y + lo[l.d]; lo[l.d] += k * l.v; });
    links.slice().sort((a, b) => secs.indexOf(a.s) - secs.indexOf(b.s) || donors.indexOf(a.d) - donors.indexOf(b.d))
      .forEach(l => { l.y1 = R[l.s].y + ro[l.s]; ro[l.s] += k * l.v; });
    const xa = x0 + nw, xb = x1, xm = (xa + xb) / 2;
    const band = l => `M${xa},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${xb},${l.y1}L${xb},${l.y1 + l.h}C${xm},${l.y1 + l.h} ${xm},${l.y0 + l.h} ${xa},${l.y0 + l.h}Z`;
    const lp = svg.append('g').selectAll('path').data(ordered).join('path').attr('class', 'link').attr('d', band)
      .on('pointermove', (ev, l) => { lp.classed('hi', x => x === l); tip.innerHTML = `<div class="dt">${l.d} to ${l.s.toLowerCase()}</div>` + rows([['Funding', money(l.v)], ['Share of ' + l.d + "'s", Math.round(100 * l.v / dv(l.d)) + '%']]); place(ev); })
      .on('pointerleave', () => { lp.classed('hi', false); tip.hidden = true; });
    // labels at least 13px apart: small nodes get a short leader line to their label
    const spread = (names, B) => {
      const ys = names.map(n => B[n].y + B[n].h / 2), gapL = 13;
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gapL);
      for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], (i === ys.length - 1 ? height - 4 : ys[i + 1] - gapL));
      return Object.fromEntries(names.map((n, i) => [n, ys[i]]));
    };
    const LY = spread(donors, L), RY = spread(secs, R);
    const node = (side, nm, b, val) => {
      const g = svg.append('g').style('cursor', 'pointer'), ly = (side === 'l' ? LY : RY)[nm], cy = b.y + b.h / 2, off = side === 'l' ? -6 : nw + 6;
      const xn = side === 'l' ? x0 : x1, lx = side === 'l' ? x0 - 14 : x1 + nw + 14, moved = Math.abs(ly - cy) > 2;
      g.append('rect').attr('class', 'node').attr('x', xn).attr('y', b.y).attr('width', nw).attr('height', b.h);
      if (moved) g.append('path').attr('d', `M${side === 'l' ? x0 : x1 + nw},${cy}L${side === 'l' ? x0 - 4 : x1 + nw + 4},${cy}L${side === 'l' ? lx + 3 : lx - 3},${ly}`)
        .attr('fill', 'none').attr('stroke', css('--axis'));
      g.append('text').attr('x', moved ? lx : xn + off).attr('y', ly + 4)
        .attr('text-anchor', side === 'l' ? 'end' : 'start').style('font-size', narrow ? '11px' : '12px')
        .text(narrow ? short(nm) : `${nm} ${money(val)}`);
      g.on('pointermove', ev => {
        lp.classed('hi', l => side === 'l' ? l.d === nm : l.s === nm);
        const mine = links.filter(l => side === 'l' ? l.d === nm : l.s === nm).sort((a, b) => b.v - a.v).slice(0, 8);
        tip.innerHTML = `<div class="dt">${nm}: ${money(val)}</div>` + rows(mine.map(l => [side === 'l' ? l.s : l.d, money(l.v)])) +
          `<div class="nt">${Math.round(100 * val / tot)}% of reported funding</div>`;
        place(ev);
      }).on('pointerleave', () => { lp.classed('hi', false); tip.hidden = true; });
    };
    donors.forEach(d => node('l', d, L[d], dv(d)));
    secs.forEach(s => node('r', s, R[s], sv(s)));
    $('#flown').textContent = `All reported contributions, ${money(tot)}, from donors (left) to sectors (right). "Not specified": the donor did not say which sector.` +
      (year === 'all' ? ' Dollars of each year, not adjusted for inflation.' : '');
  }

  // ------------------------------------------------------------ year picker
  const sel = $('#yr');
  sel.innerHTML = [...YS].reverse().map(y => `<option value="${y}">${yl(y)}</option>`).join('') + `<option value="all">All years, ${YS[0]}-${LAST}</option>`;
  sel.addEventListener('change', () => setYear(sel.value === 'all' ? 'all' : +sel.value));
  $('#yhint').textContent = 'or click a year in the chart';
  function setYear(y) { year = y; sel.value = String(y); draw(); }
  function draw() { tip.hidden = true; stats(); drawBars(); drawSectors(); drawFlow(); }
  sel.value = String(year);
  draw();
  let lw = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lw) < 2) return; lw = root.clientWidth; clearTimeout(window.__rz); window.__rz = setTimeout(draw, 120); }).observe(root);
})();
