
(async function(){
  const root = document.querySelector('.viz-root');
  const [geo, prov, cfg] = await Promise.all([
    d3.json('districts.json'),
    d3.json('provinces.json').catch(() => null),
    d3.json(root.dataset.src)
  ]);
  const $ = s => root.querySelector(s);
  $('.title').textContent = cfg.title;
  $('.subtitle').textContent = cfg.subtitle;
  $('.source').textContent = cfg.source;
  const tip = $('.tooltip');
  const keys = Object.keys(cfg.metrics);
  let current = keys[0];
  // Whole numbers from 100 up; up to 2 decimals below that (trailing zeros dropped)
  const fmt = v => (Math.abs(v) >= 100 ? d3.format(',.0f') : d3.format(',.2~f'))(v);
  const ZERO = '#f0efec';

  // Controls (only if more than one measure)
  if (keys.length > 1) {
    d3.select($('.controls')).selectAll('button').data(keys).join('button')
      .text(k => cfg.metrics[k].label)
      .attr('aria-pressed', k => k === current)
      .on('click', (e, k) => { current = k; render(); });
  }

  const W = 760, H = 640;
  const svg = d3.select($('.map')).append('svg').attr('viewBox', [0, 0, W, H]);
  const defs = svg.append('defs');
  defs.append('pattern').attr('id', 'nodata').attr('width', 6).attr('height', 6)
    .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)')
    .call(p => { p.append('rect').attr('width', 6).attr('height', 6).attr('fill', '#e4e3de');
                 p.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
                  .attr('stroke', '#b5b4ae').attr('stroke-width', 1.5); });

  const projection = d3.geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], geo);
  const path = d3.geoPath(projection);
  const districts = svg.append('g').selectAll('path').data(geo.features).join('path')
    .attr('class', 'district').attr('d', path);
  if (prov) svg.append('g').selectAll('path').data(prov.features).join('path')
    .attr('class', 'province').attr('d', path);

  const PUBLIC = !!cfg.public;
  // Band per district: null = no data, 0 = zero, 1..n = classes. The public build ships
  // only bands; the full build computes them from exact values with the same rule.
  function bandOf(m, id) {
    if (PUBLIC) return m.bands[id] ?? null;
    const v = m.values[id];
    return v == null ? null : (v === 0 ? 0 : d3.bisectRight(m.breaks, v) + 1);
  }
  function fillFor(band, m) {
    return band == null ? 'url(#nodata)' : (band === 0 ? ZERO : m.ramp[band - 1]);
  }
  // Classes are [lo, hi): a value equal to a break goes in the class above it
  function bandLabel(m, band) {
    if (band == null) return 'No data';
    if (band === 0) return '0';
    const b = m.breaks, i = band - 1, lo = i === 0 ? 0 : b[i - 1], hi = b[i];
    if (m.counts) {
      const a = i === 0 ? 1 : lo, z = hi == null ? null : hi - 1;
      return z == null ? `${fmt(a)} or more` : (a === z ? fmt(a) : `${fmt(a)} to ${fmt(z)}`);
    }
    return hi == null ? `${fmt(lo)} or more` : `${i === 0 ? 'Above 0' : fmt(lo)} to under ${fmt(hi)}`;
  }

  function legend(m) {
    const rows = [{c: 'url-nodata', t: 'No data'}, {c: ZERO, t: '0'}];
    for (let band = 1; band <= m.breaks.length + 1; band++) rows.push({c: m.ramp[band - 1], t: bandLabel(m, band)});
    const L = d3.select($('.legend')).html('');
    L.append('div').style('font-size', '12px').style('color', 'var(--muted)').style('margin-bottom', '4px')
      .text(m.legendTitle);
    rows.reverse().forEach(r => {
      const row = L.append('div').attr('class', 'row');
      const sw = row.append('span').attr('class', 'sw');
      if (r.c === 'url-nodata') sw.style('background', 'repeating-linear-gradient(45deg,#e4e3de 0 3px,#b5b4ae 3px 4.5px)');
      else sw.style('background', r.c);
      row.append('span').text(r.t);
    });
  }

  function sparkline(series, colour) {
    const w = 170, h = 40, years = cfg.years;
    const x = d3.scaleLinear().domain(d3.extent(years)).range([1, w - 1]);
    const y = d3.scaleLinear().domain([0, d3.max(series, v => v ?? 0) || 1]).range([h - 2, 2]);
    const line = d3.line().defined(v => v != null).x((v, i) => x(years[i])).y(v => y(v));
    return `<svg width="${w}" height="${h}" style="display:block;margin-top:4px">
      <line x1="0" x2="${w}" y1="${h - 1}" y2="${h - 1}" stroke="var(--line)"/>
      <path d="${line(series)}" fill="none" stroke="${colour}" stroke-width="1.6"/></svg>
      <div class="cap">${years[0]}–${years[years.length - 1]}</div>`;
  }

  function render() {
    const m = cfg.metrics[current];
    d3.select($('.controls')).selectAll('button').attr('aria-pressed', k => k === current);
    districts.attr('fill', d => fillFor(bandOf(m, d.properties.shape_id), m));
    legend(m);
    let ranked;
    if (PUBLIC) {
      // No ranking in the public build: districts in the top band, alphabetically
      const top = m.breaks.length + 1;
      ranked = geo.features.filter(f => bandOf(m, f.properties.shape_id) === top)
        .map(f => ({f, v: null}))
        .sort((a, b) => d3.ascending(a.f.properties.district, b.f.properties.district));
      $('.side h3').textContent = `Districts in the highest band (${bandLabel(m, top)})`;
    } else {
      ranked = geo.features
        .map(f => ({f, v: m.values[f.properties.shape_id]}))
        .filter(d => d.v != null && d.v > 0).sort((a, b) => b.v - a.v).slice(0, 10);
    }
    d3.select($('.top')).classed('plain', PUBLIC).selectAll('li').data(ranked).join('li')
      .html(d => `${d.f.properties.district}${d.v == null ? '' : ` <span>${fmt(d.v)}</span>`}`)
      .on('mouseenter', (e, d) => districts.classed('hl', f => f === d.f))
      .on('mouseleave', () => districts.classed('hl', false));
    root.querySelector('.map').setAttribute('aria-label', `${cfg.title}: ${m.label}`);
  }

  districts
    .on('pointermove', (e, f) => {
      const m = cfg.metrics[current], id = f.properties.shape_id;
      let body;
      if (PUBLIC) {
        const band = bandOf(m, id);
        body = `<div class="v">${band == null ? 'No data' : bandLabel(m, band) + ' ' + m.unit}</div>`;
      } else {
        const v = m.values[id], s = m.series[id];
        body = `<div class="v">${v == null ? 'No data' : fmt(v) + ' ' + m.unit}</div>` +
          (s ? `<div class="cap">${m.seriesLabel}</div>` + sparkline(s, m.ramp[2]) : '');
      }
      tip.innerHTML = `<div class="nm">${f.properties.district}</div>
        <div class="pv">${f.properties.province || ''}</div>${body}`;
      tip.hidden = false;
      const r = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
      if (x + tw > r.width) x = e.clientX - r.left - tw - 14;
      if (y + th > r.height) y = e.clientY - r.top - th - 14;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    })
    .on('pointerleave', () => { tip.hidden = true; });

  root.style.position = 'relative';
  render();

  // Embedded on the website (?embed): drop page padding and tell the parent page our height
  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage(
      {type: 'viz-height', page: location.pathname.split('/').pop(),
       h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
