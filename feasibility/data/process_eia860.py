"""EIA-860 (2025 + 2020 releases) -> ERCOT generator / plant / winter-capacity tables.

Outputs (data/processed/):
  ercot_generators.csv                 one row per generator ever operating in ERCOT since 2007
  ercot_plants.csv                     one row per plant (primary fuel = largest nameplate share)
  ercot_capacity_by_fuel_winter.csv    nameplate & winter-rated MW by fuel as of Feb 1 of each year
ERCOT membership = plant Balancing Authority Code == 'ERCO' (2025 plant file, else 2020 file).
Generator records: 2025 Operable + Retired (status RE), plus 2020 Operable/Retired records for
generators that no longer appear in the 2025 release.
"""
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(r"D:\dev\MongoDB\data\raw\eia860")
OUT = Path(r"D:\dev\MongoDB\data\processed")

TECH_MAP = {
    "Natural Gas Fired Combined Cycle": ("gas", "gas_cc"),
    "Natural Gas Fired Combustion Turbine": ("gas", "gas_ct"),
    "Natural Gas Steam Turbine": ("gas", "gas_steam"),
    "Natural Gas Internal Combustion Engine": ("gas", "gas_ice"),
    "Natural Gas with Compressed Air Storage": ("gas", "gas_other"),
    "Other Natural Gas": ("gas", "gas_other"),
    "Conventional Steam Coal": ("coal", "coal"),
    "Coal Integrated Gasification Combined Cycle": ("coal", "coal"),
    "Nuclear": ("nuclear", "nuclear"),
    "Onshore Wind Turbine": ("wind", "wind"),
    "Offshore Wind Turbine": ("wind", "wind"),
    "Solar Photovoltaic": ("solar", "solar"),
    "Solar Thermal with Energy Storage": ("solar", "solar"),
    "Solar Thermal without Energy Storage": ("solar", "solar"),
    "Batteries": ("storage", "storage"),
    "Flywheels": ("storage", "storage"),
    "Conventional Hydroelectric": ("hydro", "hydro"),
    "Hydroelectric Pumped Storage": ("hydro", "hydro_pumped"),
    "Petroleum Liquids": ("oil", "oil"),
    "Petroleum Coke": ("oil", "oil"),
    "Wood/Wood Waste Biomass": ("biomass", "biomass"),
    "Landfill Gas": ("biomass", "biomass"),
    "Municipal Solid Waste": ("biomass", "biomass"),
    "Other Waste Biomass": ("biomass", "biomass"),
    "Geothermal": ("other", "geothermal"),
    "Other Gases": ("other", "other"),
    "All Other": ("other", "other"),
}


def read(year, name, sheet=0):
    f = next((RAW / f"eia860{year}").glob(f"{name}*Y{year}.xlsx"))
    df = pd.read_excel(f, sheet_name=sheet, header=1)
    return df[pd.to_numeric(df["Plant Code"], errors="coerce").notna()]  # drop footnote rows


def gens(year):
    op = read(year, "3_1_Generator", "Operable").assign(sheet="operable")
    re_ = read(year, "3_1_Generator", "Retired and Canceled").assign(sheet="retired")
    re_ = re_[re_["Status"].astype(str).str.upper().str.strip() == "RE"]
    g = pd.concat([op, re_], ignore_index=True)
    g["source_year"] = year
    return g


def main():
    p25, p20 = read(2025, "2___Plant"), read(2020, "2___Plant")
    plants = pd.concat([p25.assign(src=2025), p20.assign(src=2020)]).drop_duplicates("Plant Code", keep="first")
    plants = plants.set_index("Plant Code")

    g25, g20 = gens(2025), gens(2020)
    key = ["Plant Code", "Generator ID"]
    g20_extra = g20.merge(g25[key], on=key, how="left", indicator=True)
    g20_extra = g20_extra[g20_extra["_merge"] == "left_only"].drop(columns="_merge")
    g = pd.concat([g25, g20_extra], ignore_index=True)
    g["Plant Code"] = g["Plant Code"].astype(int)

    g["ba"] = g["Plant Code"].map(plants["Balancing Authority Code"])
    g["lat"] = pd.to_numeric(g["Plant Code"].map(plants["Latitude"]), errors="coerce")
    g["lon"] = pd.to_numeric(g["Plant Code"].map(plants["Longitude"]), errors="coerce")
    g["nerc"] = g["Plant Code"].map(plants["NERC Region"])
    tx_unknown_ba = g[(g["State"] == "TX") & g["ba"].isna()]
    print("TX generators with no plant record (dropped):", len(tx_unknown_ba),
          "MW", round(pd.to_numeric(tx_unknown_ba["Nameplate Capacity (MW)"], errors="coerce").sum()))
    g = g[g["ba"] == "ERCO"].copy()

    num = lambda c: pd.to_numeric(g[c].replace(" ", np.nan), errors="coerce")  # noqa: E731
    out = pd.DataFrame({
        "plant_id": g["Plant Code"], "generator_id": g["Generator ID"].astype(str),
        "plant_name": g["Plant Name"], "county": g["County"], "lat": g["lat"], "lon": g["lon"],
        "technology": g["Technology"], "prime_mover": g["Prime Mover"], "energy_source_1": g["Energy Source 1"],
        "nameplate_mw": num("Nameplate Capacity (MW)"), "summer_mw": num("Summer Capacity (MW)"),
        "winter_mw": num("Winter Capacity (MW)"),
        "operating_year": num("Operating Year"), "operating_month": num("Operating Month"),
        "retirement_year": num("Retirement Year"), "retirement_month": num("Retirement Month"),
        "status": g["Status"], "sheet": g["sheet"], "source_year": g["source_year"],
    })
    mapped = out["technology"].map(TECH_MAP)
    unk = out.loc[mapped.isna(), "technology"].value_counts()
    if len(unk):
        print("unmapped technologies:", unk.to_dict())
    out["fuel"] = mapped.map(lambda t: t[0] if isinstance(t, tuple) else "other")
    out["fuel_detail"] = mapped.map(lambda t: t[1] if isinstance(t, tuple) else "other")
    # 2020-only operable generators that vanished from 2025 without a retirement record
    vanished = (out["source_year"] == 2020) & (out["sheet"] == "operable")
    out.loc[vanished, "status"] = "MISSING_IN_2025"
    print("2020-operable ERCOT generators absent from 2025 release:", int(vanished.sum()),
          "MW", round(out.loc[vanished, "nameplate_mw"].sum()))
    out = out[(out["retirement_year"].isna()) | (out["retirement_year"] >= 2007)]
    out = out.sort_values(["plant_id", "generator_id"])
    out.to_csv(OUT / "ercot_generators.csv", index=False)
    print("ERCOT generators:", len(out), "plants:", out.plant_id.nunique(),
          "missing lat/lon:", int(out.lat.isna().sum()))

    # plant table
    def agg(df):
        by = df.groupby("fuel_detail")["nameplate_mw"].sum().sort_values(ascending=False)
        retired_all = df["retirement_year"].notna().all()
        return pd.Series({
            "name": df["plant_name"].iloc[0], "lat": df["lat"].iloc[0], "lon": df["lon"].iloc[0],
            "county": df["county"].iloc[0],
            "fuel": df.loc[df.fuel_detail == by.index[0], "fuel"].iloc[0], "fuel_detail": by.index[0],
            "nameplate_mw": round(df["nameplate_mw"].sum(), 1), "winter_mw": round(df["winter_mw"].sum(), 1),
            "operable_nameplate_mw_2025": round(df.loc[df.sheet.eq("operable") & df.source_year.eq(2025), "nameplate_mw"].sum(), 1),
            "operating_year": df["operating_year"].min(),
            "retirement_year": df["retirement_year"].max() if retired_all else np.nan,
            "n_generators": len(df),
        })
    pl = out.groupby("plant_id").apply(agg, include_groups=False).reset_index()
    pl.to_csv(OUT / "ercot_plants.csv", index=False)

    # capacity by fuel as of Feb 1 each year
    rows = []
    op_ym = out["operating_year"] * 12 + out["operating_month"].fillna(1)
    ret_ym = out["retirement_year"] * 12 + out["retirement_month"].fillna(12)
    for y in range(2007, 2026):
        ref = y * 12 + 2  # Feb of year y
        live = (op_ym < ref) & (ret_ym.isna() | (ret_ym >= ref)) & (out["status"] != "MISSING_IN_2025")
        s = out[live].groupby("fuel_detail")[["nameplate_mw", "winter_mw"]].sum().round(0)
        for fuel, r in s.iterrows():
            rows.append({"as_of": f"{y}-02-01", "fuel_detail": fuel, "nameplate_mw": r.nameplate_mw, "winter_mw": r.winter_mw})
    cap = pd.DataFrame(rows)
    cap.to_csv(OUT / "ercot_capacity_by_fuel_winter.csv", index=False)
    print(cap.pivot(index="as_of", columns="fuel_detail", values="nameplate_mw").fillna(0).astype(int).to_string())


if __name__ == "__main__":
    main()
