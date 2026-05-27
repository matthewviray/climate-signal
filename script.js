// v2 layout: two large independently-rendered maps above one full-width line chart.
const SCENARIOS = ['ssp126', 'ssp245', 'ssp585'];
const REGION_COLORS = ['#8f1d14', '#123f73'];

d3.json('data/cmip6_data.json').then(DATA => {
  const GRID = { lat: DATA.meta.lat, lon: DATA.meta.lon };
  const N_LON = GRID.lon.length;
  const N_LAT = GRID.lat.length;
  const DECADES = { historical: DATA.meta.decades_hist, future: DATA.meta.decades_fut };
  const FIELDS = DATA.fields;
  const GLOBAL_MEAN_BY_FEATURE = DATA.global_mean;

  const state = {
    scenario: 'ssp245',
    feature: 'tas',
    compareDecades: [2050, 2090],
    regions: []
  };

  const MAP_W = 1200, MAP_H = 620;
  const LINE_W = 1600, LINE_H = 360;
  const DLON = 5.0, DLAT = 3.77;
  const projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [MAP_W - 6, MAP_H - 6]], {type: 'Sphere'});
  const pathGen = d3.geoPath(projection);
  let LAND = null;

  const SCALES = {
    tas:    { domain: [-6, 6],    interp: d3.interpolateRdBu,  reverse: true,  label: 'Δ°C',       fmt: d => d3.format('+.1f')(d) + '°C' },
    pr:     { domain: [-30, 30],  interp: d3.interpolateBrBG,  reverse: false, label: 'Δ% precip', fmt: d => d3.format('+.0f')(d) + '%' },
    siconc: { domain: [1, 85],    interp: d3.interpolateRgbBasis(['#f5f0e8','#c8dff0','#85b7eb','#185FA5','#042C53']), reverse: false, label: '% ice cover', fmt: d => d3.format('.0f')(d) + '%' }
  };

  const FEATURE_META = {
    tas: { title: 'Temperature anomaly maps', sub: 'Δ°C vs 1850–1900 baseline', y: 'Anomaly (°C)', notes: `<strong>Temperature anomaly.</strong> Each map shows the selected decade under the active scenario. Brush the line chart to choose two decades; drag boxes on the maps to compare up to two regions against the global mean.` },
    pr: { title: 'Precipitation anomaly maps', sub: 'Δ% vs 1850–1900 baseline', y: 'Anomaly (%)', notes: `<strong>Precipitation anomaly.</strong> Blue cells are wetter than the pre-industrial baseline; brown cells are drier. The side-by-side maps make temporal comparison easier than a single animated map.` },
    siconc: { title: 'Sea ice concentration maps', sub: '% ocean covered by ice', y: 'Ice cover (%)', notes: `<strong>Sea ice concentration.</strong> Dark-blue cells are mostly ice-covered; white/light cells are open ocean. The side-by-side maps compare ice cover between two selected decades.` }
  };

  function colorFor(value, feature) {
    const s = SCALES[feature];
    const t = (value - s.domain[0]) / (s.domain[1] - s.domain[0]);
    const clamped = Math.max(0, Math.min(1, t));
    return s.interp(s.reverse ? 1 - clamped : clamped);
  }

  function fieldFor(feature, scen, decade) {
    const fd = FIELDS[feature];
    if (!fd) return null;
    const key = String(decade);
    if (decade < 2015) return fd.historical?.[key] ?? null;
    return fd[scen]?.[key] ?? null;
  }

  function cellRect(latIdx, lonIdx) {
    const lat = GRID.lat[latIdx], lon = GRID.lon[lonIdx];
    const p0 = projection([lon - DLON/2, lat + DLAT/2]);
    const p1 = projection([lon + DLON/2, lat - DLAT/2]);
    if (!p0 || !p1) return null;
    return { x: p0[0], y: p0[1], w: p1[0] - p0[0], h: p1[1] - p0[1], lat, lon, latIdx, lonIdx };
  }

  function screenToCell(svgX, svgY) {
    const geo = projection.invert([svgX, svgY]);
    if (!geo || !isFinite(geo[0]) || !isFinite(geo[1])) return null;
    const [lon, lat] = geo;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    const i = Math.round((lat - GRID.lat[0]) / ((GRID.lat[N_LAT - 1] - GRID.lat[0]) / (N_LAT - 1)));
    const j = Math.round((lon - GRID.lon[0]) / ((GRID.lon[N_LON - 1] - GRID.lon[0]) / (N_LON - 1)));
    const ci = Math.max(0, Math.min(N_LAT - 1, i));
    const cj = Math.max(0, Math.min(N_LON - 1, j));
    return { latIdx: ci, lonIdx: cj, lat: GRID.lat[ci], lon: GRID.lon[cj] };
  }

  function renderToCanvas(canvas, field, feature) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.globalAlpha = 0.94;
    ctx.lineWidth = 0.6;
    const isIce = feature === 'siconc';
    const hw = DLON / 2, hh = DLAT / 2;
    for (let i = 0; i < N_LAT; i++) {
      const lat = GRID.lat[i];
      const lat0 = Math.max(-89.9999, lat - hh);
      const lat1 = Math.min( 89.9999, lat + hh);
      for (let j = 0; j < N_LON; j++) {
        const val = field[i][j];
        if (isIce && val <= 0.5) continue;
        const lon = GRID.lon[j];
        const lon0 = Math.max(-179.9999, lon - hw);
        const lon1 = Math.min( 179.9999, lon + hw);
        const tl = projection([lon0, lat1]);
        const tr = projection([lon1, lat1]);
        const br = projection([lon1, lat0]);
        const bl = projection([lon0, lat0]);
        if (!tl || !tr || !br || !bl) continue;
        const color = colorFor(val, feature);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(tl[0], tl[1]);
        ctx.lineTo(tr[0], tr[1]);
        ctx.lineTo(br[0], br[1]);
        ctx.lineTo(bl[0], bl[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function cellsForDecade(decade) {
    const field = fieldFor(state.feature, state.scenario, decade);
    if (!field) return [];
    const cells = [];
    for (let i = 0; i < N_LAT; i++) {
      for (let j = 0; j < N_LON; j++) {
        const r = cellRect(i, j);
        if (!r) continue;
        r.value = field[i][j];
        cells.push(r);
      }
    }
    return cells;
  }

  function showTooltip(event, d) {
    const s = SCALES[state.feature];
    const latStr = d3.format('.1f')(Math.abs(d.lat)) + '°' + (d.lat >= 0 ? 'N' : 'S');
    const lonStr = d3.format('.1f')(Math.abs(d.lon)) + '°' + (d.lon >= 0 ? 'E' : 'W');
    d3.select('#tooltip')
      .style('opacity', 1)
      .style('left', (event.pageX + 14) + 'px')
      .style('top', (event.pageY + 14) + 'px')
      .html(`<strong>${latStr}, ${lonStr}</strong><br/>${s.fmt(d.value)} · ${d.decade}s`);
  }
  function hideTooltip() { d3.select('#tooltip').style('opacity', 0); }

  function drawRegionHighlights(layer) {
    layer.selectAll('*').remove();
    if (!state.regions.length || state.feature === 'siconc') return;
    state.regions.forEach((r, idx) => {
      const corners = [projection([r.lon0, r.lat1]), projection([r.lon1, r.lat1]), projection([r.lon1, r.lat0]), projection([r.lon0, r.lat0])];
      if (corners.some(c => !c)) return;
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const c = REGION_COLORS[idx];
      layer.append('rect')
        .attr('class', `region-highlight region-${idx + 1}`)
        .attr('x', x0).attr('y', y0).attr('width', x1 - x0).attr('height', y1 - y0)
        .attr('fill', c).attr('stroke', c);
      layer.append('text')
        .attr('class', 'region-label')
        .attr('x', x0 + 8).attr('y', y0 + 18)
        .attr('fill', c)
        .text(`Region ${idx + 1}`);
    });
  }

  function initMap(svgSel) {
    const svg = d3.select(svgSel);
    svg.selectAll('*').remove();

    const clipId = 'sph-clip-' + svgSel.replace(/[^a-z0-9]/gi, '');
    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('path').datum({type:'Sphere'}).attr('d', pathGen);

    svg.append('path').datum({type:'Sphere'}).attr('class', 'ocean-sphere').attr('d', pathGen);
    svg.append('path').datum(d3.geoGraticule().step([30, 30])()).attr('class', 'graticule').attr('d', pathGen);
    if (LAND) svg.append('path').datum(LAND).attr('class', 'land-fill').attr('d', pathGen);

    svg.append('image').attr('class', 'cells-canvas-img')
      .attr('x', 0).attr('y', 0).attr('width', MAP_W).attr('height', MAP_H)
      .attr('preserveAspectRatio', 'none')
      .attr('clip-path', `url(#${clipId})`);

    const node = svg.node();
    if (!node._canvas) {
      node._canvas = document.createElement('canvas');
      node._canvas.width = MAP_W;
      node._canvas.height = MAP_H;
    }

    if (LAND) svg.append('path').datum(LAND).attr('class', 'country-stroke').attr('d', pathGen);
    svg.append('g').attr('class', 'region-hl-layer');

    if (state.feature !== 'siconc') {
      const brushG = svg.append('g').attr('class', 'region-brush');
      const brush = d3.brush().extent([[0, 0], [MAP_W, MAP_H]])
        .on('end', event => regionBrushEnded(event, brushG, brush));
      brushG.call(brush);
      brushG.select('.overlay').style('pointer-events', 'all').style('cursor', 'crosshair');
    }

    svg.on('mousemove.tooltip', function(event) {
      const [x, y] = d3.pointer(event, svg.node());
      const cell = screenToCell(x, y);
      if (!cell || !LAND || !node._decade) { hideTooltip(); return; }
      const field = fieldFor(state.feature, state.scenario, node._decade);
      if (!field) { hideTooltip(); return; }
      showTooltip(event, {lat: cell.lat, lon: cell.lon, value: field[cell.latIdx][cell.lonIdx], decade: node._decade});
    }).on('mouseleave.tooltip', hideTooltip);
  }

  function updateMapData(svgSel, decade) {
    const svg = d3.select(svgSel);
    const node = svg.node();
    node._decade = decade;
    const field = fieldFor(state.feature, state.scenario, decade);
    if (!field) {
      svg.select('.cells-canvas-img').attr('href', null);
      drawRegionHighlights(svg.select('.region-hl-layer'));
      return;
    }
    renderToCanvas(node._canvas, field, state.feature);
    svg.select('.cells-canvas-img').attr('href', node._canvas.toDataURL());
    drawRegionHighlights(svg.select('.region-hl-layer'));
  }

  function regionBrushEnded(event, brushG, brush) {
    if (!event.selection) return;
    const [[x0, y0], [x1, y1]] = event.selection;
    const p0 = projection.invert([x0, y0]);
    const p1 = projection.invert([x1, y1]);
    if (!p0 || !p1) return;
    const region = { lon0: Math.min(p0[0], p1[0]), lon1: Math.max(p0[0], p1[0]), lat0: Math.min(p0[1], p1[1]), lat1: Math.max(p0[1], p1[1]) };
    state.regions.push(region);
    state.regions = state.regions.slice(-2);
    updateRegionUI();
    brushG.call(brush.move, null);
    redrawMaps();
    drawLine();
  }

  function updateRegionUI() {
    const n = state.regions.length;
    d3.select('#region-badge').style('display', n ? 'inline-block' : 'none');
    d3.select('#clear-region').style('display', n ? 'inline-block' : 'none');
    d3.select('#region-filter-control').style('display', n ? 'flex' : 'none');
    d3.select('#region-filter-badge').text(n === 1 ? '1 region' : `${n} regions`);
  }

  function clearRegions() {
    state.regions = [];
    updateRegionUI();
    redrawMaps();
    drawLine();
  }

  function redrawMaps() {
    const [a, b] = state.compareDecades.slice().sort((x, y) => x - y);
    state.compareDecades = [a, b];
    d3.select('#year-readout').text(`${a}s vs ${b}s`);
    d3.select('#map-left-label').text(`${a}s`);
    d3.select('#map-right-label').text(`${b}s`);
    updateMapData('#map-svg-left', a);
    updateMapData('#map-svg-right', b);
  }

  function drawLegend() {
    const legSvg = d3.select('#legend-svg');
    legSvg.selectAll('*').remove();
    const s = SCALES[state.feature];
    const W = 360, H = 14, LEFT = 40;
    const gradId = `legend-grad-${state.feature}`;
    const defs = legSvg.append('defs');
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0%').attr('x2', '100%');
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const v = s.domain[0] + t * (s.domain[1] - s.domain[0]);
      grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorFor(v, state.feature));
    }
    legSvg.append('rect').attr('x', LEFT).attr('y', 8).attr('width', W).attr('height', H).attr('fill', `url(#${gradId})`).attr('stroke', 'var(--rule-strong)');
    const scale = d3.scaleLinear().domain(s.domain).range([LEFT, LEFT + W]);
    legSvg.append('g').attr('class', 'legend-axis').attr('transform', `translate(0, ${8 + H})`).call(d3.axisBottom(scale).ticks(7).tickFormat(s.fmt));
    legSvg.append('text').attr('x', LEFT + W + 16).attr('y', 8 + H/2 + 4).attr('font-family', 'var(--mono)').attr('font-size', 10).attr('fill', 'var(--ink-soft)').text(s.label);
  }

  const lineSvg = d3.select('#line-svg');
  const MARGIN = { top: 18, right: 120, bottom: 48, left: 70 };
  const PLOT_W = LINE_W - MARGIN.left - MARGIN.right;
  const PLOT_H = LINE_H - MARGIN.top - MARGIN.bottom;
  const xScale = d3.scaleLinear().domain([1850, 2100]).range([0, PLOT_W]);
  const yScale = d3.scaleLinear().range([PLOT_H, 0]);
  const gPlot = lineSvg.append('g').attr('transform', `translate(${MARGIN.left}, ${MARGIN.top})`);
  const gXAxis = gPlot.append('g').attr('class', 'axis axis-x').attr('transform', `translate(0, ${PLOT_H})`);
  const gYAxis = gPlot.append('g').attr('class', 'axis axis-y');
  const gLines = gPlot.append('g');
  const gMarkers = gPlot.append('g');
  const gLabels = gPlot.append('g');
  const gYearBrush = gPlot.append('g').attr('class', 'year-brush');
  gPlot.append('line').attr('class', 'zero-line').attr('x1', 0).attr('x2', PLOT_W);
  gPlot.append('text').attr('class', 'axis-y-label').attr('transform', 'rotate(-90)').attr('y', -54).attr('x', -PLOT_H/2).attr('text-anchor', 'middle').text('Anomaly');
  const lineGen = d3.line().x(d => xScale(d.year)).y(d => yScale(d.value));

  function timeseriesForRegion(scen, feature, region) {
    const decades = scen === 'historical' ? DECADES.historical : DECADES.future;
    const out = [];
    for (const decade of decades) {
      const field = fieldFor(feature, scen, decade);
      if (!field) continue;
      let sum = 0, weightSum = 0;
      for (let i = 0; i < N_LAT; i++) {
        const lat = GRID.lat[i];
        if (region && (lat < region.lat0 || lat > region.lat1)) continue;
        const w = Math.cos(lat * Math.PI / 180);
        for (let j = 0; j < N_LON; j++) {
          const lon = GRID.lon[j];
          if (region && (lon < region.lon0 || lon > region.lon1)) continue;
          sum += field[i][j] * w;
          weightSum += w;
        }
      }
      out.push({year: decade + 5, value: weightSum > 0 ? sum / weightSum : 0});
    }
    return out;
  }

  function scenarioColor(scen) {
    if (scen === 'ssp126') return 'var(--scen-126)';
    if (scen === 'ssp245') return 'var(--scen-245)';
    return 'var(--scen-585)';
  }

  function drawLine() {
    const feature = state.feature;
    const scen = state.scenario;
    const gm = GLOBAL_MEAN_BY_FEATURE[feature];
    if (!gm) return;
    const hist = gm.historical || [];
    const globalSeries = gm[scen] || [];
    const regionSeries = state.regions.map(r => timeseriesForRegion(scen, feature, r));
    const all = [...hist, ...globalSeries, ...regionSeries.flat()].filter(d => Number.isFinite(d.value));
    if (!all.length) return;
    let extent = d3.extent(all, d => d.value);
    if (feature === 'tas') extent = [Math.min(-1, extent[0]), Math.max(5, extent[1])];
    else if (feature === 'siconc') extent = [0, Math.max(55, extent[1])];
    else extent = [Math.min(-25, extent[0]), Math.max(25, extent[1])];
    yScale.domain(extent).nice();

    gXAxis.call(d3.axisBottom(xScale).tickFormat(d3.format('d')).ticks(8));
    gYAxis.call(d3.axisLeft(yScale).tickFormat(SCALES[feature].fmt).ticks(6));
    gPlot.select('.axis-y-label').text(FEATURE_META[feature].y);
    gPlot.select('.zero-line').style('display', feature === 'siconc' ? 'none' : null).attr('y1', yScale(0)).attr('y2', yScale(0));

    gLines.selectAll('*').remove();
    gLabels.selectAll('*').remove();
    gMarkers.selectAll('*').remove();

    gLines.append('path').datum(hist).attr('class', 'hist-line').attr('d', lineGen);
    gLines.append('path').datum(globalSeries).attr('class', 'global-line').attr('stroke', scenarioColor(scen)).attr('d', lineGen);

    regionSeries.forEach((data, idx) => {
      gLines.append('path').datum(data).attr('class', `region-line region-${idx + 1}`).attr('stroke', REGION_COLORS[idx]).attr('d', lineGen);
    });

    const lastGlobal = globalSeries[globalSeries.length - 1];
    if (lastGlobal) {
      gLabels.append('text').attr('class', 'line-label').attr('x', xScale(lastGlobal.year) + 8).attr('y', yScale(lastGlobal.value) + 4).attr('fill', scenarioColor(scen)).text(`${scen.toUpperCase()} global`);
    }
    regionSeries.forEach((data, idx) => {
      const last = data[data.length - 1];
      if (!last) return;
      gLabels.append('text').attr('class', 'line-label').attr('x', xScale(last.year) + 8).attr('y', yScale(last.value) + 4 + idx * 14).attr('fill', REGION_COLORS[idx]).text(`Region ${idx + 1}`);
    });

    state.compareDecades.forEach(dec => {
      const x = xScale(dec + 5);
      gMarkers.append('line').attr('class', 'time-marker').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', PLOT_H);
      gMarkers.append('text').attr('x', x + 5).attr('y', 12).attr('font-family', 'var(--mono)').attr('font-size', 10).attr('fill', 'var(--accent)').text(`${dec}s`);
    });
  }

  function updateMarkersOnly() {
    gMarkers.selectAll('*').remove();
    state.compareDecades.forEach(dec => {
      const x = xScale(dec + 5);
      gMarkers.append('line').attr('class', 'time-marker').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', PLOT_H);
      gMarkers.append('text').attr('x', x + 5).attr('y', 12).attr('font-family', 'var(--mono)').attr('font-size', 10).attr('fill', 'var(--accent)').text(`${dec}s`);
    });
  }

  const yearBrush = d3.brushX().extent([[0, 0], [PLOT_W, PLOT_H]])
    .on('brush', event => {
      if (!event.selection) return;
      const [x0, x1] = event.selection;
      const clamp = d => Math.max(1850, Math.min(2090, d));
      const d0 = clamp(Math.floor(xScale.invert(x0) / 10) * 10);
      const d1 = clamp(Math.floor(xScale.invert(x1) / 10) * 10);
      state.compareDecades = [d0, d1].sort((a, b) => a - b);
      d3.select('#year-readout').text(`${state.compareDecades[0]}s vs ${state.compareDecades[1]}s`);
      d3.select('#map-left-label').text(`${state.compareDecades[0]}s`);
      d3.select('#map-right-label').text(`${state.compareDecades[1]}s`);
      updateMapData('#map-svg-left', state.compareDecades[0]);
      updateMapData('#map-svg-right', state.compareDecades[1]);
      updateMarkersOnly();
    })
    .on('end', event => {
      if (!event.selection) return;
      const [x0, x1] = event.selection;
      const clamp = d => Math.max(1850, Math.min(2090, d));
      const d0 = clamp(Math.floor(xScale.invert(x0) / 10) * 10);
      const d1 = clamp(Math.floor(xScale.invert(x1) / 10) * 10);
      state.compareDecades = [d0, d1].sort((a, b) => a - b);
      redrawMaps();
      drawLine();
    });
  gYearBrush.call(yearBrush);

  d3.select('#clear-region').on('click', clearRegions);
  d3.select('#clear-region-ctrl').on('click', clearRegions);

  const SCEN_INFO = {
    ssp126: { warming: '~1.8°C warmer by 2100', detail: 'The world acts quickly. Countries cut emissions sharply this decade, switch to clean energy, and reach net-zero around 2050. Warming stays close to the Paris Agreement target of 1.5–2°C.' },
    ssp245: { warming: '~2.7°C warmer by 2100', detail: 'A middle path. Some climate policies take effect and renewables grow, but fossil fuels are phased out slowly. Warming exceeds 2°C, bringing significant but manageable impacts to most regions.' },
    ssp585: { warming: '~4.4°C warmer by 2100', detail: 'No meaningful action is taken. Fossil fuel use expands, emissions roughly double by 2100, and the planet warms dramatically. Extreme heat, flooding, and ecosystem collapse become widespread.' },
  };
  const SCEN_COLOR = { ssp126: 'var(--scen-126)', ssp245: 'var(--scen-245)', ssp585: 'var(--scen-585)' };
  function renderScenExplainer(scen) {
    const s = SCEN_INFO[scen];
    d3.select('#scenario-explainer').html(
      `<span style="color:${SCEN_COLOR[scen]};font-weight:500;">${s.warming}</span> — ${s.detail}`
    );
  }

  const FEATURE_INFO = {
    tas:    'How much warmer or cooler a region is compared to pre-industrial levels (1850–1900). Red = warming above baseline, blue = below. Most land regions are warming faster than the global average.',
    pr:     'How much wetter or drier a region is compared to pre-industrial levels. Blue = more rainfall/snowfall, brown = drier conditions. Wet regions tend to get wetter; dry regions tend to get drier.',
    siconc: 'The percentage of ocean surface covered by sea ice. Tracks the shrinking of Arctic and Antarctic ice — a key indicator of polar warming and a feedback that accelerates further global warming.',
  };
  function renderFeatureExplainer(feature) {
    d3.select('#feature-explainer').text(FEATURE_INFO[feature] || '');
  }

  d3.selectAll('#scenario-toggle button').on('click', function() {
    state.scenario = this.dataset.scen;
    d3.selectAll('#scenario-toggle button').classed('active', false);
    d3.select(this).classed('active', true);
    renderScenExplainer(state.scenario);
    redrawMaps();
    drawLine();
  });

  d3.select('#feature-select').on('change', function() {
    state.feature = this.value;
    if (state.feature === 'siconc') state.regions = [];
    updateRegionUI();
    updateFeatureText();
    renderFeatureExplainer(state.feature);
    redrawMaps();
    drawLegend();
    drawLine();
  });

  function updateFeatureText() {
    const meta = FEATURE_META[state.feature];
    d3.select('#map-title').text(meta.title);
    d3.select('#map-subtitle').text(meta.sub);
    d3.select('#notes-body').html(meta.notes);
    d3.select('#ice-explainer').style('display', state.feature === 'siconc' ? 'block' : 'none');
    initMap('#map-svg-left');
    initMap('#map-svg-right');
  }

  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json').then(world => {
    LAND = topojson.feature(world, world.objects.land);
    renderScenExplainer(state.scenario);
    renderFeatureExplainer(state.feature);
    updateFeatureText();
    redrawMaps();
    drawLegend();
    drawLine();
    gYearBrush.call(yearBrush.move, [xScale(state.compareDecades[0] + 5), xScale(state.compareDecades[1] + 5)]);
  });
}).catch(err => {
  console.error('Failed to load data/cmip6_data.json:', err);
  d3.select('body').insert('div', ':first-child')
    .style('background', '#fee').style('border', '1px solid #c33').style('color', '#933')
    .style('padding', '16px 24px').style('font-family', 'monospace').style('font-size', '13px')
    .html(`<strong>Could not load data/cmip6_data.json.</strong><br/>Make sure the file is in the same folder as index.html, and that you're serving via a local web server. Error: ${err.message}`);
});
