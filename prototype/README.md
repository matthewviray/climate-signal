# Climate Story — DSC 106 Final Project Prototype

Interactive explorable explanation of climate change as a cascade of connected harms under different emissions scenarios, built on NASA NEX-GDDP-CMIP6 downscaled climate projections.

**Live prototype:** [https://YOUR_USERNAME.github.io/climate-story/](https://YOUR_USERNAME.github.io/climate-story/)

## Current state

This is the initial prototype (due 5/26). It renders one chapter of the planned six-chapter scrollytelling narrative — Chapter 1, "The Warming" — as a D3 choropleth with two interactions:

- **Scenario toggle:** SSP2-4.5 (moderate mitigation) vs SSP5-8.5 (no mitigation)
- **Decade slider:** 2030s → 2060s → 2090s

## Repo structure

```
.
├── index.html         # page structure + writeup
├── main.js            # D3 choropleth, controls
├── style.css          # styling
├── data/              # pre-baked JSON tiles, one per (scenario × decade)
│   ├── temp_anomaly_ssp245_2030s.json
│   ├── temp_anomaly_ssp245_2060s.json
│   ├── temp_anomaly_ssp245_2090s.json
│   ├── temp_anomaly_ssp585_2030s.json
│   ├── temp_anomaly_ssp585_2060s.json
│   └── temp_anomaly_ssp585_2090s.json
└── notebook/          # data prep pipeline (NEX-GDDP -> JSON)
    └── climate_story_proposal.ipynb
```

## Data pipeline

1. Notebook downloads NEX-GDDP-CMIP6 NetCDF files via HTTPS from `nex-gddp-cmip6.s3.us-west-2.amazonaws.com` (public bucket, no auth).
2. Variables: `tas`, `pr`, `tasmax`, `huss`. Model: ACCESS-CM2. Member: r1i1p1f1.
3. Computes anomalies vs a 2015–2016 baseline, coarsens 0.25° → ~1.5° for browser delivery.
4. Exports one JSON file per (scenario × decade) combo with shape `{lat, lon, values}`.

To regenerate the JSON tiles, open the notebook in Colab, run all cells through Section 1, then run the "Export for D3 prototype" cell. Copy `prototype_data/*.json` into `data/`.

## Local development

GitHub Pages serves the repo root directly, so to test locally just serve the directory with any static file server:

```
python3 -m http.server 8000
# open http://localhost:8000
```

Don't open `index.html` directly with `file://` — the JSON files won't load due to CORS.

## Citation

Thrasher, B., Wang, W., Michaelis, A., Melton, F., Lee, T. and Nemani, R. NASA Global Daily Downscaled Projections, CMIP6. *Scientific Data* 9, 262 (2022). [https://registry.opendata.aws/nex-gddp-cmip6/](https://registry.opendata.aws/nex-gddp-cmip6/)
