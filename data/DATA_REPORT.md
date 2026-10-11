# 4:37 data feasibility report (data scout)

Prepared Saturday 2026-10-10. Every dataset below is real public data that was downloaded and parsed in this session. Nothing was synthesized.
Scripts are in `D:\dev\MongoDB\feasibility\data\` and the processed outputs are in `D:\dev\MongoDB\data\processed\`.
Raw downloads come to 367 MB on disk, including the extracted archives. Rebuild everything with:

```
cd D:\dev\MongoDB\feasibility\data
..\..\.venv\Scripts\python.exe -I fetch_open_meteo.py 2007 2024   # cached per location-year
..\..\.venv\Scripts\python.exe -I process_load.py
..\..\.venv\Scripts\python.exe -I process_fuel_mix.py
..\..\.venv\Scripts\python.exe -I process_weather.py
..\..\.venv\Scripts\python.exe -I process_eia930.py
..\..\.venv\Scripts\python.exe -I process_eia860.py
..\..\.venv\Scripts\python.exe -I verify.py
```
(One environment change: `xlrd 2.0.2` was installed from PyPI into the venv, because the pre-2016 ERCOT files are legacy BIFF `.xls`.)

## TL;DR

| Need | Status | Coverage obtained |
|---|---|---|
| 1. Hourly ERCOT load | **Got it.** ERCOT Native Load (system total plus 8 weather zones) | 2007-01-01 to 2024-12-31. 1 missing hour in 2010-2023 |
| 2. Hourly gen by fuel | **Got it.** ERCOT Fuel Mix Reports 2007-2024 (15-min data aggregated to hourly). EIA-930 kept as a cross-check | 2007-2024. Covers **Feb 2011** and **Feb 2021** |
| 3. Hourly weather | **Got it.** Open-Meteo ERA5 reanalysis for all 8 points | 2007-2024, 0 missing hours |
| 4. Plant list with lat/lon | **Got it.** EIA-860 2025 + 2020 releases, filtered to BA = ERCO | 974 plants / 2,352 generators that operated at some point since 2007 |
| 5. Capacity by fuel per winter | **Derived** from EIA-860 operating and retirement dates | As of Feb 1 for each year 2007-2025 |

The **Feb 2011 calibration period is fully covered** by load, generation by fuel, weather and capacity.
Main caveats: served load during load shed understates true demand, and none of these sources include unit-level outage data. See "Threats" at the end.

---

## 1. ERCOT hourly Native Load (primary load source)

- **Page:** https://www.ercot.com/gridinfo/load/load_hist
- **Files** (saved in `data/raw/ercot_native_load/`; zips are extracted to `extracted/`):
  - `https://www.ercot.com/files/docs/2015/10/22/{2007..2014}_ercot_hourly_load_data.xls`: 8 files, about 1.80 MB each
  - `https://www.ercot.com/files/docs/2016/01/07/native_load_2015.xls`: 1.80 MB
  - `https://www.ercot.com/files/docs/2017/01/10/native_Load_2016.zip` (1.12 MB), `2018/01/09/native_load_2017.zip` (1.12 MB), `2019/01/07/native_load_2018.zip` (1.09 MB), `2020/01/09/Native_Load_2019.zip` (1.09 MB), `2021/01/12/Native_Load_2020.zip` (1.10 MB), `2021/11/12/Native_Load_2021.zip` (1.09 MB), `2022/02/08/Native_Load_2022.zip` (1.09 MB), `2023/02/09/Native_Load_2023.zip` (1.09 MB), `2024/02/06/Native_Load_2024.zip` (1.09 MB). Each zip holds one xlsx.
- **Content:** one row per hour. Columns are the hour-ending label, 8 weather-zone loads (COAST, EAST, FWEST, NORTH, NCENT, SOUTH, SCENT, WEST) and the ERCOT total, all in **MW** (hourly-integrated, i.e. MWh/h).
- **Outputs:**
  - `ercot_load_hourly.parquet`: 157,800 rows. Columns `ts_utc, ts_local, load_mw, source='ercot_native_load'`.
  - `ercot_load_zonal_hourly.parquet`: 1,262,400 rows. Columns `ts_utc, ts_local, zone, load_mw`. Zone names are normalised; older files used FAR_WEST/NORTH_C/SOUTHERN/SOUTH_C.
- **Timestamp and DST handling:** all processed tables use **hour-ending** timestamps. `ts_utc` is UTC and `ts_local` is tz-aware `US/Central`.
  - ERCOT files are in Central Prevailing Time. Each year has a 23-hour spring day and a 25-hour fall day. Every file has exactly 8,760 or 8,784 rows, starting at HE01 on Jan 1 (CST) and ending at HE24 on Dec 31 (CST), so row *i* is assigned `Jan-1 07:00 UTC + i h`.
  - This was checked against the printed labels. Mismatches occur only on DST-transition rows: 1 per year in 2007-2016 and 2 per year in 2017-2024, because newer files label the spring hours HE02 then HE04 and the repeated fall hour as `02:00 DST`.
  - Old files store timestamps as floats such as `01:59:59.997`, which were rounded.
- **Coverage:** first `2007-01-01 07:00Z`, last `2025-01-01 06:00Z`. In 2010-2023, **1 missing hour out of 122,712**: 2016-11-06 HE24 is blank in the source and is left as NaN.
- **Quirks:**
  - In May 2021, sum(zones) differs from the ERCOT total by up to 2.36 GW, for a few days only. Everywhere else they match closely.
  - Native Load is the **served** load. It drops when ERCOT sheds firm load (see sanity checks).

### Cross-check against EIA-930 demand
Overlap is 83,088 hours (2015-07 to 2024). Mean EIA minus ERCOT is +64 MW, MAPE is 0.27%, correlation is 0.9999.
MAE is 121 MW at lag 0, compared with about 1,470-1,500 MW at ±1 h, which confirms the two timestamp conventions agree.

## 2. Hourly generation by fuel

### 2a. ERCOT Fuel Mix Reports (primary; covers Feb 2011)
- **Page:** https://www.ercot.com/gridinfo/generation (entry "Fuel Mix Report: 2007 - 2024")
- **File:** `https://www.ercot.com/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip`: 50,971,482 bytes, saved in `data/raw/ercot_fuel_mix/`. It contains `IntGenByFuel2007.xls` through `IntGenbyFuel2024.xlsx`, 18 workbooks of 2.6-6.2 MB each, extracted to `extracted/`.
- **Content:** one sheet per month, one row per (day, fuel), and 96 columns of **MWh per 15-minute interval**. The Total column equals the row sum.
  - Hourly MW is the sum of the 4 quarter-hours ending in the hour.
  - Units were verified: hourly sum over all fuels divided by native load is 0.993-1.003 as an annual mean for every year 2007-2024.
- **Output:** `ercot_gen_by_fuel_hourly.parquet`: 1,350,842 rows. Columns `ts_utc, ts_local, fuel, mw, n_intervals, source`. Hour-ending, same convention as load.
- **Fuel categories** (they change over time):
  - `coal`, `nuclear`, `wind`, `hydro`: whole period.
  - `gas`: all gas in 2007 through Nov 2008. From Dec 2008 it means non-combined-cycle gas only (steam plus CT; the raw label was `Gas_GT` 2008-2010 and `Gas` from 2011). `gas_cc` starts 2008-12-01.
  - `biomass` and `solar` appear as separate fuels from 2011 (solar from Jul 2011). Before that they sit inside `other`.
  - `storage_charging_wsl` (wholesale storage load, **negative** MW) appears in 2022. Battery discharge appears to be reported inside `other`, which grows from 2022.
- **Layout quirks handled by `process_fuel_mix.py`:**
  - Five different header layouts: combined `Date-Fuel` strings with `-`, ` - ` or `_`, or separate Date/Fuel/Settlement columns.
  - The midnight column can be `time(0,0)`, `1900-01-01`, or an Excel day fraction (Oct 2007).
  - Header typos in Aug 2009, Oct 2007 and Sep 2016. Because of these, intervals are assigned by position.
  - The fall-back repeated hour appears as trailing `DST1-4` / `01:15 (DST)` columns, or as inline repeated labels (Nov 2009). In some years those columns contain zeros on every day, so they are used only on fall-back Sundays.
  - Cells can contain junk strings such as `'1/0/1900 0:00'`, which are coerced to NaN.
- **Coverage:** 2007-01-01 to 2024-12-31.
  - In the 2010-2023 window, 4 hours are missing, all on DST-transition days in 2013-2015.
  - 25 hourly values have fewer than 4 quarter-hours, in 5 distinct local hours, all on DST days or 2011-10-07/08.
  - Outliers in the gen/load ratio (below 0.9 or above 1.1) occur **only** on DST-transition hours (11 hours in 18 years).
  - On spring-forward days before 2016, the file holds 96 values for a 23-hour day. The 4 values at nonexistent local times were dropped, and values after 02:00 may be shifted by 1 h on those days. These are March days, outside the winter window.
- **Cross-check against EIA-930** (2019-2023, mean MW, ERCOT vs EIA): coal 8,088 vs 8,130; gas (all) 20,615 vs 20,556; nuclear 4,688 vs 4,709; wind 10,825 vs 10,831; solar 1,950 vs 1,896. They agree closely.

### 2b. EIA-930 (cross-check source)
- **File:** `https://www.eia.gov/electricity/gridmonitor/knownissues/xls/ERCO.xlsx`: 74,640,232 bytes, Last-Modified 2026-10-10, saved in `data/raw/eia930/`. This is EIA's static per-BA workbook, so no API key was needed. A sibling `Region_TEX.xlsx` (31.8 MB) exists but was not downloaded.
- **Output:** `eia930_erco_hourly.parquet`: 98,880 rows, wide format. Columns: `ts_utc, ts_local, demand_forecast, demand, net_generation, total_interchange, adjusted_*, ng_col, ng_ng, ng_nuc, ng_oil, ng_wat, ng_sun, ng_wnd, ng_bat, ng_oth, …`. EIA's "UTC time" is hour-ending.
- **Coverage:** demand runs 2015-07-01 to 2026-10-11, with 0.32% of hours missing before 2024. **Fuel detail starts 2018-07-02.**

## 3. Hourly weather: Open-Meteo historical archive (ERA5)
- **Endpoint** (no key), one request per location-year, 144 requests in total:
  `https://archive-api.open-meteo.com/v1/archive?latitude=<lat>&longitude=<lon>&start_date=YYYY-01-01&end_date=YYYY-12-31&hourly=temperature_2m,wind_speed_10m,snowfall,precipitation&timezone=GMT&wind_speed_unit=ms&models=era5`
- **Raw:** `data/raw/open_meteo/<Location>_<YYYY>.json`. 144 files, 51 MB, years 2007-2024. Each JSON stores its exact request URL in `_request_url`.
- **Model choice:** I used `models=era5`, the 0.25° reanalysis, for a **consistent dataset across all years**. The default `best_match` switches to 9 km ECMWF IFS from 2017, which would put a resolution change between the training winters and the 2021 test.
- **Points** (requested lat/lon → ERA5 grid cell returned):

  | location | requested | grid |
  |---|---|---|
  | Houston | 29.7604, -95.3698 | 29.75, -95.25 |
  | Dallas | 32.7767, -96.7970 | 32.75, -96.75 |
  | San Antonio | 29.4241, -98.4936 | 29.5, -98.5 |
  | Austin | 30.2672, -97.7431 | 30.25, -97.75 |
  | Midland (Permian) | 31.9973, -102.0779 | 32.0, -102.0 |
  | Sweetwater (W-TX wind) | 32.4710, -100.4059 | 32.5, -100.5 |
  | Corpus Christi | 27.8006, -97.3964 | 27.75, -97.5 |
  | Lubbock | 33.5779, -101.8552 | 33.5, -101.75 |

- **Output:** `weather_hourly.parquet`: 1,262,400 rows. Columns `ts_utc, location, lat, lon, grid_lat, grid_lon, temp_c, wind_ms, snowfall_cm, precip_mm`.
- **Units:**
  - `temp_c` is 2 m air temperature in °C, instantaneous at `ts_utc`.
  - `wind_ms` is 10 m wind in m/s, instantaneous.
  - `snowfall_cm` (cm) and `precip_mm` (mm) are totals over the preceding hour, so they are hour-ending and line up with load and generation.
- **Coverage:** 2007-01-01 00:00Z to 2024-12-31 23:00Z for all 8 points. 0 missing hours, 0 NaN.
- **Validation:** the coldest Dallas hour in the dataset is **-18.8 °C at 2021-02-16 10:00Z** (04:00 CST). DFW Airport's official low that morning was -2 °F (-18.9 °C).
- **Quirks:**
  - ERA5 cells are about 25 km, which smooths extremes and coastal or urban effects. Snowfall is the model's value converted from water equivalent.
  - NOAA station data was **not needed and not downloaded**. If you want station-level validation, NOAA GHCN-hourly/ISD is optional.

## 4. Power plants: EIA-860
- **Page:** https://www.eia.gov/electricity/data/eia860/
- **Files** (saved in `data/raw/eia860/`, extracted to subfolders):
  - `https://www.eia.gov/electricity/data/eia860/xls/eia8602025.zip`: 23,622,347 bytes. This is the 2025 annual release; the page also lists `eia8602025ER.zip`, which was not used.
  - `https://www.eia.gov/electricity/data/eia860/archive/xls/eia8602020.zip`: 19,670,508 bytes.
  - Files used: `2___Plant_Y20xx.xlsx` (lat/lon, BA code, NERC region) and `3_1_Generator_Y20xx.xlsx` (sheets Operable and Retired and Canceled).
- **Method:**
  - ERCOT membership means the plant's Balancing Authority Code is `ERCO`. The 2025 plant file is used first, with the 2020 file as fallback.
  - Generators come from the 2025 Operable sheet plus the Retired sheet (status RE), plus any 2020 records missing from 2025.
  - 12 generators (252 MW) were operable in 2020 but are absent from the 2025 release with no retirement record. They are flagged `MISSING_IN_2025` and excluded from the capacity time series.
  - 19 TX generators (666 MW) have no plant record and were dropped.
  - Generators retired before 2007 are excluded.
- **Outputs:**
  - `ercot_generators.csv`: 2,352 rows. Columns: plant_id, generator_id, plant_name, county, lat, lon, technology, prime_mover, energy_source_1, nameplate_mw, summer_mw, **winter_mw**, operating_year/month, retirement_year/month, status, fuel, fuel_detail.
  - `ercot_plants.csv`: 974 rows. Columns: plant_id, name, lat, lon, county, fuel, fuel_detail (primary fuel = largest nameplate share), nameplate_mw, winter_mw, operable_nameplate_mw_2025, operating_year (earliest unit), retirement_year (set only if every unit is retired), n_generators. No missing lat/lon.
  - `ercot_capacity_by_fuel_winter.csv`: nameplate and winter MW by `fuel_detail` as of Feb 1 of each year, 2007-2025.
- **Quirks:**
  - EIA nameplate includes industrial cogeneration and private-use networks, and counts mothballed or standby units as operable. It therefore **overstates** what ERCOT could dispatch. EIA-860 shows 119.9 GW nameplate for Feb 2021, while ERCOT's winter resource planning number was much lower.
  - Capacities are the current ratings. Historical uprates and derates are not reconstructed.
- **Note:** `data/processed/ercot_plants.json` and `data/processed/tx_cities.json` were **not created by this data pass**. They appeared at 11:35, before `ercot_plants.csv` was written, presumably from another agent. Their provenance is unverified, so prefer `ercot_plants.csv` / `ercot_generators.csv`.

---

## Sanity checks

### Annual hourly load (ERCOT Native Load, MW)
| year | peak MW | peak (local HE) | DJF winter peak MW | winter peak (local HE) | min MW | mean MW | TWh | EIA-930 peak |
|---|---|---|---|---|---|---|---|---|
| 2007 | 62,115 | 08-13 16:00 | 50,410 | 01-16 19:00 | 21,795 | 35,000 | 306.6 | – |
| 2008 | 62,103 | 08-04 17:00 | 47,831 | 12-15 20:00 | 19,672 | 35,389 | 310.9 | – |
| 2009 | 63,407 | 07-13 17:00 | 46,202 | 12-10 08:00 | 21,379 | 35,090 | 307.4 | – |
| 2010 | 65,713 | 08-23 17:00 | 55,705 | 01-08 08:00 | 21,798 | 36,335 | 318.3 | – |
| **2011** | 68,318 | 08-03 17:00 | **57,284** | **02-10 08:00** | 22,366 | 38,127 | 334.0 | – |
| 2012 | 66,558 | 06-26 17:00 | 46,917 | 01-13 08:00 | 22,528 | 37,000 | 325.0 | – |
| 2013 | 67,253 | 08-07 17:00 | 53,671 | 12-10 08:00 | 23,441 | 37,869 | 331.7 | – |
| 2014 | 66,464 | 08-25 17:00 | 57,238 | 01-07 08:00 | 24,083 | 38,828 | 340.1 | – |
| 2015 | 69,620 | 08-10 17:00 | 56,848 | 01-08 08:00 | 24,337 | 39,669 | 347.5 | 69,785 |
| 2016 | 71,093 | 08-11 17:00 | 57,924 | 12-19 08:00 | 25,107 | 40,006 | 351.4 | 71,193 |
| 2017 | 69,496 | 07-28 17:00 | 59,636 | 01-06 19:00 | 25,566 | 40,781 | 357.2 | 69,531 |
| 2018 | 73,308 | 07-19 17:00 | 65,750 | 01-17 08:00 | 27,139 | 42,951 | 376.2 | 73,264 |
| 2019 | 74,666 | 08-12 17:00 | 56,066 | 12-18 08:00 | 27,612 | 43,818 | 383.8 | 74,533 |
| 2020 | 74,328 | 08-13 17:00 | 56,116 | 02-06 08:00 | 27,491 | 43,462 | 381.8 | 74,166 |
| **2021** | 73,651 | 08-24 17:00 | **69,692** | **02-14 20:00** | 27,800 | 44,829 | 392.7 | 73,476 |
| 2022 | 80,038 | 07-20 17:00 | 74,427 | 12-23 08:00 | 31,796 | 49,074 | 429.9 | 79,830 |
| 2023 | 85,464 | 08-10 18:00 | 65,632 | 01-31 19:00 | 33,298 | 50,747 | 444.5 | 85,432 |
| 2024 | 85,199 | 08-20 18:00 | 78,314 | 01-16 08:00 | 35,856 | 52,538 | 461.5 | 85,544 |

These values match ERCOT's published records to within the difference between hourly-integrated and instantaneous peaks: 2011 winter record about 57.3 GW on Feb 10, 2011; summer records 2018 73.3 GW, 2023 85.5 GW.

### Feb 2011 freeze (local days; temperatures are ERA5 hourly minima, gen is daily mean MW)
| day | load max | load min | load mean | Dallas min °C | Houston | Austin | Midland | coal | gas (non-CC) | gas_cc | nuclear | wind |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01-31 | 35,552 | 24,369 | 31,105 | 6.9 | 13.6 | 10.3 | 0.9 | 14,622 | 365 | 7,088 | 5,156 | 3,728 |
| 02-01 | 54,617 | 28,030 | 41,921 | -9.0 | -3.6 | -6.6 | -10.6 | 15,292 | 2,017 | 13,278 | 5,169 | 5,634 |
| **02-02** | 56,328 | 49,168 | 51,979 | -9.6 | -5.3 | -7.2 | -12.7 | **13,346** | 8,410 | 20,486 | 5,170 | 3,446 |
| 02-03 | 55,861 | 47,615 | 52,504 | -7.6 | -1.1 | -5.9 | -12.7 | 13,672 | 8,410 | 21,952 | 5,175 | 2,134 |
| 02-04 | 52,928 | 43,683 | 48,402 | -5.3 | -3.1 | -6.9 | -11.7 | 15,396 | 5,270 | 20,076 | 5,175 | 1,483 |
| 02-05 | 48,551 | 30,898 | 40,415 | -4.9 | -3.8 | -6.4 | -3.9 | 14,793 | 1,524 | 15,064 | 5,178 | 3,234 |

- Rolling outages ran on Feb 2, 2011 from about 05:43 CST until early afternoon, with up to about 4 GW shed. The served load stays flat at about 52-53 GW from 06:00 to 11:00, then the evening peak reaches 56.3 GW at HE 20:00 after service was restored. **Morning served load therefore understates demand by up to about 4 GW over roughly 8 hours.**
- Coal generation falls from 16.7 GW (Feb 1, 18:00) to 12.1 GW (Feb 2, 12:00), which is visible frozen-unit tripping. Non-CC gas ramps to about 10 GW.
- The **Feb 2011 load peak shortly after (Feb 10, 57.3 GW) had no shedding**, which makes it a useful clean high-demand calibration point.
- ERA5 snowfall totals Jan 31-Feb 5: Dallas 5.3 cm, Sweetwater 5.9, Lubbock 4.6. Lows: Lubbock -15.8 °C, Sweetwater -13.9.
- Capacity from EIA-860 as of 2011-02-01, nameplate: coal 17.8 GW, gas_cc 37.2, gas_steam 17.8, gas_ct 6.9, nuclear 5.1, wind 9.3. Total 95.9 GW nameplate / 92.1 GW winter rating.

### Winter Storm Uri, Feb 2021 (same columns, plus solar)
| day | load max | load min | load mean | Dallas min °C | Houston | Austin | Midland | coal | gas | gas_cc | nuclear | wind | solar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02-10 | 53,980 | 39,948 | 48,209 | -1.6 | 11.2 | 1.6 | -3.7 | 10,706 | 4,251 | 23,431 | 5,079 | 3,651 | 469 |
| 02-11 | 61,120 | 46,227 | 55,645 | -3.0 | 4.1 | -0.5 | -5.6 | 10,331 | 7,922 | 26,187 | 5,083 | 4,867 | 354 |
| 02-12 | 63,997 | 53,141 | 59,896 | -4.5 | 2.3 | -1.5 | -6.9 | 10,530 | 9,076 | 27,894 | 5,111 | 5,799 | 285 |
| 02-13 | 64,132 | 55,252 | 59,135 | -5.5 | 1.9 | -2.9 | -7.9 | 10,783 | 9,117 | 28,489 | 5,117 | 4,032 | 299 |
| **02-14** | **69,692** | 54,701 | 62,460 | -11.4 | -1.9 | -8.8 | -14.3 | 10,911 | 9,696 | 27,852 | 5,121 | 7,232 | 273 |
| **02-15** | 66,271 | 44,100 | 50,168 | -13.9 | -8.9 | -12.6 | -16.3 | 8,623 | 11,591 | 20,676 | **4,096** | 3,204 | 881 |
| **02-16** | 46,797 | 43,538 | 45,158 | **-18.8** | -12.1 | -14.8 | -12.2 | 7,316 | 9,700 | 19,332 | 3,715 | 3,706 | 612 |
| 02-17 | 49,445 | 42,629 | 45,308 | -6.6 | 0.3 | -5.0 | -9.0 | 7,278 | 8,922 | 21,109 | 3,728 | 2,537 | 987 |
| 02-18 | 55,724 | 47,971 | 51,970 | -4.7 | -0.1 | -3.1 | -9.4 | 8,106 | 9,481 | 22,368 | 4,557 | 5,802 | 769 |
| 02-19 | 58,610 | 39,795 | 49,397 | -10.5 | -2.9 | -7.5 | -11.5 | 8,830 | 6,680 | 20,527 | 5,123 | 6,015 | 1,358 |
| 02-20 | 52,761 | 33,953 | 43,135 | -3.2 | -1.9 | -5.4 | -2.6 | 7,530 | 3,852 | 14,479 | 5,123 | 10,688 | 911 |

- Hourly served load peaks at **69,692 MW at HE 20:00 on Feb 14**. It drops from 65,777 (HE01) to 63,910 (HE02) and then **53,983 (HE03) on Feb 15**, which is the start of firm load shed (ERCOT ordered it shortly after 01:00 CST).
- Served load then sits at **43-46 GW from Feb 15 midday to Feb 17**, while demand was clearly about 65-75 GW. The served-load series therefore understates demand by **up to about 20 GW for roughly 70 hours**, so the 2021 test needs a demand model rather than this series as ground truth.
- Nuclear drops by about 1.4 GW on Feb 15-16 (one South Texas Project unit tripped). Total gas falls from 37.5 GW (Feb 14 mean) to 32.3 GW (Feb 15) and 29.0 GW (Feb 16). Coal falls from about 10.9 to 7.3 GW.
- Wind during the storm is below the Feb 8 level of 10.9 GW but not zero.

Zonal daily mean load shows where shedding landed. FWEST fell from 4,061 MW on Feb 11 to 1,564 MW on Feb 15 and COAST from 13,059 to 10,579 MW (`ercot_load_zonal_hourly.parquet`).

Weather extremes, ERA5 (min °C / total snowfall cm):

| location | 2011 (Jan 31-Feb 5) | 2021 (Feb 10-20) |
|---|---|---|
| Dallas | -9.6 / 5.3 | -18.8 / 11.9 |
| Houston | -5.3 / 0.8 | -12.1 / 5.9 |
| Austin | -7.2 / 2.6 | -14.8 / 8.5 |
| San Antonio | -7.3 / 0.8 | -11.8 / 6.8 |
| Midland | -12.7 / 1.5 | -16.3 / 3.8 |
| Lubbock | -15.8 / 4.6 | -18.2 / 5.2 |
| Sweetwater | -13.9 / 5.9 | -16.8 / 5.0 |
| Corpus Christi | -3.4 / 2.4 | -7.0 / 0.4 |

Uri was about 4-9 °C colder than Feb 2011 at most points and lasted much longer. This is exactly the out-of-distribution test the plan intends: 2021 is the coldest Dallas hour in the 2007-2024 dataset.

Winter temperature-load relationship (DJF, Dallas temp vs ERCOT load): correlation is -0.58 for 2010-15, -0.52 for 2016-20 and -0.56 for 2021-23. Mean load when Dallas is below 0 °C rises from 44.0 GW (2010-15) to 48.7 GW (2016-20) to 55.1 GW (2021-23), reflecting load growth, so the model needs a trend or vintage term.

### Plants by primary fuel (`ercot_plants.csv`, plants that operated at some point since 2007)
| primary fuel | plants with operable units | MW | fully retired plants | MW |
|---|---|---|---|---|
| gas_cc | 60 | 46,450 | 1 | 344 |
| gas_steam | 23 | 17,313 | 9 | 5,893 |
| gas_ct | 46 | 9,588 | 4 | 57 |
| gas_ice | 146 | 1,236 | – | – |
| coal | 10 | 15,601 | 5 | 5,351 |
| nuclear | 2 | 5,139 | – | – |
| wind | 201 | 40,811 | – | – |
| solar | 213 | 31,517 | 1 | 1 |
| storage | 179 | 11,768 | 2 | 4 |
| hydro | 20 | 568 | 1 | 1 |
| oil | 28 | 370 | – | – |
| biomass | 8 | 165 | 10 | 67 |
| other | 5 | 134 | – | – |

Generators operable as of 2021-02-01: 1,425 units with 119.9 GW nameplate and 116.0 GW winter rating.
By fuel (nameplate / winter MW): gas_cc 43,411 / 41,759; gas_steam 12,035 / 11,573; gas_ct 8,430 / 7,572; gas_ice 848; coal 15,262 / 14,474; nuclear 5,139; wind 27,813; solar 4,866; storage 226; oil 874; hydro 569; biomass 169.

Nameplate capacity by fuel, as of Feb 1 (MW, EIA-860 derived; full table in `ercot_capacity_by_fuel_winter.csv`):

| as of | coal | gas_cc | gas_steam | gas_ct | nuclear | wind | solar | storage |
|---|---|---|---|---|---|---|---|---|
| 2007 | 15,293 | 34,698 | 23,059 | 5,968 | 5,139 | 2,596 | 0 | 0 |
| 2011 | 17,794 | 37,229 | 17,801 | 6,865 | 5,139 | 9,269 | 14 | 0 |
| 2014 | 19,681 | 37,576 | 14,834 | 6,860 | 5,139 | 11,022 | 127 | 41 |
| 2018 | 16,448 | 43,411 | 12,732 | 7,494 | 5,139 | 20,692 | 1,234 | 94 |
| 2021 | 15,262 | 43,411 | 12,035 | 8,430 | 5,139 | 27,813 | 4,866 | 226 |
| 2023 | 14,330 | 43,650 | 11,630 | 10,544 | 5,139 | 35,672 | 11,362 | 2,159 |

---

## Gaps and things that threaten the plan

1. **Feb 2011 is covered, but served load is not demand.**
   - Native Load drops when ERCOT sheds firm load. In 2011 this is up to about 4 GW for about 8 morning hours on Feb 2. In 2021 it is up to about 20 GW for about 70 hours (Feb 15-18).
   - Calibrate demand on non-shed hours. Feb 10, 2011 (57.3 GW, no shedding), Jan 2018 (65.8 GW) and Dec 2022 (74.4 GW) are good cold, high-load anchors.
   - Treat 2021 "true demand" as a model output. ERCOT and post-event reports give estimates of about 74-77 GW, but those were not downloaded here.
2. **No unit-level outage or derate data was downloaded.**
   - The fuel mix gives dispatched energy by fuel, not availability. Forced outages are visible only indirectly: coal -4.6 GW on Feb 2, 2011; gas -5 to -8.5 GW, coal -3.6 GW and nuclear -1.4 GW on Feb 15-16, 2021.
   - During EEA/shed hours the system was short, so generation by fuel ≈ available capacity by fuel. Installed winter MW minus generation then gives a usable outage proxy for both storms.
   - If a unit-level dataset is wanted, ERCOT published Uri unit outage lists (60-day disclosure / post-event reports), and the FERC/NERC Feb 2011 report has aggregate outage counts. Neither was fetched.
3. **EIA-860 capacity is an upper bound.** It includes private-use-network cogeneration and counts mothballed units as operable, and ratings are current, not historical. 12 units (252 MW) disappear between the 2020 and 2025 releases. Use winter ratings with derates. If ERCOT's own "available" capacity is needed, use ERCOT CDR/SARA reports, which were not downloaded.
4. **Fuel taxonomy drift.** Gas is a single category before Dec 2008. Solar and biomass are inside `other` before 2011. Storage charging is negative from 2022 and discharge is likely inside `other`. Map these consistently before training.
5. **DST hours.** About 1-3 hours per year at DST transitions are unreliable in the fuel mix, and spring-forward days before 2016 may be shifted 1 h. None fall in Dec-Feb.
6. **Weather resolution.** These are 8 ERA5 points at 0.25°. They match observed extremes well (Dallas -18.8 °C vs DFW -18.9 °C), but local extremes and icing are smoothed, and there is no freezing-rain or icing variable. ERA5 wind is 10 m, not hub height.
7. **Load growth.** 2021-2023 cold-weather load is about 11 GW higher than 2010-2015 at the same temperatures. A model trained only on pre-2021 data must extrapolate both the weather and the load level.

## Output inventory (`D:\dev\MongoDB\data\processed\`)
| file | rows | key columns |
|---|---|---|
| ercot_load_hourly.parquet | 157,800 | ts_utc, ts_local, load_mw, source |
| ercot_load_zonal_hourly.parquet | 1,262,400 | ts_utc, ts_local, zone, load_mw |
| ercot_gen_by_fuel_hourly.parquet | 1,350,842 | ts_utc, ts_local, fuel, mw, n_intervals, source |
| eia930_erco_hourly.parquet | 98,880 | ts_utc, ts_local, demand, net_generation, ng_* (wide) |
| weather_hourly.parquet | 1,262,400 | ts_utc, location, lat, lon, grid_lat, grid_lon, temp_c, wind_ms, snowfall_cm, precip_mm |
| ercot_plants.csv | 974 | plant_id, name, lat, lon, fuel, fuel_detail, nameplate_mw, winter_mw, operating_year, retirement_year |
| ercot_generators.csv | 2,352 | generator-level, including winter_mw and operating/retirement dates |
| ercot_capacity_by_fuel_winter.csv | 237 | as_of, fuel_detail, nameplate_mw, winter_mw |

All timestamps are hour-ending. `ts_utc` is UTC and `ts_local` is tz-aware America/Chicago (`US/Central`).
