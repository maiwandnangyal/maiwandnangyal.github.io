
(async function(){
  const root = document.querySelector('.viz-root');
  const raw = await d3.json('exchange.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const parse = d3.utcParse('%Y-%m-%d');
  const f2 = d3.format(',.2f'), pct = d3.format('+.2%'), fDay = d3.utcFormat('%-d %B %Y');

  // An older data file (afghani against the dollar and sterling only) has another layout: convert it
  const P = raw.pairs || (() => {
    const c = k => ({wdi: raw.wdi.filter(r => r[k] != null).map(r => [r.d, r[k]]),
                     monthly: raw.dabMonthly.filter(r => r[k] != null).map(r => [r.d, r[k]]),
                     recent: raw.recent.filter(r => r[k] != null).map(r => [r.d, r[k]]),
                     last: raw.lastDate, bank: 'Da Afghanistan Bank'});
    return {AFN_USD: c('USD'), AFN_GBP: c('GBP')};
  })();
  Object.values(P).forEach(p => ['wdi', 'monthly', 'recent'].forEach(k => p[k] = p[k].map(([d, v]) => ({date: parse(d), v}))));
  if (P.AFN_PKR) {   // rupees per afghani is the same rate the other way up (stored as afghani per 100 rupees)
    const inv = a => a.map(r => ({date: r.date, v: 100 / r.v}));
    P.PKR_AFN = {wdi: inv(P.AFN_PKR.wdi), monthly: inv(P.AFN_PKR.monthly), recent: inv(P.AFN_PKR.recent),
                 last: P.AFN_PKR.last, bank: P.AFN_PKR.bank};
  }
  $('.source').textContent = raw.source;

  const NM = {AFN: 'afghani', PKR: 'Pakistani rupee', USD: 'US dollar', GBP: 'pound sterling'};
  const VS = {AFN: 'the afghani', PKR: 'the Pakistani rupee', USD: 'the US dollar', GBP: 'sterling'};
  const UNIT = {AFN: 'Afghani', PKR: 'Pakistani rupees'};
  const other = s => s === 'AFN' ? 'PKR' : 'AFN';
  const per = (s, c) => s === 'AFN' && c === 'PKR' ? '100 Pakistani rupees' : NM[c];
  let view = 'full', subj = 'AFN', vs = 'USD';
  const pair = () => P[`${subj}_${vs}`];

  const subjBtns = root.querySelectorAll('.subj button'), vsBtns = root.querySelectorAll('.against button');
  const otherBtn = root.querySelector('.against button[data-c="OTHER"]');
  subjBtns.forEach(b => { if (!P[`${b.dataset.s}_USD`]) b.hidden = true; });
  function syncButtons() {
    otherBtn.textContent = subj === 'AFN' ? 'Pakistani rupee' : 'Afghani';
    otherBtn.hidden = !P[`${subj}_${other(subj)}`];
    subjBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.s === subj));
    vsBtns.forEach(b => b.setAttribute('aria-pressed', (b.dataset.c === 'OTHER' ? other(subj) : b.dataset.c) === vs));
  }
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.v;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw();
  }));
  subjBtns.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.s === subj) return;
    const wasOther = vs === other(subj);
    subj = b.dataset.s;
    if (wasOther) vs = other(subj);            // afghani per rupee <-> rupees per afghani
    if (!pair()) vs = 'USD';
    draw();
  }));
  vsBtns.forEach(b => b.addEventListener('click', () => {
    vs = b.dataset.c === 'OTHER' ? other(subj) : b.dataset.c;
    draw();
  }));

  function stats(p) {
    const r = p.recent, a = r[0], z = r[r.length - 1];
    const ch = z.v / a.v - 1;
    const dir = ch > 0 ? 'weaker' : (ch < 0 ? 'stronger' : 'unchanged');
    $('.stats').innerHTML = `
      <div class="stat"><div class="k">Latest, ${d3.utcFormat('%-d %b %Y')(z.date)}</div>
        <div class="v">${f2(z.v)} ${subj}</div><div class="s">per ${per(subj, vs)}</div></div>
      <div class="stat"><div class="k">Change over the last 30 days</div>
        <div class="v">${pct(ch)}</div><div class="s">${NM[subj]} ${dir} against ${VS[vs]}</div></div>`;
  }

  function draw() {
    syncButtons();
    holder.innerHTML = ''; tip.hidden = true;
    const p = pair(), full = view === 'full', unit = `${UNIT[subj]} per ${per(subj, vs)}`;
    stats(p);
    $('.subtitle').textContent = full
      ? `${unit}: World Bank annual averages to ${d3.utcFormat('%Y')(p.wdi[p.wdi.length - 1].date)}, ${p.bank} monthly averages from ${d3.utcFormat('%Y')(p.monthly[0].date)}.`
      : `${unit}: ${p.bank} daily rates, last 30 days to ${fDay(parse(p.last))}` +
        (p.bank === 'State Bank of Pakistan' ? ' (the State Bank publishes them once a month).' : '.');
    $('.legend').innerHTML = full
      ? `<span><i class="sw" style="background:${css('--a')}"></i>World Bank (annual average)</span>
         <span><i class="sw" style="background:${css('--b')}"></i>${p.bank} (monthly average)</span>`
      : `<span><i class="sw" style="background:${css('--b')}"></i>${p.bank} (daily)</span>`;

    const series = full
      ? [{k: 'wdi', rows: p.wdi, col: css('--a'), name: 'World Bank', dots: true},
         {k: 'bank', rows: p.monthly, col: css('--b'), name: p.bank}]
      : [{k: 'bank', rows: p.recent, col: css('--b'), name: p.bank, dots: true}];
    const all = series.flatMap(s => s.rows);

    const width = holder.clientWidth || 800, narrow = width < 560;
    const m = {top: 14, right: narrow ? 12 : 20, bottom: 28, left: 46};
    const height = Math.max(260, Math.min(400, width * 0.45));
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const x = d3.scaleUtc().domain(d3.extent(all, r => r.date)).range([0, iw]);
    const ext = d3.extent(all, r => r.v), pad = (ext[1] - ext[0]) * 0.12 || 1;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([ih, 0]);

    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6))
      .call(s => s.select('.domain').remove());
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(full ? (narrow ? 5 : 10) : (narrow ? 4 : 6))
        .tickFormat(full ? d3.utcFormat('%Y') : d3.utcFormat('%-d %b')).tickSizeOuter(0));

    if (full && (subj === 'AFN' || vs === 'AFN')) {   // the takeover matters for any afghani rate
      const ann = g.append('g').attr('class', 'ann');
      const xk = x(parse('2021-08-15'));
      ann.append('line').attr('x1', xk).attr('x2', xk).attr('y1', 0).attr('y2', ih);
      ann.append('text').attr('x', xk - 4).attr('y', 12).attr('text-anchor', 'end').text('Fall of Kabul, Aug 2021');
    }

    const line = d3.line().x(r => x(r.date)).y(r => y(r.v));
    series.forEach(s => {
      g.append('path').datum(s.rows).attr('class', 'line').attr('stroke', s.col).attr('d', line);
      if (s.dots) g.append('g').selectAll('circle').data(s.rows).join('circle')
        .attr('cx', r => x(r.date)).attr('cy', r => y(r.v)).attr('r', full ? 3 : 2.5).attr('fill', s.col);
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
        let html = `<div class="dt">${full ? d3.utcFormat('%B %Y')(t) : fDay(series[0].rows[bis(series[0].rows, t)].date)}</div>`;
        series.forEach((s, i) => {
          const r = s.rows[bis(s.rows, t)];
          // only show a series if its nearest point is within a year (full) or 2 days (recent)
          const near = Math.abs(r.date - t) < (full ? 366 : 2) * 864e5;
          dots[i].style('display', near ? null : 'none').attr('cx', x(r.date)).attr('cy', y(r.v));
          if (near) html += `<div class="row"><span class="k" style="background:${s.col}"></span>
            <span class="nm">${s.name}${full ? (s.k === 'wdi' ? ', ' + d3.utcFormat('%Y')(r.date) : ', ' + d3.utcFormat('%b %Y')(r.date)) : ''}</span>
            <span class="v">${f2(r.v)}</span></div>`;
        });
        tip.innerHTML = html + `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">${subj} per ${per(subj, vs)}</div>`;
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
