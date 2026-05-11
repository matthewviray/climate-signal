"""
Fetch siconc (sea ice concentration) from CMIP6 Google Cloud Storage
using the catalog CSV (same approach as the notebook), process into
decadal fields + annual Arctic mean, and add to cmip6_data.json.

Run from the project directory:  python fetch_siconc.py
"""
import json, warnings
import numpy as np
import pandas as pd
import xarray as xr
import gcsfs
from scipy.interpolate import RegularGridInterpolator

warnings.filterwarnings('ignore')

# ── Connect to Google Cloud ───────────────────────────────────────────────────
print('Loading CMIP6 catalog...')
df  = pd.read_csv('https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv')
gcs = gcsfs.GCSFileSystem(token='anon')
print(f'  catalog: {len(df):,} rows')

def open_cmip6(variable, experiment, table='SImon'):
    row = df[
        (df.variable_id   == variable)   &
        (df.experiment_id == experiment) &
        (df.source_id     == 'CanESM5')  &
        (df.table_id      == table)      &
        (df.member_id     == 'r1i1p1f1') &
        (df.grid_label    == 'gn')
    ]
    if len(row) == 0:
        row = df[
            (df.variable_id   == variable)   &
            (df.experiment_id == experiment) &
            (df.source_id     == 'CanESM5')  &
            (df.member_id     == 'r1i1p1f1')
        ]
    ds = xr.open_zarr(gcs.get_mapper(row.zstore.values[0]), consolidated=True)
    print(f'  loaded {variable}/{experiment}: '
          f'{str(ds.time.values[0])[:7]} → {str(ds.time.values[-1])[:7]}')
    return ds

# ── Load target grid from existing JSON ─────────────────────────────────────
with open('cmip6_data.json') as f:
    DATA = json.load(f)

TARGET_LAT = np.array(DATA['meta']['lat'])   # 48 values, S→N
TARGET_LON = np.array(DATA['meta']['lon'])   # 72 values, W→E (-180 to 180)
DECADES_HIST = DATA['meta']['decades_hist']
DECADES_FUT  = DATA['meta']['decades_fut']

# ── Open all four siconc datasets ────────────────────────────────────────────
print('\nOpening siconc datasets...')
ds_hist = open_cmip6('siconc', 'historical')
ds_126  = open_cmip6('siconc', 'ssp126')
ds_245  = open_cmip6('siconc', 'ssp245')
ds_585  = open_cmip6('siconc', 'ssp585')

# Detect lat/lon coordinate names (some models use 'latitude'/'longitude')
def lat_name(ds): return next(c for c in ds.coords if c.lower() in ('lat','latitude'))
def lon_name(ds): return next(c for c in ds.coords if c.lower() in ('lon','longitude'))

# Scale factor: CMIP6 siconc may be 0-1 fraction or 0-100 percent
def scale_factor(ds):
    sample = float(ds['siconc'].isel(time=slice(0,12)).mean().values)
    return 1.0 if sample > 1.5 else 100.0

SCALE = scale_factor(ds_hist)
print(f'  siconc scale factor: {SCALE} ({"already %" if SCALE==1 else "fraction → ×100"})')

# ── Regrid helper (bilinear interpolation) ────────────────────────────────────
def regrid_field(arr2d, src_lat, src_lon):
    """Bilinear regrid from (src_lat, src_lon) grid to TARGET grid.
    src_lat: 1-D ascending, src_lon: 1-D. Target lons are -180..180.
    """
    # Ensure src_lon is -180..180
    if src_lon.max() > 180:
        src_lon = np.where(src_lon > 180, src_lon - 360, src_lon)
        # re-sort after wrapping
        order = np.argsort(src_lon)
        src_lon = src_lon[order]
        arr2d  = arr2d[:, order]

    # Ensure ascending lat
    if src_lat[0] > src_lat[-1]:
        src_lat = src_lat[::-1]
        arr2d   = arr2d[::-1, :]

    # Replace NaN with 0 (land → no ice)
    arr2d = np.where(np.isnan(arr2d), 0.0, arr2d)

    fn = RegularGridInterpolator(
        (src_lat, src_lon), arr2d,
        method='linear', bounds_error=False, fill_value=0.0
    )
    tgrid = np.meshgrid(TARGET_LON, TARGET_LAT)   # (48,72) each
    pts   = np.column_stack([tgrid[1].ravel(), tgrid[0].ravel()])
    out   = fn(pts).reshape(len(TARGET_LAT), len(TARGET_LON))
    return np.clip(out, 0, 100)

# ── Decadal spatial fields ─────────────────────────────────────────────────────
def make_decade_fields(ds, decades):
    da      = ds['siconc']
    slat    = ds[lat_name(ds)].values
    slon    = ds[lon_name(ds)].values

    # Ensure 1-D lat/lon (CanESM5 ocean is on a regular grid)
    if slat.ndim > 1:
        slat = slat[:, 0]
        slon = slon[0, :]

    fields = {}
    for dec in decades:
        t0, t1 = f'{dec}-01', f'{dec+9}-12'
        chunk  = da.sel(time=slice(t0, t1))
        if chunk.time.size == 0:
            fields[str(dec)] = None
            continue
        mean2d = chunk.mean(dim='time').values * SCALE       # (nlat, nlon)
        out    = regrid_field(mean2d, slat, slon)
        fields[str(dec)] = [[round(float(v), 1) for v in row] for row in out]
        print(f'    decade {dec}: max={out.max():.1f}% mean={out.mean():.1f}%')
    return fields

print('\nComputing historical decadal fields (1850–2010)...')
hist_fields = make_decade_fields(ds_hist, DECADES_HIST)

print('Computing future decadal fields (ssp126)...')
fut_126 = make_decade_fields(ds_126, DECADES_FUT)

print('Computing future decadal fields (ssp245)...')
fut_245 = make_decade_fields(ds_245, DECADES_FUT)

print('Computing future decadal fields (ssp585)...')
fut_585 = make_decade_fields(ds_585, DECADES_FUT)

# ── Annual Arctic mean time series ────────────────────────────────────────────
def arctic_annual_mean(ds):
    """Area-weighted annual mean siconc for lat > 50° (Arctic region)."""
    da   = ds['siconc']
    slat = ds[lat_name(ds)].values
    if slat.ndim > 1:
        slat = slat[:, 0]

    lat_coord = lat_name(ds)
    arctic    = da.where(da[lat_coord] > 50)

    weights   = np.cos(np.deg2rad(da[lat_coord]))
    weights.name = 'weights'

    sp_dims = [d for d in arctic.dims if d != 'time']
    annual  = arctic.weighted(weights).mean(sp_dims).resample(time='YE').mean()

    series = []
    for t in annual.time.values:
        yr  = int(str(t)[:4])
        val = float(annual.sel(time=t).values) * SCALE
        if not np.isnan(val):
            series.append({'year': yr, 'value': round(val, 2)})
    return series

print('\nComputing Arctic annual mean time series...')
gm_hist = arctic_annual_mean(ds_hist)
gm_126  = arctic_annual_mean(ds_126)
gm_245  = arctic_annual_mean(ds_245)
gm_585  = arctic_annual_mean(ds_585)
print(f'  hist: {len(gm_hist)} years, ssp126: {len(gm_126)}, ssp245: {len(gm_245)}, ssp585: {len(gm_585)}')

# ── Inject into DATA ──────────────────────────────────────────────────────────
DATA['fields']['siconc'] = {
    'historical': hist_fields,
    'ssp126':     fut_126,
    'ssp245':     fut_245,
    'ssp585':     fut_585,
}
DATA['global_mean']['siconc'] = {
    'historical': gm_hist,
    'ssp126':     gm_126,
    'ssp245':     gm_245,
    'ssp585':     gm_585,
}
DATA['meta']['units']['siconc'] = 'percent_ice_cover'

print('\nWriting cmip6_data.json...')
with open('cmip6_data.json', 'w') as f:
    json.dump(DATA, f, separators=(',', ':'))

size_mb = __import__('os').path.getsize('cmip6_data.json') / 1e6
print(f'Done! cmip6_data.json updated ({size_mb:.1f} MB)')
