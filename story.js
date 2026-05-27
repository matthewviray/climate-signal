const EMISSIONS_PATH = "data/owid-co2-data.csv";
const CMIP6_PATH = "data/cmip6_data.json";

function flattenGrid(grid) {
  if (!grid) return [];
  return grid.flat().filter(v => v != null && !Number.isNaN(v));
}

function formatBillionsFromMillionTonnes(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${(value / 1000).toFixed(1)}B`;
}

function formatSigned(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function getWorldRows(emissions) {
  return emissions.filter(d =>
    d.country === "World" || d.iso_code === "OWID_WRL"
  );
}

function getLatestRow(rows, column) {
  const valid = rows.filter(d => d[column] != null && !Number.isNaN(d[column]));
  const latestYear = d3.max(valid, d => d.year);
  return valid.find(d => d.year === latestYear);
}

function getScenarioObject(fieldObj, preferredScenario = "ssp585") {
  if (!fieldObj) return null;

  if (fieldObj[preferredScenario]) {
    return fieldObj[preferredScenario];
  }

  if (fieldObj.ssp245) return fieldObj.ssp245;
  if (fieldObj.ssp126) return fieldObj.ssp126;
  if (fieldObj.historical) return fieldObj.historical;

  return null;
}

function getLatestGrid(fieldObj, decadeList, preferredScenario = "ssp585") {
  const scenarioObj = getScenarioObject(fieldObj, preferredScenario);
  if (!scenarioObj) return null;

  const availableYears = Object.keys(scenarioObj)
    .map(Number)
    .filter(y => !Number.isNaN(y))
    .sort((a, b) => a - b);

  const targetYears = decadeList?.length ? decadeList : availableYears;

  const latest = [...targetYears]
    .map(Number)
    .filter(y => scenarioObj[String(y)])
    .sort((a, b) => b - a)[0];

  if (!latest) return null;

  return scenarioObj[String(latest)];
}

function calculateStats(emissions, cmip6) {
  const world = getWorldRows(emissions);
  const latestCO2 = getLatestRow(world, "co2");

  const tasGrid = getLatestGrid(
    cmip6.fields?.tas,
    cmip6.meta?.decades_fut
  );

  const prGrid = getLatestGrid(
    cmip6.fields?.pr,
    cmip6.meta?.decades_fut
  );

  const iceHistoricalGrid = getLatestGrid(
  cmip6.fields?.siconc,
  cmip6.meta?.decades_hist,
  "historical"
);

const iceFutureGrid = getLatestGrid(
  cmip6.fields?.siconc,
  cmip6.meta?.decades_fut,
  "ssp585"
);

  const tasValues = flattenGrid(tasGrid);
  const prValues = flattenGrid(prGrid);
  const iceHistoricalValues = flattenGrid(iceHistoricalGrid);
  const iceFutureValues = flattenGrid(iceFutureGrid);

  const avgTemperature = d3.mean(tasValues);
  const avgAbsPrecip = d3.mean(prValues.map(Math.abs));

  const historicalIce = d3.mean(iceHistoricalValues);
  const futureIce = d3.mean(iceFutureValues);

  let iceDecrease = null;
  if (
    historicalIce != null &&
    futureIce != null &&
    historicalIce !== 0
  ) {
    iceDecrease = ((futureIce - historicalIce) / historicalIce) * 100;
  }

  return {
    annualCO2: latestCO2?.co2,
    annualCO2Year: latestCO2?.year,
    avgTemperature,
    avgAbsPrecip,
    iceDecrease,
    tasValues,
    prValues,
    iceHistorical: historicalIce,
    iceFuture: futureIce
  };
}

function statCardHTML(card) {
  return `
    <article class="stat-card ${card.className}">
      <div class="stat-title">${card.title}</div>
      <div class="stat-number">${card.value}</div>
      <div class="stat-unit">${card.unit}</div>
      <div class="stat-caption">${card.caption}</div>
      <div class="mini-viz" id="${card.vizId}"></div>
    </article>
  `;
}

function renderMiniBars(selector, values, className = "mini-bar") {
  const clean = values.filter(v => v != null && !Number.isNaN(v));
  const sample = clean.slice(-16);

  const width = 240;
  const height = 46;

  const svg = d3.select(selector)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleBand()
    .domain(d3.range(sample.length))
    .range([0, width])
    .padding(0.25);

  const y = d3.scaleLinear()
    .domain([0, d3.max(sample)])
    .nice()
    .range([height, 4]);

  svg.selectAll("rect")
    .data(sample)
    .join("rect")
    .attr("class", className)
    .attr("x", (_, i) => x(i))
    .attr("y", d => y(d))
    .attr("width", x.bandwidth())
    .attr("height", d => height - y(d));
}

function renderTemperatureStrip(selector, values) {
  const clean = values.filter(v => v != null && !Number.isNaN(v));
  const sample = clean
    .sort((a, b) => a - b)
    .filter((_, i) => i % Math.ceil(clean.length / 28) === 0)
    .slice(0, 28);

  const width = 240;
  const height = 46;

  const svg = d3.select(selector)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleBand()
    .domain(d3.range(sample.length))
    .range([0, width])
    .padding(0.05);

  const opacity = d3.scaleLinear()
    .domain(d3.extent(sample))
    .range([0.15, 0.9]);

  svg.selectAll("rect")
    .data(sample)
    .join("rect")
    .attr("class", "mini-temp-cell")
    .attr("x", (_, i) => x(i))
    .attr("y", 6)
    .attr("width", x.bandwidth())
    .attr("height", height - 12)
    .attr("opacity", d => opacity(d));
}

function renderPrecipLine(selector, values) {
  const clean = values
    .filter(v => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b);

  const sample = clean
    .filter((_, i) => i % Math.ceil(clean.length / 32) === 0)
    .slice(0, 32);

  const width = 240;
  const height = 46;

  const svg = d3.select(selector)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleLinear()
    .domain([0, sample.length - 1])
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain(d3.extent(sample))
    .nice()
    .range([height - 6, 6]);

  const line = d3.line()
    .x((_, i) => x(i))
    .y(d => y(d))
    .curve(d3.curveBasis);

  svg.append("path")
    .datum(sample)
    .attr("class", "mini-precip-line")
    .attr("d", line);
}

function renderIceBlocks(selector, historical, future) {
  const width = 240;
  const height = 46;

  const svg = d3.select(selector)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const maxVal = Math.max(historical || 1, future || 1);

  const scale = d3.scaleLinear()
    .domain([0, maxVal])
    .range([0, width]);

  svg.append("rect")
    .attr("class", "mini-ice-block")
    .attr("x", 0)
    .attr("y", 10)
    .attr("width", scale(historical || 0))
    .attr("height", 10);

  svg.append("rect")
    .attr("class", "mini-ice-current")
    .attr("x", 0)
    .attr("y", 28)
    .attr("width", scale(future || 0))
    .attr("height", 10);
}

async function renderIntroStats() {
  try {
    const [emissions, cmip6] = await Promise.all([
      d3.csv(EMISSIONS_PATH, d3.autoType),
      d3.json(CMIP6_PATH)
    ]);
    console.log(cmip6.fields.siconc);
    const stats = calculateStats(emissions, cmip6);

    const cards = [
      {
        className: "emissions",
        title: "Human contribution",
        value: formatBillionsFromMillionTonnes(stats.annualCO2),
        unit: "tonnes CO₂ per year",
        caption: `Latest global annual CO₂ emissions in the dataset${stats.annualCO2Year ? `, ${stats.annualCO2Year}` : ""}.`,
        vizId: "emissions-mini"
      },
      {
        className: "temperature",
        title: "Temperature increase",
        value: formatSigned(stats.avgTemperature, 2),
        unit: "°C anomaly",
        caption: "Average projected temperature anomaly relative to the 1850–1900 baseline.",
        vizId: "temperature-mini"
      },
      {
        className: "precipitation",
        title: "Precipitation anomaly",
        value: formatSigned(stats.avgAbsPrecip, 1),
        unit: "% average shift",
        caption: "Mean absolute precipitation change across the model grid, showing disrupted rainfall patterns.",
        vizId: "precipitation-mini"
      },
      {
        className: "ice",
        title: "Sea ice decrease",
        value: formatSigned(stats.iceDecrease, 1),
        unit: "% change",
        caption: "Estimated change in average sea ice concentration between historical and future grid snapshots.",
        vizId: "ice-mini"
      }
    ];

    d3.select("#stats-grid")
      .html(cards.map(statCardHTML).join(""));

    const world = getWorldRows(emissions);
    renderMiniBars(
      "#emissions-mini",
      world.map(d => d.co2).filter(Boolean)
    );

    renderTemperatureStrip("#temperature-mini", stats.tasValues);
    renderPrecipLine("#precipitation-mini", stats.prValues);
    renderIceBlocks("#ice-mini", stats.iceHistorical, stats.iceFuture);

  } catch (error) {
    console.error(error);

    d3.select("#stats-grid").html(`
      <div class="error-message">
        Could not load the datasets. Check that these files exist:
        <br><br>
        data/owid-co2-data.csv<br>
        data/cmip6_data.json
      </div>
    `);
  }
}

renderIntroStats();


// ---------------------------------------


const WORLD_MAP_PATH = "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

let historicalTop10Countries = new Set();
let presentTop10Countries = new Set();
let emissionsLookup = new Map();
let selectedEmissionCountry = null;

const emissionsTooltip = d3.select("body")
  .append("div")
  .attr("class", "emissions-tooltip");

Promise.all([
  d3.csv(EMISSIONS_PATH, d3.autoType),
  d3.json(WORLD_MAP_PATH)
]).then(([emissionsData, worldGeoJson]) => {
  const { historicalTop10, presentTop10, presentYear } =
    buildPastPresentEmissionsFromCSV(emissionsData);

  drawEmissionsMap(worldGeoJson);

  drawEmissionsBarChart(
    "#historical-emissions-chart",
    historicalTop10,
    `Historical cumulative CO₂ emissions through ${presentYear}`
  );

  drawEmissionsBarChart(
    "#present-emissions-chart",
    presentTop10,
    `Annual CO₂ emissions in ${presentYear}`
  );

  updateMapEmissionHighlights();
}).catch(error => {
  console.error("Error loading emissions or map data:", error);
});

function buildPastPresentEmissionsFromCSV(emissionsData) {
  const countryRows = emissionsData.filter(d =>
    d.country &&
    d.iso_code &&
    d.iso_code.length === 3 &&
    d.co2 != null &&
    d.year != null &&
    !d.iso_code.startsWith("OWID_")
  );

  const years = Array.from(new Set(countryRows.map(d => +d.year)))
    .sort((a, b) => a - b);

  const presentYear = years[years.length - 1];

  const cumulativeByCountry = d3.rollups(
    countryRows,
    rows => d3.sum(rows, d => +d.co2),
    d => d.country
  );

  const historicalTop10 = cumulativeByCountry
    .map(([country, emissions]) => ({ country, emissions }))
    .sort((a, b) => d3.descending(a.emissions, b.emissions))
    .slice(0, 10);

  const presentTop10 = countryRows
    .filter(d => +d.year === presentYear)
    .map(d => ({
      country: d.country,
      emissions: +d.co2
    }))
    .filter(d => Number.isFinite(d.emissions))
    .sort((a, b) => d3.descending(a.emissions, b.emissions))
    .slice(0, 10);

  historicalTop10Countries = new Set(
    historicalTop10.map(d => normalizeCountryName(d.country))
  );

  presentTop10Countries = new Set(
    presentTop10.map(d => normalizeCountryName(d.country))
  );

  emissionsLookup = new Map();

  historicalTop10.forEach(d => {
    const key = normalizeCountryName(d.country);

    emissionsLookup.set(key, {
      country: d.country,
      historical: d.emissions,
      present: null
    });
  });

  presentTop10.forEach(d => {
    const key = normalizeCountryName(d.country);

    const existing = emissionsLookup.get(key) || {
      country: d.country,
      historical: null,
      present: null
    };

    existing.present = d.emissions;
    emissionsLookup.set(key, existing);
  });

  return { historicalTop10, presentTop10, presentYear };
}

function drawEmissionsMap(worldGeoJson) {
  d3.select("#emissions-map").selectAll("*").remove();

  const width = 760;
  const height = 360;

  const svg = d3.select("#emissions-map")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");

  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height], worldGeoJson);

  const path = d3.geoPath(projection);

  svg.selectAll("path")
    .data(worldGeoJson.features)
    .join("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("fill", "#ddd")
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .on("mouseover", (event, d) => {
      const country = getMapCountryName(d);
      highlightCountryOnMap(country);
      showEmissionsTooltip(event, country);
    })
    .on("mousemove", event => {
      emissionsTooltip
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY + 14}px`);
    })
    .on("mouseout", () => {
      highlightCountryOnMap(null);
      emissionsTooltip.style("opacity", 0);
    });

  svg.append("text")
    .attr("x", 24)
    .attr("y", 28)
    .attr("font-size", 16)
    .attr("font-weight", 700)
    .text("Top historical and present-day CO₂ emitters");

  const legend = [
    { label: "Historical top 10 only", className: "country-top-historical" },
    { label: "Present-day top 10 only", className: "country-top-present" },
    { label: "Both historical and present-day top 10", className: "country-top-both" }
  ];

  const legendGroup = svg.append("g")
    .attr("class", "emissions-legend")
    .attr("transform", "translate(24, 48)");

  legend.forEach((item, i) => {
    const row = legendGroup.append("g")
      .attr("transform", `translate(0, ${i * 20})`);

    row.append("rect")
      .attr("width", 13)
      .attr("height", 13)
      .attr("class", item.className);

    row.append("text")
      .attr("x", 21)
      .attr("y", 10.5)
      .attr("font-size", 11)
      .text(item.label);
  });
}

function drawEmissionsBarChart(container, data, title) {
  d3.select(container).selectAll("*").remove();

  const width = 560;
  const height = 430;
  const margin = { top: 55, right: 35, bottom: 50, left: 145 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", "100%")
    .attr("height", "100%");

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.emissions)])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map(d => d.country))
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

  svg.append("text")
    .attr("x", margin.left)
    .attr("y", 28)
    .attr("font-size", 15)
    .attr("font-weight", 700)
    .text(title);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d => `${d3.format(".2s")(d)} Mt`));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("class", "emissions-bar")
    .attr("x", margin.left)
    .attr("y", d => y(d.country))
    .attr("width", d => Math.max(0, x(d.emissions) - margin.left))
    .attr("height", y.bandwidth())
    .on("mouseover", (event, d) => {
      selectedEmissionCountry = d.country;
      highlightCountryOnMap(d.country);
      showEmissionsTooltip(event, d.country);
    })
    .on("mousemove", event => {
      emissionsTooltip
        .style("left", `${event.pageX + 14}px`)
        .style("top", `${event.pageY + 14}px`);
    })
    .on("mouseout", () => {
      selectedEmissionCountry = null;
      highlightCountryOnMap(null);
      emissionsTooltip.style("opacity", 0);
    });

  svg.selectAll(".bar-label")
    .data(data)
    .join("text")
    .attr("class", "bar-label")
    .attr("x", d => x(d.emissions) + 5)
    .attr("y", d => y(d.country) + y.bandwidth() / 2)
    .attr("dominant-baseline", "middle")
    .attr("font-size", 11)
    .text(d => `${d3.format(".2s")(d.emissions)} Mt`);
}

function updateMapEmissionHighlights() {
  d3.selectAll(".country")
    .classed("country-top-historical", d => {
      const name = normalizeCountryName(getMapCountryName(d));
      return historicalTop10Countries.has(name) && !presentTop10Countries.has(name);
    })
    .classed("country-top-present", d => {
      const name = normalizeCountryName(getMapCountryName(d));
      return presentTop10Countries.has(name) && !historicalTop10Countries.has(name);
    })
    .classed("country-top-both", d => {
      const name = normalizeCountryName(getMapCountryName(d));
      return historicalTop10Countries.has(name) && presentTop10Countries.has(name);
    });
}

function highlightCountryOnMap(countryName) {
  const normalizedHover = countryName ? normalizeCountryName(countryName) : null;

  d3.selectAll(".country")
    .classed("country-hovered", d => {
      if (!normalizedHover) return false;
      return normalizeCountryName(getMapCountryName(d)) === normalizedHover;
    });

  d3.selectAll(".emissions-bar")
    .classed("emissions-bar-hovered", d => {
      if (!normalizedHover) return false;
      return normalizeCountryName(d.country) === normalizedHover;
    });
}

function showEmissionsTooltip(event, countryName) {
  const key = normalizeCountryName(countryName);
  const info = emissionsLookup.get(key);

  let category = "Not in either top 10";
  let historicalText = "Not top 10";
  let presentText = "Not top 10";

  if (info) {
    const inHistorical = info.historical != null;
    const inPresent = info.present != null;

    if (inHistorical && inPresent) {
      category = "Historical and present-day top 10";
    } else if (inHistorical) {
      category = "Historical top 10 only";
    } else if (inPresent) {
      category = "Present-day top 10 only";
    }

    historicalText = info.historical != null
      ? `${d3.format(".3s")(info.historical)} Mt`
      : "Not top 10";

    presentText = info.present != null
      ? `${d3.format(".3s")(info.present)} Mt`
      : "Not top 10";
  }

  emissionsTooltip
    .style("opacity", 1)
    .style("left", `${event.pageX + 14}px`)
    .style("top", `${event.pageY + 14}px`)
    .html(`
      <strong>${countryName}</strong><br/>
      ${category}<br/>
      Historical cumulative: ${historicalText}<br/>
      Present annual: ${presentText}
    `);
}

function getMapCountryName(d) {
  return (
    d.properties?.name ||
    d.properties?.NAME ||
    d.properties?.ADMIN ||
    d.properties?.sovereignt ||
    ""
  );
}

function normalizeCountryName(name) {
  const replacements = {
    "United States of America": "United States",
    "USA": "United States",
    "Russian Federation": "Russia",
    "Republic of Korea": "South Korea",
    "Korea, Republic of": "South Korea",
    "Democratic Republic of the Congo": "Democratic Republic of Congo",
    "Czech Republic": "Czechia",
    "Iran, Islamic Republic of": "Iran",
    "Viet Nam": "Vietnam"
  };

  return replacements[name] || name;
}