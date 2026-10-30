(async function(){
  const root = document.querySelector('.viz-root');
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const parse = d3.utcParse('%Y-%m-%d');
  const pct = d3.format('+.2%'), gbp = d3.format(',.2f'), fDay = d3.utcFormat('%-d %B %Y'), fShort = d3.utcFormat('%-d %b');
  const PER = {'1w': ['last week', d => d3.utcDay.offset(d, -7)], '1m': ['last month', d => d3.utcMonth.offset(d, -1)],
               '3m': ['last 3 months', d => d3.utcMonth.offset(d, -3)], '1y': ['last year', d => d3.utcYear.offset(d, -1)]};
  const COLS = ['--a', '--b', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'funds.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }

  let raw;
  try { raw = await d3.json('funds.json?v=' + (root.dataset.v || '')); }
  catch (e) { holder.innerHTML = '<p class="wait">Prices could not be loaded.</p>'; return; }
  $('.source').textContent = raw.source || '';
  const order = (raw.order && raw.order.length ? raw.order : Object.keys(raw.funds || {}));
  if (!order.length) { holder.innerHTML = '<p class="wait">Waiting for the first automatic price update.</p>'; return; }

  const F = order.map((k, i) => {
    const f = raw.funds[k];
    return {k, col: css(COLS[i % COLS.length]), rows: f.rows.map(([d, v]) => ({date: parse(d), v}))};
  }).filter(f => f.rows.length);
  const end = d3.max(F, f => f.rows[f.rows.length - 1].date);
  let view = '1m';
  const shown = new Set(F.map(f => f.k));

  // value on or before a date (last close at that point)
  const bisL = d3.bisector(r => r.date).right;
  const at = (f, d) => { const i = bisL(f.rows, d) - 1; return i >= 0 ? f.rows[i] : null; };
  const last = f => f.rows[f.rows.length - 1];

  // fund picker
  const picks = $('.picks');
  F.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<i class="sw" style="background:${f.col}"></i>${f.k}`;
    b.title = f.k;
    b.addEventListener('click', () => {
      if (shown.has(f.k) && shown.size > 1) shown.delete(f.k); else shown.add(f.k);
      b.setAttribute('aria-pressed', shown.has(f.k)); draw();
    });
    picks.appendChild(b);
  });
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.v;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw();
  }));

  function series(f, start) {
    const base = at(f, start);
    if (!base) return null;
    const rows = f.rows.filter(r => r.date >= base.date);
    return {f, base, pts: rows.map(r => ({date: r.date, r: r.v / base.v - 1}))};
  }

  function draw() {
    holder.innerHTML = ''; tip.hidden = true;
    const [label, back] = PER[view], start = back(end);
    const S = F.filter(f => shown.has(f.k)).map(f => series(f, start)).filter(Boolean);
    const missing = F.filter(f => shown.has(f.k) && !series(f, start)).map(f => f.k);
    $('.subtitle').textContent = `Return in pounds over the ${label}, to ${fDay(end)}. Each line starts at 0% on the last close before ${fDay(start)}.` +
      (missing.length ? ` Not enough history yet for ${missing.join(', ')}.` : '');

    // stats: best and worst over the period
    const all = F.map(f => series(f, start)).filter(Boolean).map(s => ({k: s.f.k, r: s.pts[s.pts.length - 1].r}));
    const best = all.slice().sort((a, b) => b.r - a.r)[0], worst = all.slice().sort((a, b) => a.r - b.r)[0];
    const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $('.stats').innerHTML = (best ? stat('Best', `${best.k} ${pct(best.r)}`, label) : '') + (worst ? stat('Worst', `${worst.k} ${pct(worst.r)}`, label) : '');

    if (!S.length) { holder.innerHTML = '<p class="wait">No data for this period yet.</p>'; calc(); return; }
    const width = holder.clientWidth || 800, narrow = width < 560;
    const m = {top: 14, right: narrow ? 52 : 64, bottom: 28, left: 50};
    const height = Math.max(260, Math.min(420, width * 0.48));
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const pts = S.flatMap(s => s.pts);
    const x = d3.scaleUtc().domain(d3.extent(pts, p => p.date)).range([0, iw]);
    const ext = d3.extent(pts.map(p => p.r).concat([0])), pad = (ext[1] - ext[0]) * 0.1 || 0.01;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([ih, 0]);

    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat(d3.format('+.0%')))
      .call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(view === '1w' ? 5 : (narrow ? 4 : 7)).tickFormat(view === '1y' ? d3.utcFormat('%b %Y') : fShort).tickSizeOuter(0));
    g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--muted')).attr('stroke-dasharray', '3 3');

    const line = d3.line().x(p => x(p.date)).y(p => y(p.r));
    S.forEach(s => g.append('path').datum(s.pts).attr('class', 'line').attr('stroke', s.f.col)
      .attr('stroke-width', 2).attr('d', line));
    if (view === '1w') S.forEach(s => g.append('g').selectAll('circle').data(s.pts).join('circle')
      .attr('cx', p => x(p.date)).attr('cy', p => y(p.r)).attr('r', 2.5).attr('fill', s.f.col));

    // end labels, nudged apart
    const ends = S.map(s => ({s, y: y(s.pts[s.pts.length - 1].r)})).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => g.append('text').attr('class', 'endlab').attr('x', iw + 6).attr('y', e.y + 4)
      .attr('fill', e.s.f.col).text(e.s.f.k));

    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const dots = S.map(s => hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', s.f.col));
    const bis = d3.bisector(p => p.date).center;
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), t = x.invert(mx);
        hover.style('display', null); cross.attr('x1', mx).attr('x2', mx);
        const rows = S.map((s, i) => { const p = s.pts[bis(s.pts, t)]; dots[i].attr('cx', x(p.date)).attr('cy', y(p.r)); return {s, p}; })
          .sort((a, b) => b.p.r - a.p.r);
        tip.innerHTML = `<div class="dt">${fDay(rows[0].p.date)}</div>` + rows.map(({s, p}) =>
          `<div class="row"><span class="k" style="background:${s.f.col}"></span><span class="nm">${s.f.k}</span><span class="v">${pct(p.r)}</span></div>`).join('');
        tip.hidden = false;
        const box = root.getBoundingClientRect(), hb = holder.getBoundingClientRect(), sc = hb.width / width;
        const px = (m.left + mx) * sc + (hb.left - box.left), tw = tip.offsetWidth;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (hb.top - box.top + 10) + 'px';
      });
    calc();
  }

  function calc() {
    const amt = Math.max(0, +$('#amt').value || 0);
    const cols = [null, '1w', '1m', '3m', '1y'];
    $('#calc').innerHTML = F.map(f => {
      const z = last(f);
      const cells = cols.map(c => {
        if (!c) return `<td>£${gbp(amt)}<span class="g">no change yet</span></td>`;
        const b = at(f, PER[c][1](end));
        if (!b) return '<td>–</td>';
        const v = amt * z.v / b.v, g = v - amt;
        return `<td class="${g > 0 ? 'up' : g < 0 ? 'down' : ''}">£${gbp(v)}<span class="g">${g >= 0 ? '+' : '−'}£${gbp(Math.abs(g))}</span></td>`;
      }).join('');
      return `<tr><td>${f.k}</td>${cells}</tr>`;
    }).join('');
  }
  $('#amt').addEventListener('input', calc);

  draw();
  new ResizeObserver(() => draw()).observe(holder);
})();
