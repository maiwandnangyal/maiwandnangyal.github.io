
(async function(){
  const root = document.querySelector('.viz-root');
  const D = await d3.json('inflation.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  const css = v => getComputedStyle(root).getPropertyValue(v).trim();
  const holder = $('.chart'), tip = $('.tooltip');
  const C = ['AFG', 'PAK'], NM = {AFG: 'Afghanistan', PAK: 'Pakistan'};
  const col = c => css(c === 'AFG' ? '--a' : '--b');
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pc = v => d3.format('.1f')(v) + '%';          // d3 writes a proper minus sign
  const mname = m => MON[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
  const NOTE = {weo: 'IMF estimate, older price index', cpi: 'from the monthly index'};
  $('.source').textContent = D.source;

  // 'This year' is the latest year either country has a figure for
  const YEAR = Math.max(...C.map(c => +D.last[c].slice(0, 4)));
  const ANN = {}, MONTHS = {};
  C.forEach(c => {
    ANN[c] = D.annual[c].map(([y, v, s]) => ({x: y, v, s}));
    if (D.ytd[c]) ANN[c].ytd = {x: D.ytd[c][0], v: D.ytd[c][2], n: D.ytd[c][1], s: 'ytd'};
    MONTHS[c] = new Map(D.months[c].map(([m, v]) => [m, v]));
  });
  const thisYear = c => D.months[c].filter(([m]) => +m.slice(0, 4) === YEAR).map(([m, v]) => ({x: +m.slice(5), m, v}));

  let view = 'hist';
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.v;
    root.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    draw();
  }));

  function stats() {
    const dot = c => `<i style="background:${col(c)}"></i>`;
    $('.stats').innerHTML = C.map(c => {
      if (view === 'hist') {
        const a = ANN[c][ANN[c].length - 1];
        return `<div class="stat"><div class="k">${dot(c)}${NM[c]}, ${a.x}</div><div class="v">${pc(a.v)}</div>
          <div class="s">average prices ${a.v >= 0 ? 'up' : 'down'} on ${a.x - 1}</div></div>`;
      }
      const ms = thisYear(c), last = D.months[c][D.months[c].length - 1], y = D.ytd[c];
      const so = y && y[0] === YEAR ? `; ${YEAR} so far ${pc(y[2])}` : '';
      return `<div class="stat"><div class="k">${dot(c)}${NM[c]}, ${mname(last[0])}</div><div class="v">${pc(last[1])}</div>
        <div class="s">${ms.length ? `prices ${last[1] >= 0 ? 'up' : 'down'} on a year earlier${so}` : `no ${YEAR} figures yet`}</div></div>`;
    }).join('');
  }

  function frame(width, top) {
    const narrow = width < 560;
    const m = {top, right: narrow ? 14 : 22, bottom: 28, left: 40};
    const height = Math.max(270, Math.min(420, width * 0.46));
    return {narrow, m, height, iw: width - m.left - m.right, ih: height - m.top - m.bottom};
  }

  function yAxis(g, y, iw) {
    g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(6).tickSize(-iw).tickFormat(''));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickSize(0).tickPadding(6).tickFormat(d => d3.format('d')(d) + '%'))
      .call(s => s.select('.domain').remove());
    g.append('line').attr('class', 'zero').attr('x1', 0).attr('x2', iw).attr('y1', y(0)).attr('y2', y(0));
  }

  function place(e, g, mx, width, m) {
    tip.hidden = false;
    const box = root.getBoundingClientRect(), hb = holder.getBoundingClientRect(), sc = hb.width / width;
    const px = (m.left + mx) * sc + (hb.left - box.left), tw = tip.offsetWidth;
    tip.style.left = Math.max(0, px + 14 + tw > box.width ? px - 14 - tw : px + 14) + 'px';
    tip.style.top = (hb.top - box.top + 10) + 'px';
  }

  function drawHist() {
    const width = holder.clientWidth || 800, F = frame(width, 14), {m, iw, ih} = F;
    const pts = C.flatMap(c => ANN[c].ytd ? [...ANN[c], ANN[c].ytd] : ANN[c]);
    const x0 = d3.min(pts, p => p.x), x1 = d3.max(pts, p => p.x);
    const x = d3.scaleLinear().domain([x0, x1]).range([0, iw]);
    const ext = d3.extent([0, ...pts.map(p => p.v)]), pad = (ext[1] - ext[0]) * 0.06;
    const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([ih, 0]);
    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, F.height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    yAxis(g, y, iw);
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(F.narrow ? 5 : 10).tickFormat(d3.format('d')).tickSizeOuter(0));

    const ann = g.append('g').attr('class', 'ann'), xk = x(2021 + 7.5 / 12);
    ann.append('line').attr('x1', xk).attr('x2', xk).attr('y1', 0).attr('y2', ih);
    ann.append('text').attr('x', xk - 4).attr('y', 12).attr('text-anchor', 'end').text('Fall of Kabul, Aug 2021');

    const line = d3.line().x(p => x(p.x)).y(p => y(p.v));
    const dots = iw / (x1 - x0) >= 8;            // room for a dot on every year?
    C.forEach(c => {
      const a = ANN[c], main = a.filter(p => p.s !== 'weo'), early = a.filter(p => p.s === 'weo');
      g.append('path').datum(main).attr('class', 'line').attr('stroke', col(c)).attr('d', line);
      if (early.length) g.append('path').datum([...early, main[0]]).attr('class', 'line est').attr('stroke', col(c)).attr('d', line);
      if (a.ytd) g.append('path').datum([main[main.length - 1], a.ytd]).attr('class', 'line est').attr('stroke', col(c)).attr('d', line);
      if (dots) g.append('g').selectAll('circle').data(main).join('circle')
        .attr('cx', p => x(p.x)).attr('cy', p => y(p.v)).attr('r', 2.4).attr('fill', col(c));
      g.append('g').selectAll('circle').data(a.ytd ? [...early, a.ytd] : early).join('circle').attr('class', 'hollow')
        .attr('cx', p => x(p.x)).attr('cy', p => y(p.v)).attr('r', 3.6).attr('stroke', col(c));
    });

    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const hd = Object.fromEntries(C.map(c => [c, hover.append('circle').attr('class', 'dot').attr('r', 4.5).attr('fill', col(c))]));
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), yr = Math.max(x0, Math.min(x1, Math.round(x.invert(mx))));
        hover.style('display', null);
        cross.attr('x1', x(yr)).attr('x2', x(yr));
        let html = `<div class="dt">${yr}</div>`;
        C.forEach(c => {
          const p = ANN[c].find(q => q.x === yr) || (ANN[c].ytd && ANN[c].ytd.x === yr ? ANN[c].ytd : null);
          hd[c].style('display', p ? null : 'none');
          if (!p) return;
          hd[c].attr('cx', x(p.x)).attr('cy', y(p.v));
          html += `<div class="row"><span class="k" style="background:${col(c)}"></span><span class="nm">${NM[c]}</span><span class="v">${pc(p.v)}</span></div>`;
          const note = p.s === 'ytd' ? `${p.n === 1 ? 'January only' : `January to ${MON[p.n - 1]}`}, against the same months of ${yr - 1}` : NOTE[p.s];
          if (note) html += `<div class="note">${note}</div>`;
        });
        tip.innerHTML = html + `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">Average prices against ${yr - 1}</div>`;
        place(e, g, x(yr), width, m);
      });
  }

  function drawYear() {
    const width = holder.clientWidth || 800, F = frame(width, 14), {m, iw, ih} = F;
    const S = C.map(c => ({c, rows: thisYear(c)})).filter(s => s.rows.length);
    const x = d3.scaleLinear().domain([0.6, 12.4]).range([0, iw]);
    const vals = S.flatMap(s => s.rows.map(r => r.v));
    const ext = d3.extent([0, ...vals]), pad = (ext[1] - ext[0]) * 0.1 || 1;
    const y = d3.scaleLinear().domain([ext[0] < 0 ? ext[0] - pad : 0, ext[1] + pad]).nice().range([ih, 0]);
    const svg = d3.select(holder).append('svg').attr('viewBox', [0, 0, width, F.height]);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    yAxis(g, y, iw);
    const short = iw / 12 < 30;
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(d3.range(1, 13)).tickFormat(i => short ? MON[i - 1][0] : MON[i - 1].slice(0, 3)).tickSizeOuter(0));

    const line = d3.line().x(r => x(r.x)).y(r => y(r.v));
    S.forEach(s => {
      g.append('path').datum(s.rows).attr('class', 'line').attr('stroke', col(s.c)).attr('d', line);
      g.append('g').selectAll('circle').data(s.rows).join('circle')
        .attr('cx', r => x(r.x)).attr('cy', r => y(r.v)).attr('r', 3.4).attr('fill', col(s.c));
    });
    // value labels at the end of each line, nudged apart if they would overlap
    const ends = S.map(s => ({c: s.c, r: s.rows[s.rows.length - 1]})).map(e => ({...e, ly: y(e.r.v)}));
    ends.sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 15) {
      const mid = (ends[i].ly + ends[i - 1].ly) / 2; ends[i - 1].ly = mid - 7.5; ends[i].ly = mid + 7.5;
    }
    ends.forEach(e => g.append('text').attr('class', 'lab').attr('fill', col(e.c)).attr('x', x(e.r.x) + 8).attr('y', e.ly + 4)
      .text(pc(e.r.v)));

    const hover = g.append('g').style('display', 'none');
    const cross = hover.append('line').attr('class', 'cross').attr('y1', 0).attr('y2', ih);
    const hd = Object.fromEntries(C.map(c => [c, hover.append('circle').attr('class', 'dot').attr('r', 5).attr('fill', col(c))]));
    const lastX = d3.max(S.flatMap(s => s.rows.map(r => r.x)));
    svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', e => {
        const [mx] = d3.pointer(e, g.node()), mo = Math.max(1, Math.min(lastX, Math.round(x.invert(mx))));
        hover.style('display', null);
        cross.attr('x1', x(mo)).attr('x2', x(mo));
        let html = `<div class="dt">${MON[mo - 1]} ${YEAR}</div>`;
        C.forEach(c => {
          const key = `${YEAR}-${String(mo).padStart(2, '0')}`, v = MONTHS[c].get(key);
          const before = MONTHS[c].get(`${YEAR - 1}-${String(mo).padStart(2, '0')}`);
          hd[c].style('display', v == null ? 'none' : null);
          if (v != null) hd[c].attr('cx', x(mo)).attr('cy', y(v));
          html += `<div class="row"><span class="k" style="background:${col(c)}"></span><span class="nm">${NM[c]}</span>
            <span class="v">${v == null ? 'not yet out' : pc(v)}</span></div>`;
          if (before != null) html += `<div class="note">${MON[mo - 1]} ${YEAR - 1}: ${pc(before)}</div>`;
        });
        tip.innerHTML = html + `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">Prices against the same month a year earlier</div>`;
        place(e, g, x(mo), width, m);
      });
  }

  function draw() {
    holder.innerHTML = ''; tip.hidden = true;
    stats();
    const sw = c => `<span><i class="sw" style="background:${col(c)}"></i>${NM[c]}</span>`;
    if (view === 'hist') {
      const first = Object.fromEntries(C.map(c => [c, ANN[c][0].x]));
      const ys = [...new Set(C.filter(c => ANN[c].ytd).map(c => ANN[c].ytd.x))];
      const ytd = ys.length === 1 ? ys[0] : ys.length ? 'latest year' : '';
      const early = ANN.AFG.filter(p => p.s === 'weo').map(p => p.x);
      const yrs = early.length === 2 ? early.join(' and ') : early.length ? `${early[0]} to ${early[early.length - 1]}` : '';
      $('.subtitle').textContent = `Average consumer prices over each year compared with the year before: Pakistan from ${first.PAK}, Afghanistan from ${first.AFG}.`;
      const ring = [yrs && `IMF estimates for Afghanistan, ${yrs}`, ytd && `${ytd} so far`].filter(Boolean).join('; ');
      $('.legend').innerHTML = sw('AFG') + sw('PAK') + (ring ? `<span><i class="ring"></i>${ring}</span>` : '');
      drawHist();
    } else {
      const last = d3.max(C.map(c => D.last[c])), lag = C.filter(c => D.last[c] < last);
      $('.subtitle').textContent = `Consumer prices in each month of ${YEAR} compared with the same month a year earlier.` +
        (lag.length ? ` ${lag.map(c => NM[c]).join(' and ')}'s latest figure is for ${MON[+D.last[lag[0]].slice(5) - 1]}${+D.last[lag[0]].slice(0, 4) === YEAR ? '' : ' ' + D.last[lag[0]].slice(0, 4)}.` : '');
      $('.legend').innerHTML = sw('AFG') + sw('PAK');
      drawYear();
    }
  }

  draw();
  new ResizeObserver(() => draw()).observe(holder);

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage({type: 'viz-height', page: 'inflation.html',
      h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
