// Climate Story prototype — Chapter 1 choropleth with scenario toggle + decade slider
// Data format per JSON file:
//   { scenario, decade, lat: [...], lon: [...], values: [[...]] }
// where values is a 2D array indexed as values[lat_idx][lon_idx], in °C anomaly.

const DECADES = ["2030s", "2060s", "2090s"];

const state = {
  scenario: "ssp245",
  decadeIdx: 2,
  data: {}, // keyed by `${scenario}_${decade}`
  world: null,
};

const width = 960;
const height = 500;

// --- Color scale: 0 to 12°C, perceptually wide ramp ---
// Data range is roughly 1-17°C with most values in 3-9°C. We cap the scale at
// 12°C so the bulk of the data uses the full perceptual range; values above
// (Arctic) all read as "very hot" without being individually distinguishable
// — that's the right tradeoff because the story is "look how much warmer the
// world is", not "exact degrees in the Arctic".
const COLOR_MIN = 0;
const COLOR_MAX = 12;
const colorScale = d3.scaleLinear()
  .domain([0, 2, 4, 6, 8, 10, 12])
  .range([
    "#ffffcc",  // 0  — pale yellow
    "#ffeda0",  // 2
    "#fed976",  // 4
    "#feb24c",  // 6
    "#fd8d3c",  // 8
    "#f03b20",  // 10
    "#bd0026",  // 12 — deep red
  ])
  .clamp(true);

// --- Projection ---
// Robinson via d3-geo-projection (loaded as global `d3` extension)
const projection = d3.geoRobinson()
  .scale(160)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

// --- SVG setup ---
const svg = d3.select("#map")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

// Background (ocean)
svg.append("rect")
  .attr("width", width)
  .attr("height", height)
  .attr("fill", "#f5f7fa");

const gridLayer = svg.append("g").attr("class", "grid-layer");
const countryLayer = svg.append("g").attr("class", "country-layer");

// --- Load everything in parallel ---
async function init() {
  const dataPromises = [];
  for (const scenario of ["ssp245", "ssp585"]) {
    for (const decade of DECADES) {
      const key = `${scenario}_${decade}`;
      dataPromises.push(
        d3.json(`data/temp_anomaly_${scenario}_${decade}.json`)
          .then(d => { state.data[key] = d; })
          .catch(err => console.warn(`Missing data file: ${key}`, err))
      );
    }
  }

  const worldPromise = d3.json("data/world-110m.json")
    .then(world => { state.world = world; });

  await Promise.all([...dataPromises, worldPromise]);

  drawCountries();
  drawLegend();
  render();
  bindControls();
}

function drawCountries() {
  if (!state.world) return;
  const countries = topojson.feature(state.world, state.world.objects.countries);
  countryLayer.selectAll("path")
    .data(countries.features)
    .join("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#333")
    .attr("stroke-width", 0.4)
    .attr("pointer-events", "none");
}

// Render the heat grid as rectangles in lon/lat space, reprojected
function render() {
  const key = `${state.scenario}_${DECADES[state.decadeIdx]}`;
  const data = state.data[key];

  if (!data) {
    gridLayer.selectAll("*").remove();
    gridLayer.append("text")
      .attr("x", width / 2).attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#888")
      .text(`No data for ${key} — did you run the export cell?`);
    return;
  }

  const { lat, lon, values } = data;
  const dLat = Math.abs(lat[1] - lat[0]);
  const dLon = Math.abs(lon[1] - lon[0]);

  // Flatten the 2D grid into one cell per (lat, lon)
  const cells = [];
  for (let i = 0; i < lat.length; i++) {
    for (let j = 0; j < lon.length; j++) {
      const v = values[i][j];
      if (v === null || v === undefined) continue;
      cells.push({ lat: lat[i], lon: lon[j], v });
    }
  }
  // Project four corners directly. We can't use d3.geoPath() here because
  // Robinson's clipping behavior appends the projection sphere outline to
  // every small polygon, which makes every cell render as the whole map.
  const cellPath = ({ lat, lon }) => {
    const half_lat = dLat / 2;
    const half_lon = dLon / 2;
    // NEX-GDDP uses 0-360 longitude convention. If the lon is > 180, shift it.
    const lonAdj = lon > 180 ? lon - 360 : lon;
    const corners = [
      [lonAdj - half_lon, lat - half_lat],
      [lonAdj + half_lon, lat - half_lat],
      [lonAdj + half_lon, lat + half_lat],
      [lonAdj - half_lon, lat + half_lat],
    ];
    const projected = corners.map(c => projection(c));
    // Skip cells whose projection failed (off-map)
    if (projected.some(p => !p || isNaN(p[0]) || isNaN(p[1]))) return null;
    // Skip degenerate cells that wrap across the map (huge horizontal span)
    const xs = projected.map(p => p[0]);
    if (Math.max(...xs) - Math.min(...xs) > width / 4) return null;
    const [a, b, c, d] = projected;
    return `M${a[0]},${a[1]}L${b[0]},${b[1]}L${c[0]},${c[1]}L${d[0]},${d[1]}Z`;
  };

  // Compute paths up front, filter out cells that couldn't be projected
  const cellsWithPaths = cells
    .map(c => ({ ...c, d: cellPath(c) }))
    .filter(c => c.d !== null);

  const selection = gridLayer.selectAll("path.cell")
    .data(cellsWithPaths, d => `${d.lat}_${d.lon}`);

  selection.join(
    enter => enter.append("path")
      .attr("class", "cell")
      .attr("d", d => d.d)
      .attr("fill", d => colorScale(d.v))
      .attr("stroke", "none")
      .append("title")
      .text(d => `+${d.v.toFixed(1)}°C at (${d.lat.toFixed(1)}°, ${d.lon.toFixed(1)}°)`),
    update => update
      .transition().duration(500)
      .attr("fill", d => colorScale(d.v))
  );

  // Update tooltips on existing cells too (after scenario/decade change)
  gridLayer.selectAll("path.cell title")
    .text(d => `+${d.v.toFixed(1)}°C at (${d.lat.toFixed(1)}°, ${d.lon.toFixed(1)}°)`);

  // Re-raise country borders so they sit above the cells
  countryLayer.raise();
}

function drawLegend() {
  const legendWidth = 320;
  const legendHeight = 12;

  const legendSvg = d3.select("#legend").append("svg")
    .attr("width", legendWidth + 40)
    .attr("height", 50);

  const defs = legendSvg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "legend-gradient");

  const stops = d3.range(0, 1.01, 0.1);
  stops.forEach(t => {
    gradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", colorScale(COLOR_MIN + t * (COLOR_MAX - COLOR_MIN)));
  });

  legendSvg.append("rect")
    .attr("x", 20).attr("y", 8)
    .attr("width", legendWidth).attr("height", legendHeight)
    .attr("fill", "url(#legend-gradient)")
    .attr("stroke", "#999").attr("stroke-width", 0.5);

  const legendScale = d3.scaleLinear()
    .domain([COLOR_MIN, COLOR_MAX])
    .range([20, 20 + legendWidth]);

  legendSvg.append("g")
    .attr("transform", `translate(0, ${8 + legendHeight})`)
    .call(d3.axisBottom(legendScale).ticks(6).tickFormat(d => `+${d}°C`))
    .selectAll("text")
    .style("font-size", "10px");
}

function bindControls() {
  d3.selectAll("#scenario-buttons button").on("click", function() {
    const btn = d3.select(this);
    d3.selectAll("#scenario-buttons button").classed("active", false);
    btn.classed("active", true);
    state.scenario = btn.attr("data-scenario");
    render();
  });

  const slider = document.getElementById("decade-slider");
  slider.addEventListener("input", () => {
    state.decadeIdx = +slider.value;
    document.getElementById("decade-label").textContent = DECADES[state.decadeIdx];
    render();
  });
}

init();
