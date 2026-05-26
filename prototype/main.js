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

// --- Color scale: diverging red-blue, symmetric ±10°C, clipped ---
const colorScale = d3.scaleLinear()
  .domain([-10, -5, 0, 5, 10])
  .range(["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"])
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

  // Each cell becomes a small geojson polygon, then projected to screen
  const cellPath = ({ lat, lon }) => {
    // Build a small rectangle in geographic space
    const half_lat = dLat / 2;
    const half_lon = dLon / 2;
    // Wrap lon if needed (NEX-GDDP uses 0–360, world-atlas uses -180–180)
    const lonAdj = lon > 180 ? lon - 360 : lon;
    const poly = {
      type: "Polygon",
      coordinates: [[
        [lonAdj - half_lon, lat - half_lat],
        [lonAdj + half_lon, lat - half_lat],
        [lonAdj + half_lon, lat + half_lat],
        [lonAdj - half_lon, lat + half_lat],
        [lonAdj - half_lon, lat - half_lat],
      ]]
    };
    return path(poly);
  };

  const selection = gridLayer.selectAll("path.cell")
    .data(cells, d => `${d.lat}_${d.lon}`);

  selection.join(
    enter => enter.append("path")
      .attr("class", "cell")
      .attr("d", cellPath)
      .attr("fill", d => colorScale(d.v))
      .attr("stroke", "none"),
    update => update
      .transition().duration(500)
      .attr("fill", d => colorScale(d.v))
  );

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
      .attr("stop-color", colorScale(-10 + t * 20));
  });

  legendSvg.append("rect")
    .attr("x", 20).attr("y", 8)
    .attr("width", legendWidth).attr("height", legendHeight)
    .attr("fill", "url(#legend-gradient)")
    .attr("stroke", "#999").attr("stroke-width", 0.5);

  const legendScale = d3.scaleLinear()
    .domain([-10, 10])
    .range([20, 20 + legendWidth]);

  legendSvg.append("g")
    .attr("transform", `translate(0, ${8 + legendHeight})`)
    .call(d3.axisBottom(legendScale).ticks(5).tickFormat(d => `${d}°C`))
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
