
(async function(){
  const root = document.querySelector('.viz-root');
  const $ = s => root.querySelector(s);
  const tip = $('.tooltip');
  const D = await d3.json('growth.json?v=' + (root.dataset.v || ''));
  $('.source').textContent = D.source;
  const U = D.units, byId = new Map(U.map(u => [u.id, u])), PK = D.prov.find(p => p.k === 'PK');
  const PNAME = Object.fromEntries(D.prov.map(p => [p.k, p.n]));
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const pct = v => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '%';
  const pts = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + ' points';
  const people = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'm' : d3.format(',')(Math.round(v / 1000) * 1000);
  const val = (u, m) => m === 'd' ? u.g2 - u.g1 : u[m];
  const LABEL = {g2: 'yearly growth, 2017 to 2023', g1: 'yearly growth, 1998 to 2017', d: 'change in yearly growth, 1998-2017 to 2017-2023'};
  let mode = 'g2', prov = 'all', hover = null, pinned = null;

  // province filter
  const provs = $('.provs');
  [['all', 'All'], ...D.prov.filter(p => p.k !== 'PK').map(p => [p.k, p.n])].forEach(([k, n]) => {
    const b = document.createElement('button'); b.dataset.p = k; b.textContent = n; b.setAttribute('aria-pressed', k === 'all');
    b.addEventListener('click', () => setProv(k)); provs.appendChild(b);
  });
  function setProv(k) {
    prov = k;
    provs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === k));
    draw();
  }
  root.querySelectorAll('.pills button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m; root.querySelectorAll('.pills button').forEach(x => x.setAttribute('aria-pressed', x === b)); draw();
  }));

  // colour: faster or slower than Pakistan (or than before, for the change)
  function colour() {
    const mid = mode === 'd' ? 0 : PK[mode], span = mode === 'd' ? 4 : 3;
    const s = d3.scaleDiverging([mid - span, mid, mid + span], d3.interpolateRgbBasis(['#1d5aa6', '#9cc3ee', '#f1f0eb', '#f4ae8c', '#b9400f'])).clamp(true);
    return {s, mid, span};
  }

  function stats() {
    $('.stats').innerHTML = D.prov.slice().sort((a, b) => (b.k === 'PK') - (a.k === 'PK')).map(p => {
      const v = mode === 'd' ? pts(p.g2 - p.g1) : pct(p[mode]) ;
      const s = mode === 'd' ? `from ${pct(p.g1)} to ${pct(p.g2)} a year` : mode === 'g2' ? `a year; ${pct(p.g1)} in 1998-2017` : `a year; ${pct(p.g2)} in 2017-2023`;
      return `<div class="stat${prov === p.k ? ' on' : ''}" data-k="${p.k}"><div class="k">${p.n}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    }).join('');
    root.querySelectorAll('.stat').forEach(el => el.addEventListener('click', () => setProv(el.dataset.k === 'PK' || el.dataset.k === prov ? 'all' : el.dataset.k)));
  }

  function showTip(u, ev) {
    if (!u) { tip.hidden = true; return; }
    if (u.nc) {
      tip.innerHTML = `<div class="dt">${u.n}</div><div class="note">Not covered by these censuses</div>`;
    } else {
      tip.innerHTML = `<div class="dt">${u.n}</div><div class="note">${[u.note, PNAME[u.p]].filter(Boolean).join(' · ')}</div>` +
        [['People, 1998', people(u.p98)], ['2017', people(u.p17b)], ['2023', people(u.p23)],
         ['Growth 1998-2017', pct(u.g1) + ' a year'], ['Growth 2017-2023', pct(u.g2) + ' a year'], ['Change', pts(u.g2 - u.g1)]]
          .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');
    }
    tip.hidden = false;
    const box = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
    if (x + tw > box.width) x = ev.clientX - box.left - 14 - tw;
    if (y + th > box.height) y = Math.max(0, ev.clientY - box.top - 14 - th);
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = y + 'px';
  }
  function setHover(id) { hover = id; mark(); }
  function mark() {
    const on = hover || pinned;
    d3.select(root).selectAll('.district').classed('hi', d => d.properties.id === on);
    d3.select(root).selectAll('.line').classed('hi', d => d.id === on).filter(d => d.id === on).raise();
    d3.select(root).selectAll('.sel').remove();
    const u = byId.get(on);
    if (u && slopeX) {
      const g = d3.select(root).select('#slope g.plot');
      [['l', u.g1], ['r', u.g2]].forEach(([side, v]) => g.append('text').attr('class', 'sel endlab')
        .attr('x', side === 'l' ? slopeX.l - 8 : slopeX.r + 8).attr('y', slopeY(v) + 4)
        .attr('text-anchor', side === 'l' ? 'end' : 'start').style('font-weight', 650).style('fill', css('--ink')).text(pct(v)));
      g.append('text').attr('class', 'sel endlab').attr('x', (slopeX.l + slopeX.r) / 2).attr('y', slopeY((u.g1 + u.g2) / 2) - 8)
        .attr('text-anchor', 'middle').style('font-weight', 650).style('fill', css('--ink')).text(u.n);
    }
  }

  let slopeX = null, slopeY = null;
  function drawMap() {
    const el = $('#map'); el.innerHTML = '';
    const width = el.clientWidth || 560, height = Math.round(width * 1.02);
    const proj = d3.geoMercator().fitExtent([[4, 4], [width - 4, height - 4]], D.geo);
    const path = d3.geoPath(proj), {s} = colour();
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    svg.append('g').selectAll('path').data(D.geo.features).join('path')
      .attr('class', d => 'district' + (byId.has(d.properties.id) ? '' : ' nc')).attr('d', path)
      .attr('fill', d => { const u = byId.get(d.properties.id); return u ? s(val(u, mode)) : null; })
      .attr('fill-opacity', d => { const u = byId.get(d.properties.id); return !u || prov === 'all' || u.p === prov ? 1 : 0.18; })
      .on('pointermove', (ev, d) => { const u = byId.get(d.properties.id); setHover(u ? u.id : null); showTip(u || {n: D.notCounted[d.properties.id], nc: true}, ev); })
      .on('pointerleave', () => { setHover(null); tip.hidden = true; })
      .on('click', (ev, d) => { const id = byId.has(d.properties.id) ? d.properties.id : null; pinned = pinned === id ? null : id; mark(); });
    svg.append('g').selectAll('path').data(D.provGeo.features).join('path').attr('class', 'outline').attr('d', path);
    $('#mapk').textContent = 'Map: ' + LABEL[mode];
    const {mid, span} = colour(), stops = d3.range(0, 1.01, 0.1).map(t => s(mid - span + 2 * span * t)).join(',');
    $('#mleg').innerHTML = mode === 'd'
      ? `<span>Slowed down</span><i class="ramp" style="background:linear-gradient(90deg,${stops})"></i><span>Sped up (±${span} points)</span>`
      : `<span>Slower than Pakistan</span><i class="ramp" style="background:linear-gradient(90deg,${stops})"></i><span>Faster (Pakistan ${pct(mid)}, ±${span} points)</span>` +
        `<span><i class="sw" style="background:#e9e8e3;height:10px;width:10px"></i>Not in these censuses</span>`;
  }

  function drawSlope() {
    const el = $('#slope'); el.innerHTML = '';
    const width = el.clientWidth || 480, narrow = width < 420, height = Math.max(420, Math.min(560, width * 1.05));
    const m = {t: 26, b: 14, l: narrow ? 46 : 58, r: narrow ? 110 : 132};
    const vals = U.flatMap(u => [u.g1, u.g2]);
    slopeY = d3.scaleLinear([Math.min(-0.5, d3.min(vals)), d3.max(vals)], [height - m.b, m.t]).nice();
    slopeX = {l: m.l, r: width - m.r};
    const svg = d3.select(el).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('class', 'plot');
    slopeY.ticks(8).forEach(t => {
      g.append('line').attr('x1', slopeX.l).attr('x2', slopeX.r).attr('y1', slopeY(t)).attr('y2', slopeY(t)).attr('stroke', t === 0 ? css('--axis') : css('--grid'));
      g.append('text').attr('x', slopeX.l - 8).attr('y', slopeY(t) + 4).attr('text-anchor', 'end').style('font-size', '11px').text(t + '%');
    });
    [['l', '1998 to 2017'], ['r', '2017 to 2023']].forEach(([s, t]) => {
      g.append('line').attr('x1', slopeX[s]).attr('x2', slopeX[s]).attr('y1', m.t - 4).attr('y2', height - m.b).attr('stroke', css('--axis'));
      g.append('text').attr('x', slopeX[s]).attr('y', m.t - 10).attr('text-anchor', 'middle').style('font-weight', 600).text(t);
    });
    const seg = u => `M${slopeX.l},${slopeY(u.g1)}L${slopeX.r},${slopeY(u.g2)}`;
    const show = U.filter(u => prov === 'all' || u.p === prov);
    g.append('g').selectAll('path').data(show).join('path').attr('class', 'line').attr('d', seg)
      .attr('stroke', u => u.g2 >= u.g1 ? css('--up') : css('--down'));
    const P = D.prov.filter(p => p.k === 'PK' || prov === 'all' || p.k === prov);
    g.append('g').selectAll('path').data(P).join('path').attr('class', 'provline').attr('d', seg)
      .attr('stroke-dasharray', p => p.k === 'PK' ? '5 3' : null);
    const labs = P.map(p => ({p, y: slopeY(p.g2)})).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
    labs.forEach(l => g.append('text').attr('class', 'endlab').attr('x', slopeX.r + 8).attr('y', l.y + 4)
      .style('font-weight', 600).style('fill', css('--ink')).text(`${narrow && l.p.k === 'KP' ? 'KP' : l.p.n} ${pct(l.p.g2)}`));
    g.append('g').selectAll('path').data(show).join('path').attr('class', 'hit').attr('d', seg)
      .on('pointermove', (ev, u) => { setHover(u.id); showTip(u, ev); })
      .on('pointerleave', () => { setHover(null); tip.hidden = true; })
      .on('click', (ev, u) => { pinned = pinned === u.id ? null : u.id; mark(); });
    $('#sleg').innerHTML = `<span><i class="sw" style="background:${css('--up')}"></i>Grew faster in 2017-2023</span>` +
      `<span><i class="sw" style="background:${css('--down')}"></i>Grew slower</span><span><i class="sw" style="background:${css('--ink')}"></i>Province (dashed: Pakistan)</span>`;
  }

  function draw() { stats(); drawMap(); drawSlope(); mark(); }
  draw();
  let lw = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lw) < 2) return; lw = root.clientWidth; clearTimeout(window.__rz); window.__rz = setTimeout(draw, 120); }).observe(root);

  if (new URLSearchParams(location.search).has('embed')) {
    document.documentElement.classList.add('embed'); document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'growth.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
