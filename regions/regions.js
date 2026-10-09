
(async function(){
  const root = document.querySelector('.viz-root');
  const data = await d3.json('regions.json?v=' + (root.dataset.v || ''));
  const $ = s => root.querySelector(s);
  $('.source').textContent = data.source;
  const tip = $('.tooltip');
  const feats = data.regions.features;

  const W = 760, H = 700;
  const svg = d3.select($('.map')).append('svg').attr('viewBox', [0, 0, W, H]);
  const projection = d3.geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], data.regions);
  const path = d3.geoPath(projection);

  const byId = Object.fromEntries(feats.map(f => [f.properties.id, f]));
  svg.append('path').datum(data.context).attr('class', 'context').attr('d', path);
  const units = svg.append('g').selectAll('path').data(data.units.features).join('path')
    .attr('class', 'unit').attr('d', path)
    .attr('fill', d => byId[d.properties.region].properties.colour);
  const outlines = svg.append('g').selectAll('path').data(feats).join('path')
    .attr('class', 'outline').attr('d', path);
  const hl = svg.append('path').attr('class', 'unit-hl');   // outline of the hovered unit

  const lab = svg.append('g');
  lab.selectAll('line').data(feats.filter(d => d.properties.leader)).join('line')
    .attr('class', 'leader')
    .attr('x1', d => projection(d.properties.label)[0] + 3)
    .attr('y1', d => projection(d.properties.label)[1] - 4)
    .attr('x2', d => projection(d.properties.leader)[0])
    .attr('y2', d => projection(d.properties.leader)[1]);
  lab.selectAll('text').data(feats).join('text').attr('class', 'lbl')
    .attr('x', d => projection(d.properties.label)[0])
    .attr('y', d => projection(d.properties.label)[1])
    .style('text-anchor', d => d.properties.anchor || 'middle')
    .text(d => d.properties.name);

  const items = d3.select($('.list')).selectAll('li').data(feats).join('li')
    .html(d => `<span class="sw" style="background:${d.properties.colour}"></span>
      <span><span class="nm">${d.properties.name}</span><br>
      <span class="ct">${d.properties.n_units} ${d.properties.id === 'fata' ? 'tribal agencies and Frontier Regions' : 'districts'}</span></span>`);

  function focus(regionId, unit) {
    $('.map').classList.toggle('focus', !!regionId);
    units.classed('on', d => d.properties.region === regionId);
    items.classed('on', d => d.properties.id === regionId);
    hl.attr('d', unit ? path(unit) : null);
  }
  function place(e) {
    tip.hidden = false;
    const r = root.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + tw > r.width) x = Math.max(0, e.clientX - r.left - tw - 14);
    if (y + th > r.height) y = Math.max(0, e.clientY - r.top - th - 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hide() { tip.hidden = true; focus(null, null); }

  units.on('pointermove', (e, u) => {
    const p = byId[u.properties.region].properties, q = u.properties;
    focus(q.region, u);
    tip.innerHTML = `<div class="un">${q.name}</div>
      <div class="uk">${q.kind}${q.parent ? ', ' + q.parent : ''}</div>
      <div class="nm"><span class="sw" style="background:${p.colour}"></span>${p.name}</div>`;
    place(e);
  }).on('pointerleave', hide);
  items.on('mouseenter', (e, f) => focus(f.properties.id, null)).on('mouseleave', () => focus(null, null));

  if (new URLSearchParams(location.search).has('embed')) {
    document.body.classList.add('embed');
    const send = () => parent.postMessage(
      {type: 'viz-height', page: 'regions.html',
       h: Math.ceil(document.documentElement.getBoundingClientRect().height)}, '*');
    new ResizeObserver(send).observe(document.documentElement);
    send();
  }
})();
