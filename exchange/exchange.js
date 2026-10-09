
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('exchange.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const parse = d3.utcParse('%Y-%m-%d');
  ['wdi', 'dabMonthly', 'recent'].forEach(k => D[k].forEach(r => r.date = parse(r.d)));
  $('.source').textContent = D.source;
  const f2 = d3.format(',.2f'), pct = d3.format('+.2%');
  const NAME = {USD: 'US dollar', GBP: 'pound sterling'};
  let view = 'full', ccy = 'USD';

  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.v;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw();
  }));
  root.querySelectorAll('.ccy button').forEach(b => b.addEventListener('click', () => {
    ccy = b.dataset.c;
    root.querySelectorAll('.ccy button').forEach(x => x.setAttribute('aria-pressed', x === b));
    draw();
  }));

  function stats() {
    const r = D.recent.filter(p => p[ccy] != null), a = r[0], z = r[r.length - 1];
    const ch = z[ccy] / a[ccy] - 1;
    const dir = ch > 0 ? 'weaker' : (ch < 0 ? 'stronger' : 'unchanged');
    $('.stats').innerHTML = `
      <div class="stat"><div class="k">Latest, ${d3.utcFormat('%-d %b %Y')(z.date)}</div>
        <div class="v">${f2(z[ccy])} AFN</div><div class="s">per ${NAME[ccy]}</div></div>
      <div class="stat"><div class="k">Change over the last 30 days</div>
        <div class="v">${pct(ch)}</div><div class="s">afghani ${dir} against the ${NAME[ccy]}</div></div>`;
  }

  function draw() {
    holder.innerHTML = ''; tip.hidden = true;
    stats();
    const full = view === 'full';
    $('.subtitle').textContent = full
      ? `Afghani per ${NAME[ccy]}: World Bank annual averages to 2020, Da Afghanistan Bank monthly averages from 2019.`
      : `Afghani per ${NAME[ccy]}: Da Afghanistan Bank daily rates, last 30 days to ${d3.utcFormat('%-d %B %Y')(parse(D.lastDate))}.`;
    $('.legend').innerHTML = full
      ? `<span><i class="sw" style="background:${css('--a')}"></i>World Bank (annual average)</span>
         <span><i class="sw" style="background:${css('--b')}"></i>Da Afghanistan Bank (monthly average)</span>`
      : `<span><i class="sw" style="background:${css('--b')}"></i>Da Afghanistan Bank (daily)</span>`;

    const series = full
      ? [{k: 'wdi', rows: D.wdi.filter(r => r[ccy] != null), col: css('--a'), name: 'World Bank', dots: true},
         {k: 'dab', rows: D.dabMonthly.filter(r => r[ccy] != null), col: css('--b'), name: 'Da Afghanistan Bank'}]
      : [{k: 'dab', rows: D.recent.filter(r => r[ccy] != null), col: css('--b'), name: 'Da Afghanistan Bank', dots: true}];
    const all = series.flatMap(s => s.rows);

    const width = holder.clientWidth || 800, narrow = width < 560;
    const m = {top: 14, right: narrow ? 12 : 20, bottom: 28, left: 46};
    const height = Math.max(260, Math.min(400, width * 0.45));
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const x = d3.scaleUtc().domain(d3.extent(all, r => r.date)).range([0, iw]);
    const ext = d3.extent(all, r => r[ccy]), pad = (ext[1] - ext[0]) * 0.12 || 1;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([ih, 0]);

    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6))
      .call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(full ? (narrow ? 5 : 10) : (narrow ? 4 : 6))
        .tickFormat(full ? d3.utcFormat('%Y') : d3.utcFormat('%-d %b')).tickSizeOuter(0));

    if (full) {   // annotate the takeover and the currency crisis
      const ann = g.append('g').attr('class', 'ann');
      const xk = x(parse('2021-08-15'));
      ann.append('line').attr('x1', xk).attr('x2', xk).attr('y1', 0).attr('y2', ih);
      ann.append('text').attr('x', xk - 4).attr('y', 12).attr('text-anchor', 'end').text('Fall of Kabul, Aug 2021');
    }

    const line = d3.line().x(r => x(r.date)).y(r => y(r[ccy]));
    series.forEach(s => {
      g.append('path').datum(s.rows).attr('class', 'line').attr('stroke', s.col).attr('d', line);
      if (s.dots) g.append('g').selectAll('circle').data(s.rows).join('circle')
        .attr('cx', r => x(r.date)).attr('cy', r => y(r[ccy])).attr('r', full ? 3 : 2.5).attr('fill', s.col);
    });

    // Hover: nearest point on each series
    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const dots = series.map(s => hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', s.col));
    const bis = d3.bisector(r => r.date).center;
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), t = x.invert(mx);
        hover.style('display', null);
        cross.attr('x1', mx).attr('x2', mx);
        let html = `<div class="dt">${full ? d3.utcFormat('%B %Y')(t) : d3.utcFormat('%-d %B %Y')(series[0].rows[bis(series[0].rows, t)].date)}</div>`;
        series.forEach((s, i) => {
          const r = s.rows[bis(s.rows, t)];
          // only show a series if its nearest point is within a year (full) or 2 days (recent)
          const near = Math.abs(r.date - t) < (full ? 366 : 2) * 864e5;
          dots[i].style('display', near ? null : 'none').attr('cx', x(r.date)).attr('cy', y(r[ccy]));
          if (near) html += `<div class="row"><span class="k" style="background:${s.col}"></span>
            <span class="nm">${s.name}${full ? (s.k === 'wdi' ? ', ' + d3.utcFormat('%Y')(r.date) : ', ' + d3.utcFormat('%b %Y')(r.date)) : ''}</span>
            <span class="v">${f2(r[ccy])}</span></div>`;
        });
        tip.innerHTML = html + `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">AFN per ${NAME[ccy]}</div>`;
        tip.hidden = false;
        const box = root.getBoundingClientRect(), hb = holder.getBoundingClientRect(), sc = hb.width / width;
        const px = (m.left + mx) * sc + (hb.left - box.left), tw = tip.offsetWidth;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (hb.top - box.top + 10) + 'px';
      });
  }

  draw();
  new ResizeObserver(() => draw()).observe(holder);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'exchange.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
