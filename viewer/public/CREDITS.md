# Credits and data sources (4:37 viewer)

Every 3D model in the viewer is procedural (generated in code). No external 3D models are used.

| Asset (in `public/geo/`) | Source | License |
|---|---|---|
| `lights.png`: night lights, cropped to the map area and floor-subtracted | NASA Earth Observatory, **Black Marble 2016** grayscale, tile A1, 15 arc-second (`BlackMarble_2016_A1_geo_gray.tif`), https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144897/. Credit: *NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA's Goddard Space Flight Center.* This is a 2016 composite, from before the 2021 storm. | NASA imagery: public domain, no copyright (NASA media usage guidelines). Credit requested. |
| `terrain.png` (R,G channels): elevation | **AWS Terrain Tiles** (Mapzen/Tilezen "terrarium" encoding, zoom 7), https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png. Underlying sources in Texas: SRTM and USGS NED (3DEP). Attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md | Open data. Underlying US sources are public domain. Attribution per the joerd notice. |
| `terrain.png` (B channel) and `geo.json` → `texas`: Texas outline | **US Census Bureau** 2010 cartographic boundary, states 1:500k (`gz_2010_us_040_00_500k.json`), GeoJSON conversion by Eric Celeste, https://eric.clst.org/tech/usgeojson/ | US Government work: public domain |
| `geo.json` → `permian`: Permian Basin extent | **US EIA**, "Permian Basin Boundary, Structural and Tectonic Features" (`PermianBasin_Boundary_Structural_Tectonic.zip`, layer `PermianBasin_Extent_201712`), https://www.eia.gov/maps/map_data/ | US Government work: public domain |
| `plants.json`: power plant locations, fuel, winter MW, online and retirement dates | **US EIA Form EIA-860** (2025 and 2020 releases), filtered to ERCOT (balancing authority ERCO). Built from `data/processed/ercot_plants.csv` and `ercot_generators.csv` (see `data/DATA_REPORT.md`) | US Government work: public domain |
| `cities.json`: 25 Texas cities (lat/lon, population) | `data/processed/tx_cities.json`. Coordinates match city centers. Populations match recent US Census Bureau estimates. Provenance is otherwise unverified (see `data/DATA_REPORT.md` §4). | US Census data: public domain |

**Software:** three.js (MIT), React (MIT), @react-three/fiber, drei and postprocessing (MIT), pmndrs postprocessing (Zlib), zustand (MIT), Vite (MIT).

**Replays** (`public/replays/`):
- `mock_*.json` is **invented test data** from `scripts/mock_replay.mjs`. The HUD labels it "MOCK DATA".
- `dev_*.json` comes from the project simulator (`sim/export_replay.py`).

All on-screen results are **in simulation**.
