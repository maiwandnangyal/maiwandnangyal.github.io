
(async function(){
  const root = document.querySelector('.viz-root');
  const [D, G] = await Promise.all(['earthquakes', 'districts'].map(f => d3.json(f + '.json?v=' + (root.dataset.v || ''))));
  D.units = G.units; D.borders = G.borders;
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const tip = $('.tooltip'), Q = D.q, N = Q.d.length, U = D.units.features;
  const DAY = 864e5, t0 = Date.parse(D.epoch + 'T00:00:00Z'), asOf = new Date(D.asOf + 'T00:00:00Z');
  const fDate = d3.utcFormat('%-d %b %Y'), fDM = d3.utcFormat('%-d %b'), num = d3.format(',');
  const dateOf = i => new Date(t0 + Q.d[i] * DAY);
  const yearOf = Array.from({length: N}, (_, i) => dateOf(i).getUTCFullYear());
  const Y = d3.range(d3.min(yearOf), asOf.getUTCFullYear() + 1);
  const DEEP = 70;
  const isDeep = i => Q.z[i] != null && Q.z[i] >= DEEP;
  const colourOf = i => Q.z[i] == null ? css('--muted') : isDeep(i) ? css('--deep') : css('--shallow');
  const R = Object.fromEntries(D.regions.map(r => [r.id, r.name]));
  $('.source').textContent = D.source;
  let minM = 40, yi = Y.length - 1, timer = null, ghosts = true;
  const partial = y => y === asOf.getUTCFullYear() ? ` (to ${fDM(asOf)})` : '';
  const where = i => {
    if (Q.u[i] < 0) return 'Outside the four regions';
    const p = U[Q.u[i]].properties;
    return `${p.name}, ${p.parent || R[p.region]}`;
  };

  // events of each year, filtered by magnitude, strongest first so small ones sit on top
  let byYear = [];
  function regroup() {
    byYear = Y.map(() => []);
    for (let i = 0; i < N; i++) if (Q.m[i] >= minM) byYear[yearOf[i] - Y[0]].push(i);
    byYear.forEach(a => a.sort((p, q) => Q.m[q] - Q.m[p]));
  }

  // ---- stats for the selected year, inside the four regions
  function stats() {
    const ev = byYear[yi].filter(i => Q.u[i] >= 0), y = Y[yi];
    const sh = ev.filter(i => !isDeep(i)).length;
    const top = ev[0];
    const mlabel = minM === 40 ? 'magnitude 4+' : 'magnitude 5+';
    $('.stats').innerHTML = `
      <div class="stat"><div class="k">Earthquakes in ${y}${partial(y)}, ${mlabel}</div><div class="v">${num(ev.length)}</div>
        <div class="s">inside the four regions</div></div>
      <div class="stat"><div class="k">Strongest in ${y}</div><div class="v">${top == null ? 'none' : 'M' + (Q.m[top] / 10).toFixed(1)}</div>
        <div class="s">${top == null ? 'no earthquake recorded' : fDate(dateOf(top)) + ', ' + where(top) + ', ' + (Q.z[top] == null ? 'depth unknown' : Q.z[top] + ' km deep')}</div></div>
      <div class="stat"><div class="k">Shallow, under ${DEEP} km deep</div><div class="v">${ev.length ? num(sh) : '0'}</div>
        <div class="s">${ev.length ? 'of ' + num(ev.length) + '; shallow quakes shake the ground hardest' : ''}</div></div>`;
  }

  // ---- map
  const mapHolder = $('.map');
  const rOf = m => 1.5 * Math.pow(1.8, (m - 40) / 10);
  let proj, gQ, ghostPath, scaleK = 1, ghostSegs = [], xy = [];
  function legend() {
    const dot = (c, hollow) => `<svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="${hollow ? 'none' : c}" fill-opacity=".55" stroke="${c}"/></svg>`;
    const sizes = [4, 5, 6, 7].map(m => { const r = rOf(m * 10) * scaleK; return `<svg width="${2 * r + 2}" height="${2 * r + 2}"><circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="none" stroke="${css('--ink-2')}"/></svg> ${m}`; }).join(' ');
    $('.map-legend').innerHTML = `<span>${dot(css('--shallow'))} Shallow (under ${DEEP} km)</span><span>${dot(css('--deep'))} Deep (${DEEP} km or more)</span>` +
      `<span>${dot(css('--muted'), true)} Outside the four regions</span><span>Magnitude ${sizes}</span>`;
  }
  function drawMap() {
    mapHolder.innerHTML = '';
    const w = mapHolder.clientWidth || 640, h = Math.round(w * 0.92);
    scaleK = Math.max(0.75, Math.min(1.4, w / 600));
    proj = d3.geoMercator().fitExtent([[4, 4], [w - 4, h - 4]], D.units);
    const path = d3.geoPath(proj);
    const svg = d3.select(mapHolder).append('svg').attr('viewBox', [0, 0, w, h]);
    svg.append('defs').append('clipPath').attr('id', 'qclip').append('rect').attr('width', w).attr('height', h);
    svg.append('g').selectAll('path').data(U).join('path').attr('class', 'unit').attr('d', path)
      .on('pointermove', (e, d) => place(e, `<div class="dt">${d.properties.name}</div><div class="sub">${d.properties.kind}, ${d.properties.parent || R[d.properties.region]}</div>`))
      .on('pointerleave', () => { tip.hidden = true; });
    svg.append('g').selectAll('path').data(D.borders.features).join('path').attr('class', 'border').attr('d', path);
    const g = svg.append('g').attr('clip-path', 'url(#qclip)');
    ghostPath = g.append('path').attr('class', 'ghosts');
    gQ = g.append('g');
    xy = Array.from({length: N}, (_, i) => proj([Q.lo[i] / 100, Q.la[i] / 100]));
    buildGhosts(); legend(); redrawYear();
  }
  function buildGhosts() {   // one path string per year: small grey dots
    const r = 1.1 * scaleK;
    ghostSegs = byYear.map(a => a.map(i => { const [x, y] = xy[i]; return `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`; }).join(''));
  }
  function redrawYear() {
    if (!gQ) return;
    ghostPath.attr('d', ghosts ? ghostSegs.slice(0, yi).join('') : null);
    gQ.selectAll('circle').data(byYear[yi], i => i).join('circle')
      .attr('class', i => 'q ' + (Q.u[i] >= 0 ? 'in' : 'out'))
      .attr('cx', i => xy[i][0]).attr('cy', i => xy[i][1]).attr('r', i => rOf(Q.m[i]) * scaleK)
      .attr('fill', colourOf).attr('stroke', colourOf)
      .on('pointermove', (e, i) => place(e, `<div class="dt">Magnitude ${(Q.m[i] / 10).toFixed(1)}${D.magTypes[Q.t[i]] && D.magTypes[Q.t[i]] !== '?' ? ' (' + D.magTypes[Q.t[i]] + ')' : ''}</div>
          <div class="sub">${fDate(dateOf(i))}</div>
          <div class="row"><span class="nm">Where</span><span class="v" style="font-weight:400;text-align:right">${where(i)}</span></div>
          <div class="row"><span class="nm">Depth</span><span class="v">${Q.z[i] == null ? 'unknown' : Q.z[i] + ' km'}</span></div>`))
      .on('pointerleave', () => { tip.hidden = true; });
  }
  function place(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const box = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tw > box.width) x = e.clientX - box.left - 14 - tw;
    if (y + th > box.height) y = e.clientY - box.top - 14 - th;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }

  // ---- bars: earthquakes per year inside the four regions, deep at the bottom, shallow on top
  const barHolder = $('.bars');
  let selLine, xBand;
  $('.bar-legend').innerHTML = `<span><i class="sw" style="background:${css('--shallow')}"></i>Shallow</span><span><i class="sw" style="background:${css('--deep')}"></i>Deep</span>`;
  function counts() { return byYear.map((a, k) => { let s = 0, d = 0; a.forEach(i => { if (Q.u[i] >= 0) isDeep(i) ? d++ : s++; }); return {k, y: Y[k], s, d, t: s + d}; }); }
  function drawBars() {
    barHolder.innerHTML = '';
    const C = counts();
    const w = barHolder.clientWidth || 420, narrow = w < 380;
    const m = {top: 16, right: 10, bottom: 26, left: 38};
    const h = Math.max(240, Math.min(360, w * 0.75)), iw = w - m.left - m.right, ih = h - m.top - m.bottom;
    const x = xBand = d3.scaleBand().domain(Y).range([0, iw]).paddingInner(0.18);
    const y = d3.scaleLinear().domain([0, Math.max(5, d3.max(C, c => c.t)) * 1.05]).nice().range([ih, 0]);
    const svg = d3.select(barHolder).append('svg').attr('viewBox', [0, 0, w, h]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'gridl').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6)).call(s => s.select('.domain').remove());
    const step = narrow ? 40 : 20, ticks = Y.filter(v => v % step === 0);
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickSizeOuter(0));
    if (minM === 40 && Y.includes(1973)) {
      const ann = g.append('g').attr('class', 'ann'), xa = x(1973) - x.step() * 0.1;
      ann.append('line').attr('x1', xa).attr('x2', xa).attr('y1', 0).attr('y2', ih);
      ann.append('text').attr('x', xa - 4).attr('y', 10).attr('text-anchor', 'end').text('Smaller quakes catalogued from 1973');
    }
    const bw = x.bandwidth();
    g.append('g').selectAll('rect').data(C).join('rect').attr('x', c => x(c.y)).attr('width', bw)
      .attr('y', c => y(c.d)).attr('height', c => ih - y(c.d)).attr('fill', css('--deep'));
    g.append('g').selectAll('rect').data(C).join('rect').attr('x', c => x(c.y)).attr('width', bw)
      .attr('y', c => y(c.d + c.s)).attr('height', c => y(c.d) - y(c.d + c.s)).attr('fill', css('--shallow'));
    selLine = g.append('line').attr('class', 'sel').attr('y1', -4).attr('y2', ih);
    const kOf = mx => Math.max(0, Math.min(Y.length - 1, Math.floor(mx / x.step())));
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointerleave', () => { tip.hidden = true; })
      .on('pointermove', e => {
        const c = C[kOf(d3.pointer(e, g.node())[0])];
        place(e, `<div class="dt">${c.y}${partial(c.y)}</div>
          <div class="row"><span class="k" style="background:${css('--shallow')}"></span><span class="nm">Shallow</span><span class="v">${num(c.s)}</span></div>
          <div class="row"><span class="k" style="background:${css('--deep')}"></span><span class="nm">Deep</span><span class="v">${num(c.d)}</span></div>
          <div class="row"><span class="k"></span><span class="nm">Total</span><span class="v">${num(c.t)}</span></div>`);
      })
      .on('click', e => { stop(); setYear(kOf(d3.pointer(e, g.node())[0])); });
    moveSel();
  }
  function moveSel() { if (selLine) { const xm = xBand(Y[yi]) + xBand.bandwidth() / 2; selLine.attr('x1', xm).attr('x2', xm); } }

  // ---- table of the strongest earthquakes inside the four regions
  function table() {
    const ev = []; for (let i = 0; i < N; i++) if (Q.u[i] >= 0) ev.push(i);
    ev.sort((a, b) => Q.m[b] - Q.m[a] || Q.d[b] - Q.d[a]);
    $('.table-wrap').innerHTML = `<table><tr><th>Date</th><th class="n">Magnitude</th><th class="n">Depth (km)</th><th>District</th><th>Province or region</th></tr>` +
      ev.slice(0, 25).map(i => { const p = U[Q.u[i]].properties; return `<tr><td>${fDate(dateOf(i))}</td><td class="n">${(Q.m[i] / 10).toFixed(1)}</td><td class="n">${Q.z[i] == null ? '' : Q.z[i]}</td><td>${p.name}</td><td>${p.parent || R[p.region]}</td></tr>`; }).join('') + '</table>';
  }

  // ---- controls
  const slider = $('.year input'), out = $('.yr'), play = $('.play');
  slider.min = 0; slider.max = Y.length - 1; slider.value = yi;
  function setYear(k) {
    yi = Math.max(0, Math.min(Y.length - 1, k));
    slider.value = yi; out.textContent = Y[yi]; stats(); redrawYear(); moveSel();
  }
  slider.addEventListener('input', () => { stop(); setYear(+slider.value); });
  function stop() { if (timer) { clearTimeout(timer); timer = null; play.setAttribute('aria-pressed', 'false'); play.innerHTML = '&#9654;'; } }
  function tick() {   // quicker through the sparse early years
    if (yi >= Y.length - 1) return stop();
    setYear(yi + 1);
    timer = setTimeout(tick, Y[yi] < 1973 ? 160 : 450);
  }
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (yi === Y.length - 1) setYear(0);
    play.setAttribute('aria-pressed', 'true'); play.innerHTML = '&#10074;&#10074;';
    timer = setTimeout(tick, 300);
  });
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    minM = +b.dataset.m;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    regroup(); buildGhosts(); drawBars(); setYear(yi);
  }));
  $('.ghost input').addEventListener('change', e => { ghosts = e.target.checked; redrawYear(); });

  regroup(); table(); setYear(yi);
  let lastW = 0;
  new ResizeObserver(() => {
    const w = root.clientWidth; if (Math.abs(w - lastW) < 2) return; lastW = w;
    drawMap(); drawBars();
  }).observe(root);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'earthquakes.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
