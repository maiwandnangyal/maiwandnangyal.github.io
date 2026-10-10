
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('nightlights.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const tip = $('.tooltip'), Y = D.years, iBase = Y.indexOf(D.base);
  $('.source').textContent = D.source;
  const ZERO = getComputedStyle(root).getPropertyValue('--zero').trim();
  const fmt = v => v >= 100 ? d3.format(',.0f')(v) : d3.format(',.1f')(v);
  const pct = d3.format('+.0%');
  let mode = 'level', yi = Y.length - 1, timer = null;

  // ---- colour: total light on a log scale; change as a diverging scale with a grey midpoint
  const LV = {breaks: [10, 100, 1000, 10000], ramp: ['#b7d3f6', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'],
              labels: ['1 to 10', '10 to 100', '100 to 1,000', '1,000 to 10,000', '10,000 or more']};
  const CH = {breaks: [-0.5, -0.2, -0.05, 0.05, 0.2, 0.5],
              ramp: ['#1c5cab', '#6da7ec', '#b7d3f6', '#e6e4df', '#fbd5c0', '#f5a27a', '#b84a1c'],
              labels: ['Down 50%+', 'Down 20 to 50%', 'Down 5 to 20%', 'Within 5%', 'Up 5 to 20%', 'Up 20 to 50%', 'Up 50%+']};
  const MINB = 10;   // below this, % change from 2020 is mostly noise
  const lvScale = d3.scaleThreshold(LV.breaks, LV.ramp), chScale = d3.scaleThreshold(CH.breaks, CH.ramp);
  function fill(p) {
    const v = p.v[yi];
    if (v == null) return 'url(#hatch)';
    if (mode === 'level') return v < 1 ? ZERO : lvScale(v);
    const b = p.v[iBase];
    if (b == null || b < MINB) return 'url(#hatch)';
    return chScale(v / b - 1);
  }
  function legend() {
    const sw = (c, t) => `<span><i class="sw" style="background:${c}"></i>${t}</span>`;
    const hatch = `<span><i class="sw" style="background:repeating-linear-gradient(45deg,#c3c2b7 0 1.5px,transparent 1.5px 4px)"></i>`;
    $('.map-legend').innerHTML = mode === 'level'
      ? sw(ZERO, 'Almost dark (below 1)') + LV.ramp.map((c, i) => sw(c, LV.labels[i])).join('')
      : CH.ramp.map((c, i) => sw(c, CH.labels[i])).join('') + hatch + 'Too dark in 2020 to compare (below 10)</span>';
  }

  // ---- stats: the 2020 to 2022 divergence
  const R = Object.fromEntries(D.regions.map(r => [r.id, r]));
  function stats() {
    const i22 = Y.indexOf(2022);
    if (i22 < 0) return;
    const afg = R.afg.total[i22] / R.afg.total[iBase] - 1;
    const other = ['kp', 'fata', 'bal'], s = k => other.reduce((a, id) => a + R[id].total[k], 0);
    const rest = s(i22) / s(iBase) - 1;
    $('.stats').innerHTML = `
      <div class="stat"><div class="k">Afghanistan, 2020 to 2022</div><div class="v">${pct(afg)}</div>
        <div class="s">total night-time light</div></div>
      <div class="stat"><div class="k">Khyber Pakhtunkhwa, former FATA and Balochistan, 2020 to 2022</div>
        <div class="v">${pct(rest)}</div><div class="s">total night-time light, combined</div></div>`;
  }

  // ---- map
  const mapHolder = $('.map');
  let unitSel;
  function drawMap() {
    mapHolder.innerHTML = '';
    const w = mapHolder.clientWidth || 640, h = Math.round(w * 0.92);
    const proj = d3.geoMercator().fitExtent([[4, 4], [w - 4, h - 4]], D.units);
    const path = d3.geoPath(proj);
    const svg = d3.select(mapHolder).append('svg').attr('viewBox', [0, 0, w, h]);
    const pat = svg.append('defs').append('pattern').attr('id', 'hatch').attr('width', 5).attr('height', 5)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#fcfcfb');
    pat.append('line').attr('y2', 5).attr('stroke', '#c3c2b7').attr('stroke-width', 1.5);
    unitSel = svg.append('g').selectAll('path').data(D.units.features).join('path')
      .attr('class', 'unit').attr('d', path)
      .on('pointermove', (e, d) => showUnit(e, d.properties))
      .on('pointerleave', () => { tip.hidden = true; });
    svg.append('g').selectAll('path').data(D.borders.features).join('path').attr('class', 'border').attr('d', path);
    recolour();
  }
  function recolour() { if (unitSel) unitSel.attr('fill', d => fill(d.properties)); }
  function showUnit(e, p) {
    const v = p.v[yi], b = p.v[iBase];
    const rname = R[p.region].name;
    let html = `<div class="dt">${p.name}</div><div class="sub">${p.kind}, ${p.parent || rname}</div>
      <div class="row"><span class="nm">Total light, ${Y[yi]}</span><span class="v">${v == null ? 'no data' : fmt(v)}</span></div>`;
    if (v != null && b != null && b >= MINB && yi !== iBase)
      html += `<div class="row"><span class="nm">Change since 2020</span><span class="v">${pct(v / b - 1)}</span></div>`;
    else if (b != null && b < MINB && yi !== iBase)
      html += `<div class="row"><span class="nm" style="color:var(--muted)">Too dark in 2020 to compare</span></div>`;
    place(e, html);
  }
  function place(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const box = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tw > box.width) x = e.clientX - box.left - 14 - tw;
    if (y + th > box.height) y = e.clientY - box.top - 14 - th;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }

  // ---- lines: indexed to 2020 = 100
  const lineHolder = $('.lines');
  let selLine, xScale;
  $('.line-legend').innerHTML = D.regions.map(r => `<span><i class="ln" style="background:${r.colour}"></i>${r.name}</span>`).join('');
  function drawLines() {
    lineHolder.innerHTML = '';
    const w = lineHolder.clientWidth || 420, narrow = w < 380;
    const m = {top: 16, right: narrow ? 14 : 124, bottom: 26, left: 38};
    const h = Math.max(240, Math.min(360, w * 0.75)), iw = w - m.left - m.right, ih = h - m.top - m.bottom;
    const S = D.regions.map(r => ({...r, idx: r.total.map(v => v / r.total[iBase] * 100)}));
    const x = xScale = d3.scaleLinear().domain(d3.extent(Y)).range([0, iw]);
    const y = d3.scaleLinear().domain([0, d3.max(S, s => d3.max(s.idx)) * 1.05]).nice().range([ih, 0]);
    const svg = d3.select(lineHolder).append('svg').attr('viewBox', [0, 0, w, h]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'gridl').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6)).call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(narrow ? 4 : 7).tickFormat(d3.format('d')).tickSizeOuter(0));
    const ann = g.append('g').attr('class', 'ann'), xk = x(2021.62);
    ann.append('line').attr('x1', xk).attr('x2', xk).attr('y1', 0).attr('y2', ih);
    ann.append('text').attr('x', xk - 4).attr('y', 10).attr('text-anchor', 'end').text('Fall of Kabul, Aug 2021');
    selLine = g.append('line').attr('class', 'sel').attr('y1', 0).attr('y2', ih);
    const line = d3.line().x((_, i) => x(Y[i])).y(v => y(v));
    S.forEach(s => g.append('path').datum(s.idx).attr('class', 'line').attr('stroke', s.colour).attr('d', line));
    if (!narrow) {   // direct labels at the right end, nudged apart so they never collide
      const ends = S.map(s => ({s, y: y(s.idx[s.idx.length - 1])})).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      ends.forEach(e => g.append('text').attr('class', 'lab').attr('x', iw + 6).attr('y', e.y + 4)
        .text(e.s.name));
    }
    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const dots = S.map(s => hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', s.colour));
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), i = Math.max(0, Math.min(Y.length - 1, Math.round(x.invert(mx) - Y[0])));
        hover.style('display', null); cross.attr('x1', x(Y[i])).attr('x2', x(Y[i]));
        S.forEach((s, k) => dots[k].attr('cx', x(Y[i])).attr('cy', y(s.idx[i])));
        place(e, `<div class="dt">${Y[i]}</div>` + [...S].sort((a, b) => b.idx[i] - a.idx[i]).map(s =>
          `<div class="row"><span class="k" style="background:${s.colour}"></span><span class="nm">${s.name}</span>
           <span class="v">${d3.format('.0f')(s.idx[i])}</span></div>`).join('') +
          `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">2020 = 100</div>`);
      })
      .on('click', e => { const [mx] = d3.pointer(e, g.node()); stop(); setYear(Math.round(x.invert(mx) - Y[0])); });
    moveSel();
  }
  function moveSel() { if (selLine) selLine.attr('x1', xScale(Y[yi])).attr('x2', xScale(Y[yi])); }

  // ---- controls
  const slider = $('.year input'), out = $('.yr'), play = $('.play');
  slider.min = 0; slider.max = Y.length - 1; slider.value = yi;
  function setYear(i) {
    yi = Math.max(0, Math.min(Y.length - 1, i));
    slider.value = yi; out.textContent = Y[yi]; recolour(); moveSel();
  }
  slider.addEventListener('input', () => { stop(); setYear(+slider.value); });
  function stop() { if (timer) { clearInterval(timer); timer = null; play.setAttribute('aria-pressed', 'false'); play.innerHTML = '&#9654;'; } }
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (yi === Y.length - 1) setYear(0);
    play.setAttribute('aria-pressed', 'true'); play.innerHTML = '&#10074;&#10074;';
    timer = setInterval(() => { if (yi >= Y.length - 1) return stop(); setYear(yi + 1); }, 900);
  });
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    legend(); recolour();
  }));

  stats(); legend(); setYear(yi);
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = root.clientWidth; if (Math.abs(w - lastW) < 2) return; lastW = w;
    drawMap(); drawLines();
  });
  ro.observe(root);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'nightlights.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
