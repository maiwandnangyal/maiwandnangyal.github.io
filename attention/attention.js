
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('attention.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const parse = d3.utcParse('%Y-%m-%d');
  ['monthly', 'daily'].forEach(k => D[k].forEach(r => r.date = parse(r.d)));
  const S = D.summary, f1 = d3.format('.1f'), f2 = d3.format('.2f');
  $('.source').textContent = D.source;
  $('.note').textContent =
    `In ${d3.utcFormat('%B %Y')(parse(S.peakMonth))}, Wikipedia views were ${f1(S.peakWiki)} times their ${D.base} average ` +
    `and news coverage ${f1(S.peakNews)} times. Since 2023, Wikipedia views have averaged ${f2(S.afterWiki)} times ` +
    `the earlier level, news coverage ${f2(S.afterNews)} times.`;
  let mode = 'monthly';
  const SUB = {
    monthly: `Monthly averages, each divided by its own ${D.base} average (1 = a normal month). 2021 is shaded.`,
    daily: `2021 day by day, each divided by its own ${D.base} daily average (1 = a normal day).`
  };

  d3.selectAll(root.querySelectorAll('.controls button')).on('click', function(){
    mode = this.dataset.k;
    root.querySelectorAll('.controls button').forEach(b => b.setAttribute('aria-pressed', b === this));
    draw();
  });

  function draw(){
    holder.innerHTML = ''; tip.hidden = true;
    $('.subtitle').textContent = SUB[mode];
    const rows = D[mode];
    const width = holder.clientWidth || 800, narrow = width < 560;
    const m = {top: 18, right: narrow ? 12 : 20, bottom: 28, left: 40};
    const height = Math.max(280, Math.min(440, width * 0.5));
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const x = d3.scaleUtc().domain(d3.extent(rows, r => r.date)).range([0, iw]);
    const ymax = d3.max(rows, r => Math.max(r.wi, r.ni ?? 0));
    const y = d3.scaleLinear().domain([0, ymax * 1.08]).nice().range([ih, 0]);
    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (mode === 'monthly') {
      g.append('rect').attr('class', 'focus-band')
        .attr('x', x(parse('2021-01-01'))).attr('width', x(parse('2022-01-01')) - x(parse('2021-01-01')))
        .attr('y', 0).attr('height', ih);
    }
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(v => v + '×').tickSize(0).tickPadding(6))
      .call(s => s.select('.domain').remove());
    const xt = mode === 'monthly' ? d3.utcYear.every(narrow ? 2 : 1) : d3.utcMonth.every(narrow ? 2 : 1);
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(xt).tickFormat(mode === 'monthly' ? d3.utcFormat('%Y') : d3.utcFormat('%b')).tickSizeOuter(0));
    g.append('line').attr('class', 'base').attr('x1', 0).attr('x2', iw).attr('y1', y(1)).attr('y2', y(1));

    if (mode === 'daily') {
      const ev = g.append('g').attr('class', 'ev');
      D.events.forEach((e, i) => {
        const xe = x(parse(e.d));
        ev.append('line').attr('x1', xe).attr('x2', xe).attr('y1', 0).attr('y2', ih);
        // Stagger labels: April on the right; the three August events stacked to the left
        const left = i > 0, yy = 12 + (i === 0 ? 0 : i * 15);
        ev.append('text').attr('x', xe + (left ? -4 : 4)).attr('y', yy)
          .attr('text-anchor', left ? 'end' : 'start')
          .text(`${e.label} (${d3.utcFormat('%-d %b')(parse(e.d))})`);
      });
    }

    const line = k => d3.line().defined(r => r[k] != null).x(r => x(r.date)).y(r => y(r[k]));
    g.append('path').datum(rows).attr('class', 'line').attr('stroke', css('--n')).attr('d', line('ni'));
    g.append('path').datum(rows).attr('class', 'line').attr('stroke', css('--w')).attr('d', line('wi'));

    if (mode === 'monthly') {   // label the peak
      const p = rows.reduce((a, b) => (b.wi > a.wi ? b : a));
      const pk = g.append('g').attr('class', 'peak');
      pk.append('text').attr('x', x(p.date) + 10).attr('y', y(p.wi) + 4).text('Fall of Kabul, August 2021');
    }

    // Hover
    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const dw = hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', css('--w'));
    const dn = hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', css('--n'));
    const bis = d3.bisector(r => r.date).center;
    const fmtDate = mode === 'monthly' ? d3.utcFormat('%B %Y') : d3.utcFormat('%-d %B %Y');
    const views = d3.format(',.0f');
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node());
        const r = rows[bis(rows, x.invert(mx))];
        hover.style('display', null);
        cross.attr('x1', x(r.date)).attr('x2', x(r.date));
        dw.attr('cx', x(r.date)).attr('cy', y(r.wi));
        dn.style('display', r.ni == null ? 'none' : null).attr('cx', x(r.date)).attr('cy', r.ni == null ? 0 : y(r.ni));
        const per = mode === 'monthly' ? ' a day on average' : '';
        tip.innerHTML = `<div class="dt">${fmtDate(r.date)}</div>
          <div class="row"><span class="k" style="background:${css('--w')}"></span><span class="nm">Wikipedia views</span><span class="v">${f1(r.wi)}×</span></div>
          <div class="raw">${views(r.wr)} views${per}</div>
          <div class="row"><span class="k" style="background:${css('--n')}"></span><span class="nm">Share of online news</span><span class="v">${r.ni == null ? 'no data' : f1(r.ni) + '×'}</span></div>
          ${r.nr == null ? '' : `<div class="raw">${f2(r.nr)}% of articles${per}</div>`}`;
        tip.hidden = false;
        const box = root.getBoundingClientRect(), hb = holder.getBoundingClientRect(), sc = hb.width / width;
        const px = (m.left + x(r.date)) * sc + (hb.left - box.left), tw = tip.offsetWidth;
        tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
        tip.style.top = (hb.top - box.top + 10) + 'px';
      });
  }

  draw();
  new ResizeObserver(() => draw()).observe(holder);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'attention.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
