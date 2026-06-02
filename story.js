const MAP_W = 960, MAP_H = 500;
const DLON = 5.0, DLAT = 3.77;
const REGION_COLORS = ['#8b5cf6', '#f59e0b'];

// Chapter 4 responsibility/impact overlay colors.
// These avoid red/blue so they do not compete with the temperature anomaly map.
const INJUSTICE_COLORS = {
  impactedFill: '#8b5cf6',
  impactedStroke: '#c4b5fd',
  emitterFill: '#22c55e',   // green = major historical emitters
  emitterStroke: '#86efac'
};

// Chapter 3 equatorial precipitation-risk overlay colors.
const PRECIP_RISK_COLORS = {
  dry: '#0b0b0b', // red/orange = much drier
  wet: '#0b0b0b'  // blue = much wetter
};

const SCALES = {
  tas:    { domain: [-2, 8],    interp: d3.interpolateRdBu,  reverse: true,  label: 'Δ°C',     fmt: d => d3.format('+.1f')(d) + '°C' },
  pr:     { domain: [-30, 30],  interp: d3.interpolateBrBG,  reverse: false, label: 'Δ% precip', fmt: d => d3.format('+.0f')(d) + '%' },
  siconc: { domain: [1, 85],    interp: d3.interpolateRgbBasis(['#111b24','#1e4d7a','#2572b4','#4a9eca','#a8d4f0','#f0f4f8']), reverse: true, label: '% ice', fmt: d => d3.format('.0f')(d) + '%' }
};

function colorFor(v, feature) {
  const s = SCALES[feature];
  const t = (v - s.domain[0]) / (s.domain[1] - s.domain[0]);
  const c = 0.04 + Math.max(0, Math.min(1, t)) * 0.92;
  return s.interp(s.reverse ? 1 - c : c);
}

const projection = d3.geoNaturalEarth1().fitExtent([[4,4],[MAP_W-4,MAP_H-4]], {type:'Sphere'});
const pathGen = d3.geoPath(projection);

let LAND = null, COUNTRIES_GEO = null, CELL_RECTS = null, DATA = null;
let EMISSIONS_COUNTRIES = [];
let EMISSIONS_BY_KEY = new Map();

const ISO_NAMES = {
  4:"Afghanistan",8:"Albania",12:"Algeria",16:"American Samoa",20:"Andorra",24:"Angola",660:"Anguilla",28:"Antigua and Barbuda",32:"Argentina",51:"Armenia",533:"Aruba",36:"Australia",40:"Austria",31:"Azerbaijan",44:"Bahamas",48:"Bahrain",50:"Bangladesh",52:"Barbados",112:"Belarus",56:"Belgium",84:"Belize",204:"Benin",60:"Bermuda",64:"Bhutan",68:"Bolivia",70:"Bosnia and Herzegovina",72:"Botswana",76:"Brazil",96:"Brunei",100:"Bulgaria",854:"Burkina Faso",108:"Burundi",132:"Cabo Verde",116:"Cambodia",120:"Cameroon",124:"Canada",136:"Cayman Islands",140:"Central African Rep.",148:"Chad",152:"Chile",156:"China",170:"Colombia",174:"Comoros",180:"Dem. Rep. Congo",178:"Rep. of Congo",188:"Costa Rica",384:"Côte d'Ivoire",191:"Croatia",192:"Cuba",196:"Cyprus",203:"Czechia",208:"Denmark",262:"Djibouti",212:"Dominica",214:"Dominican Republic",218:"Ecuador",818:"Egypt",222:"El Salvador",226:"Equatorial Guinea",232:"Eritrea",233:"Estonia",748:"Eswatini",231:"Ethiopia",238:"Falkland Islands",242:"Fiji",246:"Finland",250:"France",266:"Gabon",270:"Gambia",268:"Georgia",276:"Germany",288:"Ghana",300:"Greece",304:"Greenland",308:"Grenada",320:"Guatemala",324:"Guinea",624:"Guinea-Bissau",328:"Guyana",332:"Haiti",340:"Honduras",348:"Hungary",352:"Iceland",356:"India",360:"Indonesia",364:"Iran",368:"Iraq",372:"Ireland",376:"Israel",380:"Italy",388:"Jamaica",392:"Japan",400:"Jordan",398:"Kazakhstan",404:"Kenya",408:"North Korea",410:"South Korea",414:"Kuwait",417:"Kyrgyzstan",418:"Laos",428:"Latvia",422:"Lebanon",426:"Lesotho",430:"Liberia",434:"Libya",440:"Lithuania",442:"Luxembourg",450:"Madagascar",454:"Malawi",458:"Malaysia",462:"Maldives",466:"Mali",470:"Malta",478:"Mauritania",480:"Mauritius",484:"Mexico",496:"Mongolia",499:"Montenegro",504:"Morocco",508:"Mozambique",516:"Namibia",524:"Nepal",528:"Netherlands",554:"New Zealand",558:"Nicaragua",562:"Niger",566:"Nigeria",578:"Norway",512:"Oman",586:"Pakistan",591:"Panama",598:"Papua New Guinea",600:"Paraguay",604:"Peru",608:"Philippines",616:"Poland",620:"Portugal",634:"Qatar",642:"Romania",643:"Russia",646:"Rwanda",682:"Saudi Arabia",686:"Senegal",688:"Serbia",694:"Sierra Leone",703:"Slovakia",705:"Slovenia",706:"Somalia",710:"South Africa",728:"South Sudan",724:"Spain",144:"Sri Lanka",729:"Sudan",740:"Suriname",752:"Sweden",756:"Switzerland",760:"Syria",762:"Tajikistan",834:"Tanzania",764:"Thailand",768:"Togo",780:"Trinidad and Tobago",788:"Tunisia",792:"Turkey",795:"Turkmenistan",800:"Uganda",804:"Ukraine",784:"UAE",826:"United Kingdom",840:"United States",858:"Uruguay",860:"Uzbekistan",548:"Vanuatu",862:"Venezuela",704:"Vietnam",887:"Yemen",894:"Zambia",716:"Zimbabwe"
};

// ISO 3166-1 numeric codes for the largest historical cumulative CO₂ emitters
const MAJOR_EMITTER_IDS = new Set([
  840,  // United States
  156,  // China
  643,  // Russia
  276,  // Germany
  826,  // United Kingdom
  392,  // Japan
  124,  // Canada
  250,  // France
  36,   // Australia
  380,  // Italy
  616,  // Poland
  804,  // Ukraine
  724,  // Spain
  528,  // Netherlands
  56,   // Belgium
  752,  // Sweden
  203,  // Czechia
  40,   // Austria
  246,  // Finland
  208,  // Denmark
]);

const EMISSIONS_PATH = "data/owid-co2-data.csv";
const CMIP6_PATH = "data/cmip6_data.json";

Promise.all([
  d3.csv(EMISSIONS_PATH),
  d3.json(CMIP6_PATH),
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
]).then(([emissionsRows, data, world]) => {
  DATA = data;
  LAND = topojson.feature(world, world.objects.land);
  COUNTRIES_GEO = topojson.feature(world, world.objects.countries);

  const N_LAT = DATA.meta.lat.length, N_LON = DATA.meta.lon.length;
  CELL_RECTS = [];
  for (let i = 0; i < N_LAT; i++) {
    for (let j = 0; j < N_LON; j++) {
      const lat = DATA.meta.lat[i], lon = DATA.meta.lon[j];
      const p0 = projection([lon - DLON/2, lat + DLAT/2]);
      const p1 = projection([lon + DLON/2, lat - DLAT/2]);
      if (!p0 || !p1) continue;
      CELL_RECTS.push({ x:p0[0], y:p0[1], w:p1[0]-p0[0], h:p1[1]-p0[1], lat, lon, i, j });
    }
  }

  initEmissions(emissionsRows);
  initStoryMaps();
  initCh3PrecipRisk(2090);
  initCh4WetBulb();
  initCh4Countries();
  initCh6();
  initExplorer();
  initScrollSpy();
  initImpactScatterplots();
}).catch(err => {
  console.error("Climate story failed to initialize:", err);
});



// ── EMISSIONS: PAST VS PRESENT RESPONSIBILITY ────────────────────────────────
function normalizeCountryName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNTRY_ALIASES = new Map([
  ['united states of america', 'united states'],
  ['usa', 'united states'],
  ['russia', 'russia'],
  ['russian federation', 'russia'],
  ['dem rep congo', 'democratic republic of congo'],
  ['democratic republic of the congo', 'democratic republic of congo'],
  ['rep of congo', 'congo'],
  ['republic of congo', 'congo'],
  ['czechia', 'czechia'],
  ['czech republic', 'czechia'],
  ['south korea', 'south korea'],
  ['republic of korea', 'south korea'],
  ['north korea', 'north korea'],
  ['iran', 'iran'],
  ['viet nam', 'vietnam'],
  ['laos', 'laos'],
  ['syria', 'syria'],
  ['turkey', 'turkey'],
  ['türkiye', 'turkey'],
  ['uae', 'united arab emirates'],
  ['united arab emirates', 'united arab emirates'],
  ['côte divoire', "cote d'ivoire"],
  ['cote divoire', "cote d'ivoire"],
  ['ivory coast', "cote d'ivoire"],
  ['eswatini', 'eswatini'],
  ['swaziland', 'eswatini'],
  ['cabo verde', 'cape verde'],
  ['cape verde', 'cape verde']
]);

function canonicalCountryName(name) {
  const n = normalizeCountryName(name);
  return COUNTRY_ALIASES.get(n) || n;
}

function initEmissions(emissionsRows) {
  if (!document.querySelector('#emissions-map') && !document.querySelector('#historical-emissions-chart')) return;

  const rows = emissionsRows
    .map(d => ({
      country: d.country,
      key: canonicalCountryName(d.country),
      iso: d.iso_code,
      year: +d.year,
      co2: +d.co2,
      cumulative: +d.cumulative_co2,
      population: +d.population
    }))
    .filter(d =>
      d.country &&
      d.iso &&
      d.iso.length === 3 &&
      Number.isFinite(d.year) &&
      d.iso !== 'OWID_WRL'
    );

  const byCountry = d3.group(rows, d => d.key);
  const countries = [];

  byCountry.forEach((vals, key) => {
    vals.sort((a, b) => a.year - b.year);
    const validCo2 = vals.filter(d => Number.isFinite(d.co2));
    const latest = [...validCo2].reverse()[0];
    const latestCumulative = [...vals].reverse().find(d => Number.isFinite(d.cumulative));
    const cumulative = latestCumulative
      ? latestCumulative.cumulative
      : d3.sum(validCo2, d => d.co2);

    if (!latest || !Number.isFinite(cumulative)) return;

    countries.push({
      key,
      country: latest.country,
      latestYear: latest.year,
      presentCo2: latest.co2,
      cumulativeCo2: cumulative,
      population: latest.population
    });
  });

  const historicalTop = countries
    .filter(d => Number.isFinite(d.cumulativeCo2))
    .sort((a, b) => b.cumulativeCo2 - a.cumulativeCo2)
    .slice(0, 10);

  const presentTop = countries
    .filter(d => Number.isFinite(d.presentCo2))
    .sort((a, b) => b.presentCo2 - a.presentCo2)
    .slice(0, 10);

  const historicalTopKeys = new Set(historicalTop.map(d => d.key));
  const presentTopKeys = new Set(presentTop.map(d => d.key));
  const countryByKey = new Map(countries.map(d => [d.key, d]));
  EMISSIONS_COUNTRIES = countries;
  EMISSIONS_BY_KEY = countryByKey;

  drawEmissionsMap(countryByKey, historicalTopKeys, presentTopKeys);
  drawEmissionsBarChart('#historical-emissions-chart', historicalTop, 'cumulativeCo2', 'Cumulative CO₂');
  drawEmissionsBarChart('#present-emissions-chart', presentTop, 'presentCo2', 'Annual CO₂');
  drawIntroStats(countries, historicalTop, presentTop);
}

function drawIntroStats(countries, historicalTop, presentTop) {
  const grid = d3.select('#stats-grid');
  if (grid.empty()) return;

  const totalPresent = d3.sum(countries, d => d.presentCo2);
  const top10Present = d3.sum(presentTop, d => d.presentCo2);
  const totalHistorical = d3.sum(countries, d => d.cumulativeCo2);
  const top10Historical = d3.sum(historicalTop, d => d.cumulativeCo2);

  const latestYear = d3.max(countries, d => d.latestYear);
  const totalLatestGt = totalPresent / 1000;

  const tas2090 = getGlobalMeanValue('tas', 'ssp585', 2095) ?? getGlobalMeanValue('tas', 'ssp585', 2090);
  const pr2090 = getGlobalMeanValue('pr', 'ssp585', 2095) ?? getGlobalMeanValue('pr', 'ssp585', 2090);

  // Original top infographic card format: 4 cards in a 2x2 square.
  // Sea ice is shown as relative decline, not remaining absolute concentration.
  const iceBase = getGlobalMeanValue('siconc', 'historical', 1995)
    ?? getGlobalMeanValue('siconc', 'historical', 2005)
    ?? getGlobalMeanValue('siconc', 'ssp585', 2025);
  const ice2090 = getGlobalMeanValue('siconc', 'ssp585', 2095)
    ?? getGlobalMeanValue('siconc', 'ssp585', 2090);

  let iceDeclineLabel = '-82%';
  if (iceBase != null && ice2090 != null && iceBase !== 0) {
    const pctChange = ((ice2090 - iceBase) / iceBase) * 100;
    iceDeclineLabel = `${d3.format('+.0f')(pctChange)}%`;
  }

  const SSP5_NOTE = `<span class="stat-ssp-note">SSP5-8.5 = worst case: no meaningful action on emissions</span>`;

  const stats = [
    {
      label: 'Temperature increase',
      value: tas2090 != null ? `${d3.format('+.1f')(tas2090)}°C` : '+4.0°C',
      sub: 'projected global average warming by the 2090s',
      note: SSP5_NOTE
    },
    {
      label: 'Sea ice loss',
      value: iceDeclineLabel,
      sub: 'relative loss in late-century sea ice coverage',
      note: SSP5_NOTE
    },
    {
      label: 'Rainfall disruption',
      value: pr2090 != null ? `${d3.format('+.0f')(pr2090)}%` : 'Shifting',
      sub: 'global average shift — regional extremes are far larger',
      note: ''
    },
    {
      label: 'Emissions concentrated',
      value: `${d3.format('.0%')(top10Historical / totalHistorical)}`,
      sub: `of all historical CO₂ came from the top 10 emitting nations`,
      note: ''
    }
  ];

  grid.selectAll('.stat-card')
    .data(stats)
    .join('div')
    .attr('class', 'stat-card')
    .html(d => `
      <div class="stat-value">${d.value}</div>
      <div class="stat-label">${d.label}</div>
      <div class="stat-sub">${d.sub}</div>
      ${d.note}
    `);
}

function getGlobalMeanValue(feature, scen, targetYear) {
  if (!DATA || !DATA.global_mean || !DATA.global_mean[feature]) return null;
  const series = DATA.global_mean[feature][scen] || [];
  if (!series.length) return null;
  const exact = series.find(d => +d.year === +targetYear);
  if (exact && Number.isFinite(+exact.value)) return +exact.value;
  const nearest = series.reduce((best, d) => {
    if (!Number.isFinite(+d.value)) return best;
    if (!best) return d;
    return Math.abs(+d.year - targetYear) < Math.abs(+best.year - targetYear) ? d : best;
  }, null);
  return nearest ? +nearest.value : null;
}

function computeSaharanResponsibilityImpact(countries, totalHistorical) {
  // A compact version of the earlier infographic panel: compare cumulative
  // responsibility for Sahel/Sub-Saharan countries against projected heat stress.
  const subSaharanKeys = new Set([
    'angola','benin','botswana','burkina faso','burundi','cameroon','cape verde',
    'central african republic','chad','comoros','congo','democratic republic of congo',
    "cote d'ivoire",'djibouti','equatorial guinea','eritrea','eswatini','ethiopia',
    'gabon','gambia','ghana','guinea','guinea-bissau','kenya','lesotho','liberia',
    'madagascar','malawi','mali','mauritania','mauritius','mozambique','namibia',
    'niger','nigeria','rwanda','senegal','sierra leone','somalia','south africa',
    'south sudan','sudan','tanzania','togo','uganda','zambia','zimbabwe'
  ]);

  const regionalCumulative = d3.sum(countries, d =>
    subSaharanKeys.has(d.key) && Number.isFinite(d.cumulativeCo2) ? d.cumulativeCo2 : 0
  );

  let heatMean = null;
  const field = getField('tas', 'ssp585', 2090);

  if (field && DATA?.meta?.lat && DATA?.meta?.lon) {
    let sum = 0;
    let wt = 0;

    DATA.meta.lat.forEach((lat, i) => {
      // Sahel / Sub-Saharan stress belt approximation
      if (lat < -35 || lat > 25) return;
      const w = Math.cos(lat * Math.PI / 180);

      DATA.meta.lon.forEach((lon, j) => {
        if (lon < -20 || lon > 52) return;
        const v = field[i][j];
        if (Number.isFinite(v)) {
          sum += v * w;
          wt += w;
        }
      });
    });

    if (wt > 0) heatMean = sum / wt;
  }

  return {
    emissionsShare: d3.format('.1%')(regionalCumulative / totalHistorical),
    warming: heatMean === null ? 'high risk' : `+${heatMean.toFixed(1)}°C`
  };
}

function drawEmissionsMap(countryByKey, historicalTopKeys, presentTopKeys) {
  const host = d3.select('#emissions-map');
  if (host.empty() || !COUNTRIES_GEO) return;

  host.selectAll('*').remove();

  const svg = host.append('svg')
    .attr('viewBox', `0 0 ${MAP_W} ${MAP_H}`)
    .attr('class', 'emissions-map-svg');

  svg.append('path')
    .datum({type:'Sphere'})
    .attr('class','ocean-sphere')
    .attr('d',pathGen);

  svg.append('path')
    .datum(d3.geoGraticule().step([30,30])())
    .attr('class','graticule')
    .attr('d',pathGen);

  svg.append('g')
    .selectAll('path')
    .data(COUNTRIES_GEO.features)
    .join('path')
    .attr('class', 'emissions-country')
    .attr('d', pathGen)
    .attr('fill', d => {
      const geoName = d.properties?.name || ISO_NAMES[parseInt(d.id)] || '';
      const key = canonicalCountryName(geoName);
      const hist = historicalTopKeys.has(key);
      const pres = presentTopKeys.has(key);
      if (hist && pres) return '#c94f8a';
      if (hist) return '#e05c3a';
      if (pres) return '#4a9eca';
      return '#242220';
    })
    .attr('stroke', 'rgba(255,255,255,.28)')
    .attr('stroke-width', .45)
    .on('mouseenter', function(e, d) {
      const geoName = d.properties?.name || ISO_NAMES[parseInt(d.id)] || 'Country';
      const key = canonicalCountryName(geoName);
      const rec = countryByKey.get(key);
      const groups = [];
      if (historicalTopKeys.has(key)) groups.push('Historical top 10');
      if (presentTopKeys.has(key)) groups.push('Present-day top 10');

      d3.select(this).attr('stroke', '#fff').attr('stroke-width', 1.2);

      showTip(e, `
        <strong>${geoName}</strong><br>
        ${groups.length ? groups.join(' · ') : 'Not in either top 10'}<br>
        ${rec ? `Annual CO₂: ${d3.format(',.1f')(rec.presentCo2)} Mt<br>Cumulative CO₂: ${d3.format(',.0f')(rec.cumulativeCo2)} Mt` : 'No emissions match'}
      `);
    })
    .on('mousemove', e => {
      d3.select('#tooltip')
        .style('left', (e.clientX + 14) + 'px')
        .style('top', (e.clientY + 14) + 'px');
    })
    .on('mouseleave', function() {
      d3.select(this).attr('stroke', 'rgba(255,255,255,.28)').attr('stroke-width', .45);
      hideTip();
    });

  const legend = host.append('div').attr('class', 'emissions-legend');
  [
    ['#e05c3a', 'Historical top 10'],
    ['#4a9eca', 'Present-day top 10'],
    ['#c94f8a', 'Both']
  ].forEach(([color, label]) => {
    legend.append('span').html(`<i style="background:${color}"></i>${label}`);
  });
}

function drawEmissionsBarChart(sel, data, valueKey, label) {
  const host = d3.select(sel);
  if (host.empty()) return;

  host.selectAll('*').remove();

  const W = 520, H = 330;
  const m = {top: 18, right: 26, bottom: 38, left: 145};
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const svg = host.append('svg')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('class', 'emissions-bar-svg');

  const g = svg.append('g')
    .attr('transform', `translate(${m.left},${m.top})`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d[valueKey]) || 1])
    .nice()
    .range([0, pw]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.country))
    .range([0, ph])
    .padding(0.25);

  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y).tickSize(0))
    .call(g => g.select('.domain').remove());

  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${ph})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d => d3.format('.2s')(d)))
    .call(g => g.select('.domain').remove());

  g.selectAll('rect')
    .data(data)
    .join('rect')
    .attr('x', 0)
    .attr('y', d => y(d.country))
    .attr('height', y.bandwidth())
    .attr('width', d => x(d[valueKey]))
    .attr('fill', valueKey === 'cumulativeCo2' ? '#e05c3a' : '#4a9eca')
    .attr('rx', 2)
    .on('mouseenter', (e, d) => {
      showTip(e, `
        <strong>${d.country}</strong><br>
        ${label}: ${d3.format(',.1f')(d[valueKey])} Mt CO₂<br>
        Latest year: ${d.latestYear}
      `);
    })
    .on('mouseleave', hideTip);

  svg.append('text')
    .attr('x', m.left)
    .attr('y', H - 6)
    .attr('font-family', 'var(--mono)')
    .attr('font-size', 10)
    .attr('fill', 'var(--ink-faint)')
    .text(`${label}, million tonnes`);
}



// ── CANVAS MAP RENDERING ──────────────────────────────────────────────────────
// Renders a field into an offscreen canvas as projected quadrilaterals.
function renderToCanvas(canvas, field, feature) {
  const N_LAT = DATA.meta.lat.length, N_LON = DATA.meta.lon.length;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  ctx.globalAlpha = 0.94;
  ctx.lineWidth = 0.6;
  const isIce = feature === 'siconc';
  const hw = DLON / 2, hh = DLAT / 2;
  for (let i = 0; i < N_LAT; i++) {
    const lat = DATA.meta.lat[i];
    const lat0 = Math.max(-89.9999, lat - hh);
    const lat1 = Math.min( 89.9999, lat + hh);
    for (let j = 0; j < N_LON; j++) {
      const val = field[i][j];
      if (isIce && val <= 0.5) continue;
      const lon = DATA.meta.lon[j];
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

// Attach a live <canvas> inside a <foreignObject> clipped to the sphere.
// All drawing goes directly to this canvas — no toDataURL() ever needed.
function attachDisplayCanvas(svg, clipId) {
  const fo = svg.append('foreignObject')
    .attr('x', 0).attr('y', 0)
    .attr('width', MAP_W).attr('height', MAP_H)
    .attr('clip-path', `url(#${clipId})`);
  const canvasEl = document.createElement('canvas');
  canvasEl.width = MAP_W;
  canvasEl.height = MAP_H;
  canvasEl.style.display = 'block';
  fo.node().appendChild(canvasEl);
  return canvasEl;
}

function mkOffscreen() {
  const c = document.createElement('canvas');
  c.width = MAP_W; c.height = MAP_H;
  return c;
}

// ── BASE MAP INIT ─────────────────────────────────────────────────────────────
function initBaseSvg(sel, opts = {}) {
  const svg = d3.select(sel);
  svg.selectAll('*').remove();

  const clipId = 'sph-clip-' + sel.replace(/[^a-z0-9]/gi, '');
  svg.append('defs').append('clipPath').attr('id', clipId)
    .append('path').datum({type:'Sphere'}).attr('d', pathGen);

  svg.append('path').datum({type:'Sphere'}).attr('class','ocean-sphere').attr('d',pathGen);
  svg.append('path').datum(d3.geoGraticule().step([30,30])()).attr('class','graticule').attr('d',pathGen);
  svg.append('path').datum(LAND).attr('class','land-fill').attr('d',pathGen);

  const node = svg.node();
  if (!node) return svg;

  // Live canvas embedded directly in SVG — no PNG encoding, GPU-accelerated blending
  node._displayCanvas = attachDisplayCanvas(svg, clipId);
  node._canvasA = mkOffscreen(); // "from" frame for blending
  node._canvasB = mkOffscreen(); // "to" frame for blending
  node._rafId = null;

  if (opts.precipLayer) {
    svg.append('g').attr('class', 'precip-risk-layer').style('opacity', 0);
  }
  if (opts.wbLayer) {
    svg.append('g').attr('class','wb-layer').style('opacity', 0);
  }

  svg.append('path').datum(LAND).attr('class','country-stroke').attr('d',pathGen);
  if (opts.clickable) {
    svg.append('g').attr('class','countries-click-layer');
    svg.append('g').attr('class','country-hover-layer');
  }
  svg.append('g').attr('class','region-hl-layer');
  return svg;
}

// ── DRAW CELLS ────────────────────────────────────────────────────────────────
// duration=0 → instant. duration>0 → smooth RAF blend from current display state.
// If called while a blend is in progress, snapshots the current interpolated frame
// as the new "from" so transitions always chain seamlessly.
function drawCells(svg, field, feature, duration = 0) {
  if (!field || !DATA) return;
  const node = svg.node();
  if (!node || !node._displayCanvas) return;

  // Stop any in-progress animation and snapshot current display as "from"
  if (node._rafId) {
    cancelAnimationFrame(node._rafId);
    node._rafId = null;
  }
  const ctxA = node._canvasA.getContext('2d');
  ctxA.clearRect(0, 0, MAP_W, MAP_H);
  ctxA.drawImage(node._displayCanvas, 0, 0);

  // Render new target into canvasB
  renderToCanvas(node._canvasB, field, feature);

  const display = node._displayCanvas;
  const canvasA = node._canvasA, canvasB = node._canvasB;

  if (duration <= 0) {
    const ctx = display.getContext('2d');
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.drawImage(canvasB, 0, 0);
    return;
  }

  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const ease = d3.easeCubicInOut(t);
    const ctx = display.getContext('2d');
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.globalAlpha = 1 - ease;
    ctx.drawImage(canvasA, 0, 0);
    ctx.globalAlpha = ease;
    ctx.drawImage(canvasB, 0, 0);
    ctx.globalAlpha = 1;
    node._rafId = t < 1 ? requestAnimationFrame(frame) : null;
  }
  node._rafId = requestAnimationFrame(frame);
}

function getField(feature, scen, decade) {
  const fd = DATA.fields[feature];
  if (!fd) return null;
  const k = String(decade);
  return decade < 2015 ? fd.historical?.[k] : fd[scen]?.[k];
}

function drawLegendBar(sel, feature) {
  const svg = d3.select(sel);
  svg.selectAll('*').remove();
  const s = SCALES[feature];
  const W = 300, H = 12, LEFT = 8;
  const gid = `lg-${feature}-${Math.random().toString(36).slice(2)}`;
  const grad = svg.append('defs').append('linearGradient').attr('id',gid).attr('x1','0%').attr('x2','100%');
  for (let i=0;i<=24;i++) {
    const t=i/24, v=s.domain[0]+t*(s.domain[1]-s.domain[0]);
    grad.append('stop').attr('offset',`${t*100}%`).attr('stop-color',colorFor(v,feature));
  }
  svg.append('rect').attr('x',LEFT).attr('y',4).attr('width',W).attr('height',H)
    .attr('fill',`url(#${gid})`).attr('stroke','rgba(255,255,255,.08)').attr('rx',1);
  const sc = d3.scaleLinear().domain(s.domain).range([LEFT,LEFT+W]);
  svg.append('g').attr('class','legend-axis').attr('transform',`translate(0,${4+H})`)
    .call(d3.axisBottom(sc).ticks(7).tickFormat(s.fmt));
  svg.append('text').attr('x',LEFT+W+14).attr('y',4+H/2+4)
    .attr('font-family','var(--mono)').attr('font-size',10).attr('fill','#666').text(s.label);
}

// ── TOOLTIP ───────────────────────────────────────────────────────────────────
function showTip(e, html) {
  d3.select('#tooltip').style('opacity',1)
    .style('left',(e.clientX+14)+'px').style('top',(e.clientY+14)+'px').html(html);
}
function hideTip() { d3.select('#tooltip').style('opacity',0); }

// ── STORY MAPS ────────────────────────────────────────────────────────────────
const STORY_CFG = {
  ch1: { svgId:'#ch1-svg', legId:'#ch1-legend', badgeId:'#ch1-decade', feature:'tas', scen:'ssp585' },
  ch2: { svgId:'#ch2-svg', legId:'#ch2-legend', badgeId:'#ch2-decade', feature:'siconc', scen:'ssp585' },

  // Precipitation anomaly chapter
  ch3: {
    svgId:'#ch3-svg',
    legId:'#ch3-legend',
    badgeId:'#ch3-decade',
    feature:'pr',
    scen:'ssp585',
    precipLayer:true
  },

  // Temperature / wet-bulb chapter
  ch4: {
    svgId:'#ch4-svg',
    legId:'#ch4-legend',
    badgeId:null,
    feature:'tas',
    scen:'ssp585',
    fixedDecade:2090,
    wbLayer:true
  },
};

// Track what decade each story map is currently displaying so we can animate FROM it
const storyCurrentDecade = { ch1: 2020, ch2: 2020, ch3: 2020 };
// Animation cancellation tokens per chapter
const storyAnimToken = { ch1: 0, ch2: 0, ch3: 0 };

function initStoryMaps() {
  Object.values(STORY_CFG).forEach(cfg => {
    initBaseSvg(cfg.svgId, {
  wbLayer: !!cfg.wbLayer,
  precipLayer: !!cfg.precipLayer
});
    drawLegendBar(cfg.legId, cfg.feature);
    const decade = cfg.fixedDecade || 2020;
    drawCells(d3.select(cfg.svgId), getField(cfg.feature, cfg.scen, decade), cfg.feature);
    if (cfg.badgeId) d3.select(cfg.badgeId).text(`${decade}s`);
  });
}

// Animate smoothly through intermediate decades from current → target
function updateStoryMap(chId, targetDecade) {
  const cfg = STORY_CFG[chId];
  if (!cfg || cfg.fixedDecade) return;

  const fromDecade = storyCurrentDecade[chId];
  if (fromDecade === targetDecade) return;

  // Build list of decades to step through (exclusive of from, inclusive of to)
  const step = fromDecade < targetDecade ? 10 : -10;
  const frames = [];
  for (let d = fromDecade + step; d !== targetDecade + step; d += step) frames.push(d);

  // Calculate per-frame duration so total stays ~1.1s regardless of distance
  const perFrame = Math.max(180, Math.min(500, Math.floor(1100 / frames.length)));

  // Cancel any in-flight animation for this chapter
  const token = ++storyAnimToken[chId];

  let idx = 0;
  function tick() {
    if (storyAnimToken[chId] !== token) return;
    if (idx >= frames.length) return;

    const dec = frames[idx];
    const field = getField(cfg.feature, cfg.scen, dec);
    if (field) drawCells(d3.select(cfg.svgId), field, cfg.feature, perFrame);
    if (cfg.badgeId) animateBadge(cfg.badgeId, `${dec}s`);

    idx++;
    if (idx < frames.length) setTimeout(tick, perFrame + 20);
  }

  storyCurrentDecade[chId] = targetDecade;
  tick();
}

function animateBadge(sel, text) {
  const el = d3.select(sel);
  el.transition().duration(120).style('opacity', 0)
    .on('end', () => { el.text(text); el.transition().duration(200).style('opacity', 1); });
}

// ── HERO BG ───────────────────────────────────────────────────────────────────
function initHeroBg() {
  const svg = initBaseSvg('#hero-bg-svg');
  drawCells(svg, getField('tas','ssp585',2090), 'tas');
}

// ── CHAPTER 4 WET-BULB OVERLAY ────────────────────────────────────────────────
function initCh4WetBulb() {
  const svg = d3.select('#ch4-svg');
  const wbLayer = svg.select('.wb-layer');
  const field = getField('tas', 'ssp585', 2090);
  if (!field) return;

  const zones = [
    { cls:'wb-a', latLim:35, low:2.0, high:4.5,      fill:'#f5c842', op:0.38 },
    { cls:'wb-b', latLim:30, low:4.5, high:7.0,      fill:'#e05c3a', op:0.48 },
    { cls:'wb-c', latLim:25, low:7.0, high:Infinity, fill:'#c94f8a', op:0.58 },
  ];
  zones.forEach(z => {
    wbLayer.selectAll(`rect.${z.cls}`)
      .data(CELL_RECTS.filter(r => {
        const v = field[r.i][r.j];
        return Math.abs(r.lat) < z.latLim && v >= z.low && v < z.high && Number.isFinite(v);
      }))
      .join('rect').attr('class', z.cls)
      .attr('x',d=>d.x).attr('y',d=>d.y)
      .attr('width',d=>Math.max(.5,d.w+.5)).attr('height',d=>Math.max(.5,d.h+.5))
      .attr('fill', z.fill).attr('fill-opacity', z.op);
  });
}

function showWetBulb(visible) {
  d3.select('#ch4-svg').select('.wb-layer')
    .transition().duration(700).ease(d3.easeCubicInOut)
    .style('opacity', visible ? 1 : 0);
  const leg = document.getElementById('ch4-wb-legend');
  if (leg) leg.classList.toggle('visible', visible);
}

// ── CHAPTER 3 EQUATORIAL PRECIPITATION OVERLAY ───────────────────────────────
// Mirrors the Chapter 4 wet-bulb overlay: draw once from SSP5-8.5 2090s,
// then fade the layer on/off when the precipitation-risk scroll step is active.
function initCh3PrecipRisk() {
  const svg = d3.select('#ch3-svg');
  const precipLayer = svg.select('.precip-risk-layer');
  const field = getField('pr', 'ssp585', 2090);

  if (!field || precipLayer.empty()) return;

  precipLayer.selectAll('*').remove();

  const zones = [
    {
      cls: 'precip-dry',
      label: 'Much drier',
      latLim: 25,
      test: v => v <= -25,
      fill: PRECIP_RISK_COLORS.dry,
      op: 0.72
    },
    {
      cls: 'precip-wet',
      label: 'Much wetter',
      latLim: 25,
      test: v => v >= 25,
      fill: PRECIP_RISK_COLORS.wet,
      op: 0.72
    }
  ];

  zones.forEach(z => {
    precipLayer.selectAll(`rect.${z.cls}`)
      .data(CELL_RECTS.filter(r => {
        const v = field[r.i][r.j];

        return (
          Number.isFinite(v) &&
          Math.abs(r.lat) <= z.latLim &&
          Math.abs(v) >= 25 &&
          z.test(v)
        );
      }))
      .join('rect')
      .attr('class', z.cls)
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => Math.max(0.5, d.w + 0.5))
      .attr('height', d => Math.max(0.5, d.h + 0.5))
      .attr('fill', z.fill)
      .attr('fill-opacity', z.op)
      .attr('stroke', 'rgba(255,255,255,0.55)')
      .attr('stroke-width', 0.25)
      .attr('pointer-events', 'none');
  });
}

function showPrecipRisk(visible) {
  d3.select('#ch3-svg')
    .select('.precip-risk-layer')
    .transition()
    .duration(700)
    .ease(d3.easeCubicInOut)
    .style('opacity', visible ? 1 : 0);

  const leg = document.getElementById('ch3-precip-risk-legend');
  if (leg) leg.classList.toggle('visible', visible);
}

// ── CHAPTER 4 COUNTRY IMPACT LAYER ────────────────────────────────────────────
function initCh4Countries() {
  const svg = d3.select('#ch4-svg');
  // Insert between wb-layer and country-stroke so borders render on top
  svg.insert('g', '.country-stroke')
     .attr('class', 'countries-impact-layer')
     .style('opacity', 0);

  const field = getField('tas', 'ssp585', 2090);
  if (!field) return;

  // Compute per-country mean warming via bounding-box grid lookup
  const countryData = COUNTRIES_GEO.features.map(feat => {
    const [[lon0, lat0], [lon1, lat1]] = d3.geoBounds(feat);
    const [cLon, cLat] = d3.geoCentroid(feat);
    const wrapAround = (lon1 - lon0) > 340;

    let sum = 0, n = 0;
    CELL_RECTS.forEach(r => {
      const inLat = r.lat >= lat0 && r.lat <= lat1;
      const inLon = wrapAround || (r.lon >= lon0 && r.lon <= lon1);
      if (inLat && inLon) {
        const v = field[r.i][r.j];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
    });
    return { feat, mean: n > 0 ? sum / n : null, n, cLat };
  }).filter(d => d.n > 0 && d.mean !== null);

  // Most impacted: highest anomaly among tropical/subtropical nations (lat < 55°)
  // This excludes Arctic amplification skewing the ranking toward Russia/Canada
  const tropical = [...countryData]
    .filter(d => Math.abs(d.cLat) < 55)
    .sort((a, b) => b.mean - a.mean);
  const mostAffectedIds = new Set(tropical.slice(0, 35).map(d => parseInt(d.feat.id)));

  svg.select('.countries-impact-layer')
    .selectAll('path.impact-country')
    .data(COUNTRIES_GEO.features)
    .join('path')
      .attr('class', 'impact-country')
      .attr('d', pathGen)
      .attr('fill', d => {
        const id = parseInt(d.id);
        if (mostAffectedIds.has(id)) return INJUSTICE_COLORS.impactedFill;
        if (MAJOR_EMITTER_IDS.has(id)) return INJUSTICE_COLORS.emitterFill;
        return 'none';
      })
      .attr('fill-opacity', d => {
        const id = parseInt(d.id);
        if (mostAffectedIds.has(id)) return 0.50;
        if (MAJOR_EMITTER_IDS.has(id)) return 0.42;
        return 0;
      })
      .attr('stroke', d => {
        const id = parseInt(d.id);
        if (mostAffectedIds.has(id)) return INJUSTICE_COLORS.impactedStroke;
        if (MAJOR_EMITTER_IDS.has(id)) return INJUSTICE_COLORS.emitterStroke;
        return 'none';
      })
      .attr('stroke-width', d => {
        const id = parseInt(d.id);
        return (mostAffectedIds.has(id) || MAJOR_EMITTER_IDS.has(id)) ? 1.1 : 0;
      })
      .attr('pointer-events', 'none');
}

function showInjustice(visible) {
  d3.select('#ch4-svg').select('.countries-impact-layer')
    .transition().duration(700).ease(d3.easeCubicInOut)
    .style('opacity', visible ? 1 : 0);
  const leg = document.getElementById('ch4-injustice-legend');
  if (leg) leg.classList.toggle('visible', visible);
}

// ── FORK MAPS ─────────────────────────────────────────────────────────────────
function initForkMaps() {
  ['#fork-svg-126','#fork-svg-585'].forEach(sel => initBaseSvg(sel));
  drawCells(d3.select('#fork-svg-126'), getField('tas','ssp126',2090), 'tas');
  drawCells(d3.select('#fork-svg-585'), getField('tas','ssp585',2090), 'tas');
  if (document.querySelector('#fork-legend')) drawLegendBar('#fork-legend','tas');
}

// ── CH6 COUNTRY CLICK ─────────────────────────────────────────────────────────
function initCh6() {
  const svg = initBaseSvg('#ch6-svg', {clickable:true});
  svg.select('.countries-click-layer').selectAll('path.country-path')
    .data(COUNTRIES_GEO.features).join('path')
    .attr('class','country-path').attr('d',pathGen)
    .attr('fill','rgba(255,255,255,0.03)')
    .attr('stroke','rgba(255,255,255,.22)').attr('stroke-width',.5)
    .style('cursor','pointer')
    .on('mouseenter', function(e,d) {
      d3.select(this).attr('fill','rgba(123,108,240,0.22)');
      showTip(e, `<strong>${ISO_NAMES[parseInt(d.id)] || 'Country'}</strong>`);
    })
    .on('mouseleave', function() { d3.select(this).attr('fill','rgba(255,255,255,0.03)'); hideTip(); })
    .on('click', function(e,d) {
      svg.selectAll('.country-path').attr('fill','rgba(255,255,255,0.03)');
      d3.select(this).attr('fill','rgba(123,108,240,0.32)');
      showCountryDetail(d);
    });
}

function getWetBulbRisk(lat, warming) {
  const a = Math.abs(lat);
  if (a < 25 && warming >= 4.0) return { label:'Extreme',   color:'#c94f8a', desc:'Near or exceeding physiological survival limits during peak summer weeks. Outdoor labor will be life-threatening for months each year by 2090.' };
  if (a < 30 && warming >= 3.0) return { label:'Very High', color:'#e05c3a', desc:'Unsafe for outdoor labor for extended periods. Shade and active cooling become survival necessities, not luxuries.' };
  if (a < 40 && warming >= 2.0) return { label:'High',      color:'#f5a623', desc:'Significant heat stress during summer months. Elderly people and outdoor workers face growing mortality risk during heat events.' };
  if (a >= 55)                   return { label:'Lower',     color:'#4a9eca', desc:'Wet-bulb thresholds are rarely approached, but permafrost thaw, ecosystem disruption, and intense storm changes are primary concerns.' };
  return                                { label:'Moderate',  color:'#f5c842', desc:'Heat events are increasing in frequency and intensity. Infrastructure and agriculture face growing stress from changing conditions.' };
}

// Build a fully data-driven narrative from each country's actual projected values
function buildCountryNarrative(name, lat, w585, w126, pr585) {
  const pieces = [];
  const a = Math.abs(lat);
  const w = w585.toFixed(1), wL = w126.toFixed(1);

  // Temperature framing based on magnitude
  if (w585 >= 6)        pieces.push(`${name} faces catastrophic warming of +${w}°C above the pre-industrial baseline by 2090 under high emissions — among the most extreme projections anywhere on Earth.`);
  else if (w585 >= 4)   pieces.push(`${name} is projected to warm +${w}°C above pre-industrial levels by 2090 under high emissions, severe enough to fundamentally reshape ecosystems, agriculture, and human health.`);
  else if (w585 >= 2.5) pieces.push(`${name} faces significant warming of +${w}°C by 2090 under high emissions, with growing risks to water availability, food systems, and heat-vulnerable communities.`);
  else                  pieces.push(`${name} is projected to warm +${w}°C by 2090 under high emissions, with increasing frequency of heat extremes and shifting seasonal patterns.`);

  // Precipitation or high-latitude context
  if (a >= 60) {
    pieces.push(`At this latitude, warming is among the fastest on Earth. Permafrost thaw is destabilizing infrastructure and releasing stored carbon, while sea-ice loss is reshaping ecosystems and traditional livelihoods.`);
  } else {
    const pr = Math.round(pr585);
    if (pr585 <= -25)      pieces.push(`Rainfall is projected to fall by ${Math.abs(pr)}% — a severe drought signal that would devastate rainfed agriculture and freshwater reserves.`);
    else if (pr585 <= -10) pieces.push(`Rainfall is projected to decline ~${Math.abs(pr)}%, placing growing stress on water security and food production.`);
    else if (pr585 >= 20)  pieces.push(`Precipitation may increase ~${pr}%, but heavier rainfall typically concentrates into more intense flooding events rather than reliable water supply.`);
    else if (pr585 >= 8)   pieces.push(`Rainfall is projected to increase modestly (~${pr}%), though longer dry spells interrupted by more intense bursts will intensify.`);
    else                   pieces.push(`Total precipitation changes are small, but rainfall extremes — longer dry periods and more intense individual events — are projected to intensify.`);
  }

  // Mitigation gap — how much the choice of scenario matters here
  const gap = w585 - w126;
  if (gap >= 3)        pieces.push(`Strong global mitigation could limit warming here to just +${wL}°C — a ${gap.toFixed(1)}°C difference that represents profoundly different futures for the people who live here.`);
  else if (gap >= 1.5) pieces.push(`Aggressive emissions cuts could limit local warming to +${wL}°C — ${gap.toFixed(1)}°C less than the high-emissions path.`);

  return pieces.join(' ');
}

function showCountryDetail(feature) {
  const id = parseInt(feature.id);
  const name = ISO_NAMES[id] || 'Selected Country';
  d3.select('#country-placeholder').style('display','none');
  d3.select('#country-detail').style('display','block');
  d3.select('#country-name').text(name);
  d3.select('#country-sub').text('Projected warming vs. pre-industrial baseline · three future paths');

  const centroid = pathGen.centroid(feature);
  if (!centroid || isNaN(centroid[0])) return;
  const [lng, lat] = projection.invert(centroid) || [0,0];
  const radius = 15;

  // Compute area-weighted mean for a given feature/scenario/decade near this centroid
  function localMean(feature, scen, decade) {
    const fd = DATA.fields[feature];
    const field = decade < 2015 ? fd.historical?.[String(decade)] : fd[scen]?.[String(decade)];
    if (!field) return null;
    let sum=0, n=0;
    DATA.meta.lat.forEach((la,i) => DATA.meta.lon.forEach((lo,j) => {
      if (Math.abs(la-lat)<radius && Math.abs(lo-lng)<radius) { sum+=field[i][j]; n++; }
    }));
    return n > 0 ? sum/n : null;
  }

  function seriesForScen(scen) {
    return [...DATA.meta.decades_hist, ...DATA.meta.decades_fut].map(dec => {
      const v = localMean('tas', scen, dec);
      return v !== null ? {year:dec+5, value:v} : null;
    }).filter(Boolean);
  }

  const hist = seriesForScen('historical').filter(d=>d.year<=2014);
  const s126 = seriesForScen('ssp126').filter(d=>d.year>=2015);
  const s245 = seriesForScen('ssp245').filter(d=>d.year>=2015);
  const s585 = seriesForScen('ssp585').filter(d=>d.year>=2015);

  drawCountryLine({ hist, s126, s245, s585 });

  // Extract 2090 projected values for the summary card
  const last585 = s585.find(d=>d.year===2095) ?? s585[s585.length-1];
  const last126 = s126.find(d=>d.year===2095) ?? s126[s126.length-1];
  const w585 = last585 ? last585.value : 0;
  const w126 = last126 ? last126.value : 0;

  // Precipitation anomaly at 2090 SSP5-8.5 (percent change from baseline)
  const pr585 = localMean('pr', 'ssp585', 2090) ?? 0;

  const risk = getWetBulbRisk(lat, w585);
  const narrative = buildCountryNarrative(name, lat, w585, w126, pr585);

  const summary = document.getElementById('country-climate-summary');
  if (!summary) return;
  summary.innerHTML = `
    <div class="climate-risk-card">
      <div class="risk-row">
        <span class="risk-label">Wet-bulb heat risk · 2090s</span>
        <span class="risk-badge" style="background:${risk.color}20;color:${risk.color};border-color:${risk.color}55">${risk.label}</span>
      </div>
      <div class="risk-desc">${risk.desc}</div>
      <div class="warming-stats">
        <div class="wstat">
          <span class="wstat-val" style="color:var(--scen-585)">+${w585.toFixed(1)}°C</span>
          <span class="wstat-lbl">No action · 2090s</span>
        </div>
        <div class="wstat">
          <span class="wstat-val" style="color:var(--scen-126)">+${w126.toFixed(1)}°C</span>
          <span class="wstat-lbl">Strong action · 2090s</span>
        </div>
        <div class="wstat">
          <span class="wstat-val" style="color:var(--ink-soft)">${(w585 - w126).toFixed(1)}°C</span>
          <span class="wstat-lbl">Difference if world acts</span>
        </div>
      </div>
      <p class="climate-narrative">${narrative}</p>
    </div>`;
}

function drawCountryLine({hist, s126, s245, s585}) {
  const cSvg = d3.select('#country-line-svg');
  cSvg.selectAll('*').remove();
  const W=400, H=220, m={top:16,right:80,bottom:32,left:46};
  const pw=W-m.left-m.right, ph=H-m.top-m.bottom;
  const g = cSvg.append('g').attr('transform',`translate(${m.left},${m.top})`);
  const all = [...hist,...s126,...s245,...s585];
  if (!all.length) return;
  const xSc = d3.scaleLinear().domain([1850,2100]).range([0,pw]);
  const ySc = d3.scaleLinear().domain(d3.extent(all,d=>d.value)).nice().range([ph,0]);
  const lg = d3.line().x(d=>xSc(d.year)).y(d=>ySc(d.value)).curve(d3.curveCatmullRom);
  g.append('g').attr('class','axis').attr('transform',`translate(0,${ph})`).call(d3.axisBottom(xSc).ticks(5).tickFormat(d3.format('d')));
  g.append('g').attr('class','axis').call(d3.axisLeft(ySc).ticks(5).tickFormat(d=>d+'°'));
  g.append('line').attr('class','zero-line').attr('x1',0).attr('x2',pw).attr('y1',ySc(0)).attr('y2',ySc(0));
  [[hist,'#777'],[s126,'#4a9eca'],[s245,'#f5a623'],[s585,'#e05c3a']].forEach(([data,color]) => {
    if (!data.length) return;
    g.append('path').datum(data).attr('fill','none').attr('stroke',color).attr('stroke-width',1.8).attr('d',lg);
  });
  [['SSP1-2.6','#4a9eca',s126],['SSP2-4.5','#f5a623',s245],['SSP5-8.5','#e05c3a',s585]].forEach(([lbl,color,data],i) => {
    const last = data[data.length-1];
    if (!last) return;
    g.append('text').attr('x',xSc(last.year)+4).attr('y',ySc(last.value)+i*12)
      .attr('fill',color).attr('font-family','var(--mono)').attr('font-size',9).text(lbl);
  });
}

// ── CHAPTER NAV ───────────────────────────────────────────────────────────────
function initChapterNav() {
  const nav = document.getElementById('chapter-nav');
  new IntersectionObserver(([e]) => nav.classList.toggle('visible', !e.isIntersecting), { threshold: 0.1 })
    .observe(document.getElementById('hero'));

  const sectionObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll('.ch-dot').forEach(d => d.classList.remove('active'));
        const dot = document.querySelector(`.ch-dot[data-ch="${e.target.id}"]`);
        if (dot) dot.classList.add('active');
      }
    });
  }, { threshold: 0.35 });
  ['ch1','ch2','ch3','ch4','ch5','ch6','explorer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) sectionObs.observe(el);
  });
}

// ── SCROLL SPY ────────────────────────────────────────────────────────────────
function initScrollSpy() {
  const stepObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const step = entry.target;
      const chEl = step.closest('.chapter');
      if (!chEl) return;

      chEl.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
      step.classList.add('active');

      const decade = parseInt(step.dataset.decade);
      const mode = step.dataset.mode || 'base';

      if (!isNaN(decade)) {
        updateStoryMap(chEl.id, decade);
      }

      // Chapter 3 precipitation-risk overlay, implemented like the wet-bulb overlay.
      if (chEl.id === 'ch3') {
        showPrecipRisk(mode === 'precip-risk');

        const label = chEl.querySelector('.map-label');
        if (label) {
          const decadeText = !isNaN(decade) ? `${decade}s` : '2090s';
          label.innerHTML = mode === 'precip-risk'
            ? `Equatorial High-Precipitation Anomaly · <span id="ch3-decade">${decadeText}</span>`
            : `Precipitation Anomaly · <span id="ch3-decade">${decadeText}</span>`;
        }
      } else {
        showPrecipRisk(false);
      }
    });
  }, { threshold: 0.55 });

  document.querySelectorAll('.step[data-decade]').forEach(s => stepObs.observe(s));

  const ch4Steps = document.querySelectorAll('#ch4 .step');
  const CH4_LABELS = {
    wetbulb:  'Wet-Bulb Risk Zones · 2090s · Tropical Approximation',
    injustice: 'Climate Injustice · 2090s · Impact vs. Responsibility',
  };

  const ch4Obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      ch4Steps.forEach(s => s.classList.remove('active'));
      entry.target.classList.add('active');

      const mode = entry.target.dataset.mode;
      showWetBulb(mode === 'wetbulb');
      showInjustice(mode === 'injustice');

      const lbl = document.getElementById('ch4-map-label');
      if (lbl) lbl.textContent = CH4_LABELS[mode] || 'Temperature Anomaly · 2090s · Who Gets Hit Hardest';
    });
  }, { threshold: 0.55 });

  ch4Steps.forEach(s => ch4Obs.observe(s));

  const fadeObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('active'); });
  }, { threshold: 0.3 });

  document.querySelectorAll('#ch5 .step, #ch6 .step').forEach(s => fadeObs.observe(s));
}

// ── EXPLORER ──────────────────────────────────────────────────────────────────
function initExplorer() {
  const state = { scenario:'ssp245', feature:'tas', compareDecades:[2050,2090], regions:[] };
  const LINE_W=1400, LINE_H=300;
  const MARGIN={top:14,right:100,bottom:38,left:62};
  const PW=LINE_W-MARGIN.left-MARGIN.right, PH=LINE_H-MARGIN.top-MARGIN.bottom;

  const FEAT_META = {
    tas:    { title:'Temperature anomaly maps', sub:'Δ°C vs 1850–1900', notes:'<strong>Temperature anomaly.</strong> Red = warming above pre-industrial baseline. Brush the line chart or press Play to animate; drag boxes on maps to compare regions.' },
    pr:     { title:'Precipitation anomaly maps', sub:'Δ% vs baseline', notes:'<strong>Precipitation anomaly.</strong> Teal = wetter, brown = drier than 1850–1900 average.' },
    siconc: { title:'Sea ice concentration maps', sub:'% ocean coverage', notes:'<strong>Sea ice concentration.</strong> Blue = ice-covered ocean. Region brushing disabled for sea ice.' }
  };

  // ── Explorer map helpers ──
  function initEMap(sel) {
    const svg = d3.select(sel);
    svg.selectAll('*').remove();

    const clipId = 'sph-clip-' + sel.replace(/[^a-z0-9]/gi, '');
    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('path').datum({type:'Sphere'}).attr('d', pathGen);

    svg.append('path').datum({type:'Sphere'}).attr('class','ocean-sphere').attr('d',pathGen);
    svg.append('path').datum(d3.geoGraticule().step([30,30])()).attr('class','graticule').attr('d',pathGen);
    svg.append('path').datum(LAND).attr('class','land-fill').attr('d',pathGen);

    const node = svg.node();
    node._displayCanvas = attachDisplayCanvas(svg, clipId);
    node._canvasA = mkOffscreen();
    node._canvasB = mkOffscreen();
    node._rafId = null;

    svg.append('path').datum(LAND).attr('class','country-stroke').attr('d',pathGen);
    svg.append('g').attr('class','region-hl-layer');
    if (state.feature !== 'siconc') {
      const brushG = svg.append('g').attr('class','region-brush');
      const brush = d3.brush().extent([[0,0],[MAP_W,MAP_H]]).on('end', ev => eBrushEnd(ev, brushG, brush));
      brushG.call(brush);
    }
  }

  function updateEMap(sel, decade, duration = 0) {
    const field = getField(state.feature, state.scenario, decade);
    const svg = d3.select(sel);
    const node = svg.node();
    if (!field || !node || !node._displayCanvas) return;
    drawCells(svg, field, state.feature, duration);
    drawERegions(svg);
  }

  function drawERegions(svg) {
    svg.select('.region-hl-layer').selectAll('*').remove();
    if (!state.regions.length || state.feature==='siconc') return;
    state.regions.forEach((r,idx) => {
      const c = REGION_COLORS[idx];
      const corners = [[r.lon0,r.lat1],[r.lon1,r.lat1],[r.lon1,r.lat0],[r.lon0,r.lat0]].map(p=>projection(p));
      if (corners.some(p=>!p)) return;
      const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
      svg.select('.region-hl-layer').append('rect').attr('class','region-highlight')
        .attr('x',Math.min(...xs)).attr('y',Math.min(...ys))
        .attr('width',Math.max(...xs)-Math.min(...xs)).attr('height',Math.max(...ys)-Math.min(...ys))
        .attr('fill',c).attr('stroke',c);
    });
  }

  function eBrushEnd(event, brushG, brush) {
    if (!event.selection) return;
    const [[x0,y0],[x1,y1]] = event.selection;
    const p0=projection.invert([x0,y0]), p1=projection.invert([x1,y1]);
    if (!p0||!p1) return;
    state.regions.push({lon0:Math.min(p0[0],p1[0]),lon1:Math.max(p0[0],p1[0]),lat0:Math.min(p0[1],p1[1]),lat1:Math.max(p0[1],p1[1])});
    state.regions = state.regions.slice(-2);
    updateRegionUI();
    brushG.call(brush.move, null);
    redrawE(400);
    drawELine();
  }

  function updateRegionUI() {
    const n=state.regions.length;
    d3.select('#region-badge').style('display',n?'inline-block':'none');
    d3.select('#clear-region').style('display',n?'inline-block':'none');
    d3.select('#region-filter-control').style('display',n?'flex':'none');
    d3.select('#region-filter-badge').text(n===1?'1 region':`${n} regions`);
  }

  function redrawE(duration = 0) {
    const [a,b] = state.compareDecades.slice().sort((x,y)=>x-y);
    state.compareDecades=[a,b];
    d3.select('#year-readout').text(`${a}s vs ${b}s`);
    d3.select('#map-left-label').text(`${a}s`);
    d3.select('#map-right-label').text(`${b}s`);
    updateEMap('#map-svg-left', a, duration);
    updateEMap('#map-svg-right', b, duration);
  }

  // ── Line chart ──
  const lSvg = d3.select('#line-svg');
  const gP = lSvg.append('g').attr('transform',`translate(${MARGIN.left},${MARGIN.top})`);
  const xSc = d3.scaleLinear().domain([1850,2100]).range([0,PW]);
  const ySc = d3.scaleLinear().range([PH,0]);
  const gX = gP.append('g').attr('class','axis').attr('transform',`translate(0,${PH})`);
  const gY = gP.append('g').attr('class','axis');
  const gLns = gP.append('g');
  const gMks = gP.append('g');
  gP.append('line').attr('class','zero-line').attr('x1',0).attr('x2',PW);
  const lGen = d3.line().x(d=>xSc(d.year)).y(d=>ySc(d.value)).curve(d3.curveCatmullRom);
  const gYBrush = gP.append('g').attr('class','year-brush');

  function seriesGM(scen, feature) {
    const gm = DATA.global_mean[feature];
    return gm ? (gm[scen]||[]).map(d=>({year:d.year,value:d.value})) : [];
  }

  function seriesRegion(scen, feature, region) {
    return [...DATA.meta.decades_hist,...DATA.meta.decades_fut].map(dec => {
      const field=getField(feature,scen,dec); if (!field) return null;
      let sum=0, wt=0;
      DATA.meta.lat.forEach((la,i) => {
        if (la<region.lat0||la>region.lat1) return;
        const w=Math.cos(la*Math.PI/180);
        DATA.meta.lon.forEach((lo,j) => {
          if (lo<region.lon0||lo>region.lon1) return;
          sum+=field[i][j]*w; wt+=w;
        });
      });
      return wt>0?{year:dec+5,value:sum/wt}:null;
    }).filter(Boolean);
  }

  function sColor(scen){return scen==='ssp126'?'var(--scen-126)':scen==='ssp245'?'var(--scen-245)':'var(--scen-585)';}

  function updateTimeMarkers(animated = false) {
    if (animated) {
      // Smoothly slide the markers to new positions
      state.compareDecades.forEach((dec, idx) => {
        const x = xSc(dec+5);
        const lines = gMks.selectAll(`line.time-marker-${idx}`);
        const texts = gMks.selectAll(`text.time-label-${idx}`);
        if (!lines.empty()) {
          lines.transition().duration(900).ease(d3.easeCubicInOut).attr('x1',x).attr('x2',x);
          texts.transition().duration(900).ease(d3.easeCubicInOut).attr('x',x+4).text(`${dec}s`);
          return;
        }
        // First draw
        gMks.append('line').attr('class',`time-marker time-marker-${idx}`)
          .attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',PH);
        gMks.append('text').attr('class',`time-label-${idx}`)
          .attr('x',x+4).attr('y',12)
          .attr('font-family','var(--mono)').attr('font-size',10)
          .attr('fill','var(--accent)').text(`${dec}s`);
      });
    } else {
      gMks.selectAll('*').remove();
      state.compareDecades.forEach((dec,idx) => {
        const x = xSc(dec+5);
        gMks.append('line').attr('class',`time-marker time-marker-${idx}`)
          .attr('x1',x).attr('x2',x).attr('y1',0).attr('y2',PH);
        gMks.append('text').attr('class',`time-label-${idx}`)
          .attr('x',x+4).attr('y',12)
          .attr('font-family','var(--mono)').attr('font-size',10)
          .attr('fill','var(--accent)').text(`${dec}s`);
      });
    }
  }

  function drawELine() {
    const feat=state.feature, scen=state.scenario;
    const hist=seriesGM('historical',feat), fut=seriesGM(scen,feat);
    const regSeries=state.regions.map(r=>seriesRegion(scen,feat,r));
    const all=[...hist,...fut,...regSeries.flat()].filter(d=>Number.isFinite(d.value));
    if (!all.length) return;
    let ext=d3.extent(all,d=>d.value);
    if (feat==='tas') ext=[Math.min(-1,ext[0]),Math.max(5,ext[1])];
    else if (feat==='siconc') ext=[0,Math.max(55,ext[1])];
    else ext=[Math.min(-25,ext[0]),Math.max(25,ext[1])];
    ySc.domain(ext).nice();
    gX.call(d3.axisBottom(xSc).tickFormat(d3.format('d')).ticks(8));
    gY.call(d3.axisLeft(ySc).tickFormat(SCALES[feat].fmt).ticks(5));
    gP.select('.zero-line').attr('y1',ySc(0)).attr('y2',ySc(0)).style('display',feat==='siconc'?'none':null);
    gLns.selectAll('*').remove();
    gLns.append('path').datum(hist).attr('class','hist-line').attr('d',lGen);
    gLns.append('path').datum(fut).attr('class','global-line').attr('stroke',sColor(scen)).attr('d',lGen);
    regSeries.forEach((data,idx) => {
      gLns.append('path').datum(data).attr('fill','none').attr('stroke',REGION_COLORS[idx])
        .attr('stroke-width',2).attr('stroke-dasharray','6 4').attr('d',lGen);
    });
    const lastFut=fut[fut.length-1];
    if (lastFut) gLns.append('text')
      .attr('x',xSc(lastFut.year)+4).attr('y',ySc(lastFut.value)+4)
      .attr('fill',sColor(scen)).attr('font-family','var(--mono)').attr('font-size',10)
      .text(scen.toUpperCase());
    updateTimeMarkers(false);
  }

  // ── Year brush ──
  function applyBrushSelection(ev, transitionDur) {
    if (!ev.selection) return;
    const [x0,x1]=ev.selection;
    const clamp=d=>Math.max(1850,Math.min(2090,Math.floor(d/10)*10));
    state.compareDecades=[clamp(xSc.invert(x0)),clamp(xSc.invert(x1))].sort((a,b)=>a-b);
    d3.select('#year-readout').text(`${state.compareDecades[0]}s vs ${state.compareDecades[1]}s`);
    d3.select('#map-left-label').text(`${state.compareDecades[0]}s`);
    d3.select('#map-right-label').text(`${state.compareDecades[1]}s`);
    updateEMap('#map-svg-left',  state.compareDecades[0], transitionDur);
    updateEMap('#map-svg-right', state.compareDecades[1], transitionDur);
    updateTimeMarkers(false);
  }
  const yBrush = d3.brushX().extent([[0,0],[PW,PH]])
    .on('brush', ev => applyBrushSelection(ev, 0))    // instant while dragging
    .on('end',   ev => applyBrushSelection(ev, 380)); // smooth finish
  gYBrush.call(yBrush);

  // ── PLAYBACK ──────────────────────────────────────────────────────────────
  // All future decades the play button steps through
  const PLAY_DECADES = [2020, 2030, 2040, 2050, 2060, 2070, 2080, 2090];
  // Duration each cell takes to morph to the new color (slightly shorter than interval)
  const PLAY_TRANS_MS  = 1150;
  const PLAY_INTERVAL  = 1300;

  let playTimer = null;
  let playIdx   = 0;

  // Animate ONE map through a sequence of intermediate decades from currentDecade → targetDecade.
  // This gives the "slow evolving map" effect for each play step.
  function animateMapToDecade(sel, currentDecade, targetDecade) {
    if (currentDecade === targetDecade) {
      updateEMap(sel, targetDecade, PLAY_TRANS_MS);
      return;
    }
    // Step through every intermediate decade with a quick transition so you can see each frame
    const step = currentDecade < targetDecade ? 10 : -10;
    const frames = [];
    for (let d = currentDecade + step; d !== targetDecade + step; d += step) frames.push(d);
    const frameDur = Math.max(160, Math.floor(PLAY_TRANS_MS / frames.length));

    let i = 0;
    function tick() {
      if (i >= frames.length) return;
      updateEMap(sel, frames[i], frameDur);
      i++;
      if (i < frames.length) setTimeout(tick, frameDur + 15);
    }
    tick();
  }

  function startPlay() {
    d3.select('#play-btn').text('⏸ Pause').classed('playing', true);

    playTimer = d3.interval(() => {
      const prevIdx = playIdx;
      playIdx = (playIdx + 1) % PLAY_DECADES.length;

      const right = PLAY_DECADES[playIdx];
      const left  = playIdx > 0 ? PLAY_DECADES[playIdx - 1] : PLAY_DECADES[0];

      const prevRight = PLAY_DECADES[prevIdx];
      const prevLeft  = prevIdx > 0 ? PLAY_DECADES[prevIdx - 1] : PLAY_DECADES[0];

      state.compareDecades = [left, right];

      // Update labels
      d3.select('#year-readout').text(`${left}s vs ${right}s`);
      d3.select('#map-left-label').text(`${left}s`);
      d3.select('#map-right-label').text(`${right}s`);

      // Animate each map through intermediate decades so you see the gradual change
      animateMapToDecade('#map-svg-left',  prevLeft,  left);
      animateMapToDecade('#map-svg-right', prevRight, right);

      // Slide the time markers
      updateTimeMarkers(true);

      if (playIdx === PLAY_DECADES.length - 1) stopPlay();
    }, PLAY_INTERVAL);
  }

  function stopPlay() {
    if (playTimer) { playTimer.stop(); playTimer = null; }
    d3.select('#play-btn').text('▶ Play').classed('playing', false);
  }

  d3.select('#play-btn').on('click', () => {
    if (playTimer) { stopPlay(); }
    else {
      playIdx = 0;
      // Reset both maps to starting decade (2020) so playback begins from the start
      state.compareDecades = [PLAY_DECADES[0], PLAY_DECADES[0]];
      updateEMap('#map-svg-left',  PLAY_DECADES[0]);
      updateEMap('#map-svg-right', PLAY_DECADES[0]);
      startPlay();
    }
  });

  // ── Controls ──
  d3.select('#clear-region').on('click', () => { state.regions=[]; updateRegionUI(); redrawE(400); drawELine(); });
  d3.select('#clear-region-ctrl').on('click', () => { state.regions=[]; updateRegionUI(); redrawE(400); drawELine(); });

  function setActiveExplainer(boxId, attrName, value) {
    d3.selectAll(`#${boxId} .explorer-explainer`).classed('active', false);
    d3.select(`#${boxId} .explorer-explainer[${attrName}="${value}"]`).classed('active', true);
  }

  d3.selectAll('#scenario-toggle button').on('click', function() {
    state.scenario=this.dataset.scen;
    d3.selectAll('#scenario-toggle button').classed('active',false);
    d3.select(this).classed('active',true);
    setActiveExplainer('scenario-explainer-box', 'data-scen', state.scenario);
    redrawE(500); drawELine();
  });

  d3.select('#feature-select').on('change', function() {
    stopPlay();
    state.feature=this.value;
    if (state.feature==='siconc') state.regions=[];
    updateRegionUI();
    setActiveExplainer('variable-explainer-box', 'data-feat', state.feature);
    const meta=FEAT_META[state.feature];
    d3.select('#map-title').text(meta.title);
    d3.select('#map-subtitle').text(meta.sub);
    d3.select('#notes-body').html(meta.notes);
    d3.select('#line-title').text(meta.title.replace(' maps',''));
    initEMap('#map-svg-left'); initEMap('#map-svg-right');
    drawLegendBar('#legend-svg',state.feature);
    redrawE(); drawELine();
  });

  // ── Init ──
  initEMap('#map-svg-left');
  initEMap('#map-svg-right');
  drawLegendBar('#legend-svg','tas');
  d3.select('#notes-body').html(FEAT_META['tas'].notes);
  redrawE();
  drawELine();
  gYBrush.call(yBrush.move, [xSc(2055), xSc(2095)]);
}


// ── CONTRIBUTION VS IMPACT SCATTERPLOTS ─────────────────────────────────────
function getCountryClimateMean(feature, scen, decade, geoFeature) {
  const field = getField(feature, scen, decade);
  if (!field || !geoFeature) return null;

  const [[lon0, lat0], [lon1, lat1]] = d3.geoBounds(geoFeature);
  const wrapAround = (lon1 - lon0) > 340;
  let sum = 0;
  let wt = 0;

  CELL_RECTS.forEach(r => {
    const inLat = r.lat >= lat0 && r.lat <= lat1;
    const inLon = wrapAround || (r.lon >= lon0 && r.lon <= lon1);
    if (!inLat || !inLon) return;

    const v = field[r.i][r.j];
    if (!Number.isFinite(v)) return;

    const w = Math.max(0.05, Math.cos(r.lat * Math.PI / 180));
    sum += v * w;
    wt += w;
  });

  return wt > 0 ? sum / wt : null;
}

function buildCountryImpactScatterData(metric) {
  if (!COUNTRIES_GEO || !EMISSIONS_COUNTRIES.length) return [];

  const totalCumulative = d3.sum(EMISSIONS_COUNTRIES, d => Math.max(0, d.cumulativeCo2 || 0));
  const out = [];

  COUNTRIES_GEO.features.forEach(feat => {
    const id = parseInt(feat.id);
    const name = ISO_NAMES[id] || feat.properties?.name || '';
    const key = canonicalCountryName(name);
    const rec = EMISSIONS_BY_KEY.get(key);
    if (!rec || !Number.isFinite(rec.cumulativeCo2) || rec.cumulativeCo2 <= 0) return;

    const temp = getCountryClimateMean('tas', 'ssp585', 2090, feat);
    const precip = getCountryClimateMean('pr', 'ssp585', 2090, feat);
    if (!Number.isFinite(temp) || !Number.isFinite(precip)) return;

    const contributionPct = totalCumulative > 0 ? (rec.cumulativeCo2 / totalCumulative) * 100 : 0;
    const impact = metric === 'pr' ? Math.abs(precip) : temp;

    if (!Number.isFinite(contributionPct) || !Number.isFinite(impact)) return;

    out.push({
      id,
      name: rec.country || name,
      contributionPct,
      impact,
      temp,
      precip,
      cumulativeCo2: rec.cumulativeCo2,
      isMajorEmitter: MAJOR_EMITTER_IDS.has(id)
    });
  });

  return out;
}

function simpleLinearFit(points) {
  const n = points.length;
  if (n < 2) return null;

  const xMean = d3.mean(points, d => d.contributionPct);
  const yMean = d3.mean(points, d => d.impact);
  let ssXX = 0, ssXY = 0, ssYY = 0;

  points.forEach(d => {
    const dx = d.contributionPct - xMean;
    const dy = d.impact - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  });

  if (ssXX === 0 || ssYY === 0) return null;
  const slope = ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  return { slope, intercept, r, r2: r * r };
}

function drawImpactScatter(sel, noteSel, metric) {
  const svg = d3.select(sel);
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const data = buildCountryImpactScatterData(metric);
  const note = d3.select(noteSel);
  if (!data.length) {
    note.text('Scatterplot could not be drawn because country emissions and CMIP6 impact data did not match.');
    return;
  }

  const W = 860, H = 440;
  const m = { top: 28, right: 34, bottom: 74, left: 78 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  const x = d3.scaleLog()
    .domain([Math.max(0.001, d3.min(data, d => d.contributionPct) * 0.75), d3.max(data, d => d.contributionPct) * 1.25])
    .range([0, pw])
    .nice();

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.impact) * 1.12])
    .range([ph, 0])
    .nice();

  g.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${ph})`)
    .call(d3.axisBottom(x).ticks(5, '~g').tickFormat(d => `${d3.format('~g')(d)}%`));

  g.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(6).tickFormat(metric === 'pr' ? d => `${d}%` : d => `${d}°C`));

  g.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('x', pw / 2)
    .attr('y', ph + 52)
    .attr('text-anchor', 'middle')
    .text('Historical cumulative CO₂ contribution (%)');

  g.append('text')
    .attr('class', 'scatter-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -ph / 2)
    .attr('y', -54)
    .attr('text-anchor', 'middle')
    .text(metric === 'pr' ? 'Projected precipitation disruption, 2090s (absolute Δ%)' : 'Projected warming, 2090s (Δ°C)');

  const fit = simpleLinearFit(data);
  if (fit) {
    const xVals = d3.extent(data, d => d.contributionPct);
    const lineData = xVals.map(xv => ({ x: xv, y: fit.intercept + fit.slope * xv }));
    g.append('path')
      .datum(lineData)
      .attr('class', 'scatter-trend-line')
      .attr('d', d3.line().x(d => x(d.x)).y(d => y(d.y)));
  }

  g.selectAll('circle.scatter-dot')
    .data(data)
    .join('circle')
    .attr('class', d => `scatter-dot${d.isMajorEmitter ? ' major-emitter-dot' : ''}`)
    .attr('cx', d => x(d.contributionPct))
    .attr('cy', d => y(d.impact))
    .attr('r', d => d.isMajorEmitter ? 5.2 : 3.8)
    .on('mouseenter', function(e, d) {
      d3.select(this).attr('r', d.isMajorEmitter ? 7 : 5.6).attr('stroke-width', 1.2);
      showTip(e, `
        <strong>${d.name}</strong><br>
        CO₂ contribution: ${d3.format('.3~f')(d.contributionPct)}%<br>
        ${metric === 'pr'
          ? `Precipitation disruption: ${d3.format('.1f')(Math.abs(d.precip))}%<br>Raw precipitation Δ: ${d3.format('+.1f')(d.precip)}%`
          : `Projected warming: ${d3.format('+.1f')(d.temp)}°C`}
      `);
    })
    .on('mousemove', e => {
      d3.select('#tooltip')
        .style('left', (e.clientX + 14) + 'px')
        .style('top', (e.clientY + 14) + 'px');
    })
    .on('mouseleave', function(e, d) {
      d3.select(this).attr('r', d.isMajorEmitter ? 5.2 : 3.8).attr('stroke-width', .55);
      hideTip();
    });

  g.append('text')
    .attr('x', pw - 6)
    .attr('y', 14)
    .attr('text-anchor', 'end')
    .attr('font-family', 'var(--mono)')
    .attr('font-size', 10)
    .attr('fill', 'var(--ink-soft)')
    .text('Gold = major historical emitters · Violet = others');

  if (note) {
    const rText = fit ? `R² ≈ ${d3.format('.2f')(fit.r2)}` : 'R² unavailable';
    note.text(`${rText}. Low R² means cumulative emissions contribution explains little of the country-level impact pattern shown here.`);
  }
}

function initImpactScatterplots() {
  drawImpactScatter('#precip-impact-scatter', '#precip-impact-note', 'pr');
  drawImpactScatter('#temperature-impact-scatter', '#temperature-impact-note', 'tas');
}
