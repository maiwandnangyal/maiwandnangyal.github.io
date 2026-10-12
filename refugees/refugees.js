
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('refugees.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const Y = D.years, H = D.hosts, S = D.summary;
  const col = id => css('--' + id);
  const full = d3.format(','), m2 = d3.format('.2f');
  const big = v => v >= 1e6 ? d3.format('.2~f')(v / 1e6) + ' million' : full(v);   // tiles and notes
  const axisM = v => v === 0 ? '0' : d3.format('~g')(v / 1e6) + 'm';        // axis ticks
  const date = s => d3.utcFormat('%-d %b %Y')(d3.utcParse('%Y-%m-%d')(s));
  $('.source').textContent = D.source;
  let view = 'abroad';

  const TXT = {
    abroad: {
      sub: 'Afghan refugees, asylum-seekers and others in need of international protection, by host country, at the end of each year.',
      note: 'Iran’s jump in 2022 mostly reflects about 2.6 million previously undocumented Afghans who registered in a government headcount and were then counted by UNHCR, not new arrivals on that scale.',
      aria: 'Stacked area chart of Afghans abroad by host country'
    },
    returns: {
      sub: 'Refugees recorded by UNHCR as returning to Afghanistan each year, by the country they left.',
      note: 'Recent returns include deportations and people leaving under pressure.' + (S.allReturnsYear
        ? ` Counting undocumented Afghans as well, UNHCR puts all returns at ${big(S.allReturnsYear)} in 2025.` : ''),
      aria: 'Stacked bar chart of refugee returns to Afghanistan by the country they left'
    }
  };

  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.v;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw();
  }));

  $('.stats').innerHTML = `
    <div class="stat"><div class="k">Afghans abroad under UNHCR’s mandate, end ${S.latest}</div>
      <div class="v">${big(S.total)}</div>
      <div class="s">${S.peakYear === S.latest ? 'the highest on record' : `down from ${big(S.peakTotal)} at the end of ${S.peakYear}`}</div></div>
    <div class="stat"><div class="k">Refugee returns recorded in ${S.latest}</div>
      <div class="v">${big(S.returns)}</div>
      <div class="s">${S.returnsMostSince ? `the most since ${S.returnsMostSince} (${big(S.returnsThen)})` : 'the most on record'}</div></div>
    <div class="stat"><div class="k">All returns since October 2023, any status</div>
      <div class="v">${big(S.allReturns)}</div>
      <div class="s">including undocumented Afghans; UNHCR, ${date(S.allReturnsAsOf)}</div></div>`;
  $('.legend').innerHTML = [...H].reverse().map(h =>
    `<span><i class="sw" style="background:${col(h.id)}"></i>${h.name}</span>`).join('');

  function rowsFor(v) {
    const from = v === 'returns' ? D.returnsFrom : Y[0];
    return Y.map((y, i) => { const r = {year: y}; H.forEach(h => r[h.id] = D[v][h.id][i]); r.total = d3.sum(H, h => r[h.id]); return r; })
      .filter(r => r.year >= from);
  }

  function tipHtml(r, v) {
    const head = v === 'abroad' ? `End of ${r.year}` : `Returned in ${r.year}`;
    return `<div class="dt">${head}</div>` + [...H].reverse().map(h =>
      `<div class="row"><span class="k" style="background:${col(h.id)}"></span><span class="nm">${h.name}</span>
       <span class="v">${full(r[h.id])}</span></div>`).join('') +
      `<div class="row tot"><span class="k"></span><span class="nm">Total</span><span class="v">${full(r.total)}</span></div>`;
  }
  function placeTip(px) {          // px: x position inside the root, in CSS pixels
    tip.hidden = false;
    const box = root.getBoundingClientRect(), hb = holder.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
    tip.style.top = (hb.top - box.top + 10) + 'px';
  }

  function draw() {
    holder.innerHTML = ''; tip.hidden = true;
    const T = TXT[view], rows = rowsFor(view), abroad = view === 'abroad';
    $('.subtitle').textContent = T.sub; $('.note').textContent = T.note;
    holder.setAttribute('aria-label', T.aria + `, ${rows[0].year} to ${rows[rows.length - 1].year}`);

    const width = Math.max(holder.clientWidth || 800, 240), narrow = width < 560;
    const m = {top: 16, right: abroad && !narrow ? 112 : (narrow ? 10 : 20), bottom: 28, left: 40};
    const height = Math.max(280, Math.min(440, width * 0.5));
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const y = d3.scaleLinear().domain([0, d3.max(rows, r => r.total) * 1.1]).nice().range([ih, 0]);
    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(axisM).tickSize(0).tickPadding(6))
      .call(s => s.select('.domain').remove());
    const stack = d3.stack().keys(H.map(h => h.id))(rows);
    const sc = () => holder.getBoundingClientRect().width / width;       // SVG units to CSS pixels
    const offX = () => holder.getBoundingClientRect().left - root.getBoundingClientRect().left;

    if (abroad) {
      const x = d3.scaleLinear().domain([rows[0].year, rows[rows.length - 1].year]).range([0, iw]);
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
        .call(d3.axisBottom(x).ticks(narrow ? 5 : 10).tickFormat(d3.format('d')).tickSizeOuter(0));
      const area = d3.area().x(d => x(d.data.year)).y0(d => y(d[0])).y1(d => y(d[1]));
      g.append('g').selectAll('path').data(stack).join('path').attr('class', 'layer')
        .attr('fill', s => col(s.key)).attr('d', area);

      // Events: the points are end-of-year values, so a date t sits at t - 1 on this axis
      const ann = g.append('g').attr('class', 'ann');
      D.events.forEach((e, i) => {
        const xe = x(e.t - 1); if (xe < 0 || xe > iw) return;
        ann.append('line').attr('x1', xe).attr('x2', xe).attr('y1', 0).attr('y2', ih);
        ann.append('text').attr('x', xe - 4).attr('y', 11 + (i === D.events.length - 1 ? 15 : 0))
          .attr('text-anchor', 'end').text(narrow ? e.label.replace(/,.*$/, '') : e.label);
      });

      if (!narrow) {       // direct labels at the right end, nudged apart so they never collide
        const last = stack.map(s => ({s, y: y((s[s.length - 1][0] + s[s.length - 1][1]) / 2)})).sort((a, b) => a.y - b.y);
        for (let i = 1; i < last.length; i++) if (last[i].y - last[i - 1].y < 14) last[i].y = last[i - 1].y + 14;
        last.forEach(e => g.append('text').attr('class', 'lab').attr('x', iw + 8).attr('y', e.y + 4)
          .text(H.find(h => h.id === e.s.key).name));
      }

      const hover = g.append('g').style('display', 'none');
      const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
      const dots = stack.map(s => hover.append('circle').attr('class', 'dot').attr('r', 4).attr('fill', col(s.key)));
      const bis = d3.bisector(r => r.year).center;
      svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
        .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
        .on('pointermove', e => {
          const [mx] = d3.pointer(e, g.node()), i = bis(rows, x.invert(mx)), r = rows[i];
          hover.style('display', null);
          cross.attr('x1', x(r.year)).attr('x2', x(r.year));
          stack.forEach((s, k) => dots[k].attr('cx', x(r.year)).attr('cy', y(s[i][1])));
          tip.innerHTML = tipHtml(r, view);
          placeTip((m.left + x(r.year)) * sc() + offX());
        });
    } else {
      const x = d3.scaleBand().domain(rows.map(r => r.year)).range([0, iw]).paddingInner(0.22).paddingOuter(0.1);
      const every = narrow ? 10 : 5;
      g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
        .call(d3.axisBottom(x).tickValues(rows.map(r => r.year).filter(v => v % every === 0)).tickSizeOuter(0));
      const bars = g.append('g').selectAll('g').data(stack).join('g').attr('fill', s => col(s.key));
      bars.selectAll('rect').data(s => s.map(d => ({d, key: s.key}))).join('rect').attr('class', 'seg')
        .attr('x', o => x(o.d.data.year)).attr('width', x.bandwidth())
        .attr('y', o => y(o.d[1])).attr('height', o => Math.max(0, y(o.d[0]) - y(o.d[1])));

      // Direct labels on the two largest years only
      [...rows].sort((a, b) => b.total - a.total).slice(0, 2).forEach(r => {
        const cx = x(r.year) + x.bandwidth() / 2;
        g.append('text').attr('class', 'peak').attr('y', y(r.total) - 6)
          .attr('x', Math.min(iw - 34, Math.max(34, cx))).text(`${m2(r.total / 1e6)}m in ${r.year}`);
      });

      const step = x.step();
      svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
        .on('pointerleave', () => { g.selectAll('.seg').classed('dim', false); tip.hidden = true; })
        .on('pointermove', e => {
          const [mx] = d3.pointer(e, g.node());
          const i = Math.max(0, Math.min(rows.length - 1, Math.floor((mx - x(rows[0].year) + (step - x.bandwidth()) / 2) / step)));
          const r = rows[i];
          g.selectAll('.seg').classed('dim', o => o.d.data.year !== r.year);
          tip.innerHTML = tipHtml(r, view);
          placeTip((m.left + x(r.year) + x.bandwidth() / 2) * sc() + offX());
        });
    }
  }

  // Table view of everything the two charts show
  (function table() {
    const a = rowsFor('abroad'), ret = Object.fromEntries(rowsFor('returns').map(r => [r.year, r]));
    const head = `<tr><th>Year</th>${H.map(h => `<th>${h.name}</th>`).join('')}<th>Total abroad</th>` +
      `${H.map(h => `<th>Returned from ${h.name === 'Other countries' ? 'elsewhere' : h.name}</th>`).join('')}</tr>`;
    const body = [...a].reverse().map(r => `<tr><td>${r.year}</td>${H.map(h => `<td>${full(r[h.id])}</td>`).join('')}` +
      `<td>${full(r.total)}</td>${H.map(h => `<td>${ret[r.year] ? full(ret[r.year][h.id]) : '–'}</td>`).join('')}</tr>`).join('');
    $('.table-wrap').innerHTML = `<table>${head}${body}</table>`;
  })();

  draw();
  let lastW = 0;
  new ResizeObserver(() => { const w = holder.clientWidth; if (Math.abs(w - lastW) < 2) return; lastW = w; draw(); }).observe(holder);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'refugees.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
