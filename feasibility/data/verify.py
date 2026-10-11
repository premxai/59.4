"""Coverage + sanity checks on processed datasets. Prints markdown-ish text for DATA_REPORT.md."""
from pathlib import Path

import numpy as np
import pandas as pd

P = Path(r"D:\dev\MongoDB\data\processed")
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 40)

load = pd.read_parquet(P / "ercot_load_hourly.parquet")
gen = pd.read_parquet(P / "ercot_gen_by_fuel_hourly.parquet")
wx = pd.read_parquet(P / "weather_hourly.parquet")
eia = pd.read_parquet(P / "eia930_erco_hourly.parquet")
zonal = pd.read_parquet(P / "ercot_load_zonal_hourly.parquet")

W0, W1 = pd.Timestamp("2010-01-01 07:00", tz="UTC"), pd.Timestamp("2024-01-01 06:00", tz="UTC")  # HE01 CST 2010-01-01 .. HE24 2023-12-31
full = pd.date_range(W0, W1, freq="h")


def cov(ts, name, values=None):
    s = pd.Series(1, index=pd.DatetimeIndex(ts)) if values is None else pd.Series(values.values, index=pd.DatetimeIndex(ts))
    s = s[~s.index.duplicated()]
    inwin = s.reindex(full)
    miss = inwin.isna().mean() * 100
    print(f"| {name} | {s.index.min()} | {s.index.max()} | {miss:.3f}% ({int(inwin.isna().sum())} h) |")


print("## Coverage (window 2010-01-01 HE01 CST .. 2023-12-31 HE24 CST = %d hours)" % len(full))
print("| dataset | first ts_utc | last ts_utc | missing in window |")
print("|---|---|---|---|")
cov(load.ts_utc, "ERCOT native load (load_mw non-null)", load.load_mw)
tot = gen.groupby("ts_utc").mw.sum()
cov(tot.index, "ERCOT fuel mix (any fuel)")
for f in ["coal", "gas", "gas_cc", "nuclear", "wind", "solar"]:
    g = gen[gen.fuel == f]
    cov(g.ts_utc, f"  fuel mix: {f}", g.mw)
for loc, g in wx.groupby("location"):
    cov(g.ts_utc, f"weather {loc}", g.temp_c)
cov(eia.ts_utc, "EIA-930 ERCO demand", eia.demand)
cov(eia.ts_utc, "EIA-930 ERCO coal gen (ng_col)", eia.ng_col)
print("fuel-mix missing hours in window:", [str(t) for t in full.difference(tot.index)])
print("fuel-mix hours with <4 quarter-hours (local):", sorted(set(gen.loc[gen.n_intervals < 4, "ts_local"].dt.strftime("%Y-%m-%d %H:%M"))))
e_span = pd.date_range(eia.ts_utc.min(), pd.Timestamp("2024-01-01 06:00", tz="UTC"), freq="h")
for c in ["demand", "net_generation", "ng_col", "ng_ng", "ng_wnd"]:
    v = eia.set_index("ts_utc")[c].reindex(e_span)
    print(f"EIA-930 {c}: missing {v.isna().mean()*100:.2f}% of hours between first record and 2023-12-31 (first non-null {v.first_valid_index()})")
print("fuel-mix hours with <4 quarter-hours:", int((gen.n_intervals < 4).sum()),
      "| with >4:", int((gen.n_intervals > 4).sum()))

print("\n## Annual peak / min hourly load (ERCOT native load, MW) and EIA-930 demand peak")
L = load.set_index("ts_local").load_mw
E = eia.set_index("ts_local").demand
rows = []
for y in range(2007, 2025):
    ly = L[L.index.year == y]
    ey = E[E.index.year == y]
    w = ly[(ly.index.month <= 2) | (ly.index.month == 12)]
    rows.append({"year": y, "peak_mw": round(ly.max()), "peak_time_local": ly.idxmax().strftime("%Y-%m-%d %H:%M"),
                 "winter_peak_mw(DJF)": round(w.max()), "winter_peak_time": w.idxmax().strftime("%Y-%m-%d %H:%M"),
                 "min_mw": round(ly.min()), "mean_mw": round(ly.mean()), "energy_TWh": round(ly.sum() / 1e6, 1),
                 "eia930_peak_mw": round(ey.max()) if len(ey) else None})
print(pd.DataFrame(rows).to_string(index=False))

# cross-checks
print("\n## Cross-check: EIA-930 demand vs ERCOT native load (overlap 2015-07..2024)")
m = load.merge(eia[["ts_utc", "demand"]], on="ts_utc", how="inner").dropna()
m = m[(m.demand > 0)]
d = m.demand - m.load_mw
print(f"n={len(m)}  mean(EIA-ERCOT)={d.mean():.0f} MW  median={d.median():.0f}  MAPE={np.mean(np.abs(d)/m.load_mw)*100:.2f}%  corr={m.demand.corr(m.load_mw):.4f}")
for lag in (-1, 0, 1):
    mm = load.assign(ts_utc=load.ts_utc + pd.Timedelta(hours=lag)).merge(eia[["ts_utc", "demand"]], on="ts_utc").dropna()
    mm = mm[mm.demand > 0]
    print(f"  lag {lag:+d}h: MAE={np.mean(np.abs(mm.demand-mm.load_mw)):.0f} MW")

print("\n## Cross-check: sum of fuel-mix generation vs native load")
gm = load.merge(tot.rename("gen_mw").reset_index(), on="ts_utc").dropna()
r = gm.gen_mw / gm.load_mw
by = gm.assign(r=r).groupby(gm.ts_utc.dt.year).r.describe()[["mean", "min", "50%", "max"]].round(3)
print(by.to_string())
for lag in (-1, 0, 1):
    gg = load.assign(ts_utc=load.ts_utc + pd.Timedelta(hours=lag)).merge(tot.rename("gen_mw").reset_index(), on="ts_utc").dropna()
    print(f"  lag {lag:+d}h: MAE(gen-load)={np.mean(np.abs(gg.gen_mw-gg.load_mw)):.0f} MW  corr={gg.gen_mw.corr(gg.load_mw):.5f}")

print("\n## Cross-check: ERCOT fuel mix vs EIA-930 by fuel (2019-2023, mean MW)")
e2 = eia[(eia.ts_utc >= "2019-01-01") & (eia.ts_utc < "2024-01-01")]
g2 = gen[(gen.ts_utc >= "2019-01-01") & (gen.ts_utc < "2024-01-01")].pivot(index="ts_utc", columns="fuel", values="mw")
print(f"  coal: ERCOT {g2.coal.mean():.0f} vs EIA {e2.ng_col.mean():.0f}; gas+gas_cc: ERCOT {(g2.gas+g2.gas_cc).mean():.0f} vs EIA {e2.ng_ng.mean():.0f}; "
      f"nuclear: {g2.nuclear.mean():.0f} vs {e2.ng_nuc.mean():.0f}; wind: {g2.wind.mean():.0f} vs {e2.ng_wnd.mean():.0f}; solar: {g2.solar.mean():.0f} vs {e2.ng_sun.mean():.0f}")

wxp = wx.pivot_table(index="ts_utc", columns="location", values="temp_c")
gp = gen.pivot(index="ts_utc", columns="fuel", values="mw")


def window(t0, t1, title):
    print(f"\n## {title}: daily summary (local days)")
    idx = load.set_index("ts_utc")
    sel = idx[(idx.ts_local >= t0) & (idx.ts_local < t1)]
    df = pd.DataFrame({"load_mw": sel.load_mw})
    df = df.join(wxp[["Dallas", "Houston", "Austin", "San Antonio", "Midland", "Lubbock"]])
    cols = [c for c in ["coal", "gas", "gas_cc", "nuclear", "wind", "solar"] if c in gp.columns]
    df = df.join(gp[cols].add_prefix("gen_"))
    df["day"] = sel.ts_local.dt.date
    agg = df.groupby("day").agg(load_max=("load_mw", "max"), load_min=("load_mw", "min"), load_mean=("load_mw", "mean"),
                                dallas_min_c=("Dallas", "min"), houston_min_c=("Houston", "min"),
                                austin_min_c=("Austin", "min"), midland_min_c=("Midland", "min"),
                                **{f"{c}_mean": (f"gen_{c}", "mean") for c in cols})
    print(agg.round(1).to_string())
    return df


w11 = window("2011-01-31", "2011-02-06", "Feb 2011 freeze (Jan 31 - Feb 5, 2011)")
w21 = window("2021-02-08", "2021-02-21", "Winter Storm Uri (Feb 8 - 20, 2021)")

print("\n## Hourly detail around the load-shed events")
idx = load.set_index("ts_local")
print("Feb 2 2011 (rolling outages ~05:43-13:35 CST, up to ~4,000 MW shed):")
print(idx.loc["2011-02-02 00:00":"2011-02-02 16:00", "load_mw"].round(0).to_string())
print("Feb 14-16 2021 (firm load shed from ~01:20 CST Feb 15, peak ~20,000 MW):")
print(idx.loc["2021-02-14 16:00":"2021-02-15 08:00", "load_mw"].round(0).to_string())

print("\n## Zonal native load share, Feb 2 2011 vs Feb 15 2021 (daily mean MW)")
z = zonal.copy()
z["d"] = z.ts_local.dt.date.astype(str)
print(z[z.d.isin(["2011-02-02", "2021-02-15", "2021-02-11"])].pivot_table(index="d", columns="zone", values="load_mw", aggfunc="mean").round(0).to_string())

print("\n## Weather extremes per location, Feb 2011 vs Feb 2021 (min temp C, max daily snowfall cm)")
wx["d"] = wx.ts_utc.dt.tz_convert("US/Central").dt.date
for (a, b, lab) in [("2011-01-31", "2011-02-06", "2011"), ("2021-02-10", "2021-02-21", "2021")]:
    s = wx[(wx.d >= pd.Timestamp(a).date()) & (wx.d < pd.Timestamp(b).date())]
    print(lab, s.groupby("location").agg(tmin=("temp_c", "min"), wind_max=("wind_ms", "max"),
                                         snow_total=("snowfall_cm", "sum")).round(1).T.to_string())

print("\n## Coldest hours on record in the weather data (2007-2024), Dallas")
dal = wx[wx.location == "Dallas"].nsmallest(5, "temp_c")[["ts_utc", "temp_c"]]
print(dal.to_string(index=False))

print("\n## Winter temp-load relationship (DJF, Dallas temp vs ERCOT load, by year group)")
jl = load.set_index("ts_utc").join(wxp["Dallas"]).dropna()
jl = jl[jl.ts_local.dt.month.isin([12, 1, 2])]
for (a, b) in [(2010, 2015), (2016, 2020), (2021, 2023)]:
    s = jl[(jl.ts_local.dt.year >= a) & (jl.ts_local.dt.year <= b)]
    cold = s[s.Dallas < 0]
    print(f"  {a}-{b}: corr={s.load_mw.corr(s.Dallas):.3f}  mean load when Dallas<0C: {cold.load_mw.mean():.0f} MW (n={len(cold)})")

pl = pd.read_csv(P / "ercot_plants.csv")
gn = pd.read_csv(P / "ercot_generators.csv")
print("\n## Plants by primary fuel (ercot_plants.csv)")
pl["status"] = np.where(pl.retirement_year.notna(), "fully retired", "has operable units")
print(pl.groupby(["fuel_detail", "status"]).agg(plants=("plant_id", "count"), nameplate_mw=("nameplate_mw", "sum")).round(0).to_string())
print("\n## Generators operable as of 2021-02-01 by fuel (count, nameplate MW, winter MW)")
op = gn.operating_year * 12 + gn.operating_month.fillna(1)
rt = gn.retirement_year * 12 + gn.retirement_month.fillna(12)
ref = 2021 * 12 + 2
live = (op < ref) & (rt.isna() | (rt >= ref)) & (gn.status != "MISSING_IN_2025")
print(gn[live].groupby("fuel_detail").agg(gens=("plant_id", "count"), plants=("plant_id", "nunique"),
                                         nameplate_mw=("nameplate_mw", "sum"), winter_mw=("winter_mw", "sum")).round(0).to_string())
print("total nameplate", round(gn[live].nameplate_mw.sum()), "winter", round(gn[live].winter_mw.sum()))
ref = 2011 * 12 + 2
live = (op < ref) & (rt.isna() | (rt >= ref)) & (gn.status != "MISSING_IN_2025")
print("as of 2011-02-01: total nameplate", round(gn[live].nameplate_mw.sum()), "winter", round(gn[live].winter_mw.sum()))
