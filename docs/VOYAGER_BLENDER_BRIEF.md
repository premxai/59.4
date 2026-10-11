# Brief for Voyager + Blender: the "4:37" winter-storm city

> Paste everything below the line into Voyager (Claude). Work in the four phases in §10 and stop for review after each.

---

## Context (read first)

You are building a Blender scene for **"4:37"**, a project where an AI operator runs a simulated Texas power grid through a severe winter storm. A simulator decides, hour by hour, which city power zones have electricity, how much snow and frost there is, whether wind turbines spin, and whether the gas power plant runs.

**This scene will be driven by data.** A Python script will set the values on one control object (§3) for every simulated hour. The visuals will be used in two ways:
1. **Still "light layers"** combined live in a web app: dark base image + the lights of every zone that has power.
2. **Animated cinematic shots** for a video.

Beauty matters, but **the zones, names, controls and render settings below are mandatory.** They are how the data connects to the picture. If something can't be done exactly as specified, ask me before changing it.

**Style reference:** keep the look of my two earlier test renders:
- dusk gradient sky (blue horizon into pink/violet)
- dark ground
- an emissive amber street grid and a ring road
- a dense downtown with lit windows
- wind turbines with red aviation lights on the horizon
- glowing transmission lines

**The new requirement: it is deep winter during a historic freeze.**

## 1. Scene content

**City:** a mid-size Texas city with:
- a downtown core of towers
- an inner ring road
- a street grid
- suburbs of small houses
- a few industrial blocks

Stylized realism, low-to-mid poly. Geometry Nodes instancing is welcome.

**Winter:**
- snow on the ground and rooftops
- frosted terrain
- low icy-blue ground fog
- light falling snow, as particles in their own collection
- a thin layer of ice on the power lines
- optional: a frozen pond or river

**Power infrastructure (story pieces), outside the city:**
- **Wind farm** on the north-west horizon: 20–40 turbines with blinking red aviation lights. Rotors are separate objects.
- **Natural-gas power plant** to the east: 2–3 smokestacks with steam plumes and site lights.
- **Pumpjack field + a small gas compressor station** to the south-west. This is where the gas comes from.
- **Battery storage yard** next to the main substation: rows of white containers with small status lights.
- **2–3 substations** at the city edge, with **transmission lines** from the wind farm and the gas plant into them.
- Inside the city: **a hospital and a water treatment plant** (critical facilities).

**No text, logos, brand names or UI anywhere in the scene.**

## 2. Power zones (mandatory)

Every emissive light in the city (street lights, building windows, signs) belongs to exactly one zone. Each zone is a **Collection with this exact name**:

| Collection | Area |
|---|---|
| `Zone_01` – `Zone_04` | downtown quadrants |
| `Zone_05` – `Zone_10` | inner-ring sectors (6 slices) |
| `Zone_11` – `Zone_16` | suburbs (6 slices) |
| `Zone_CRIT` | hospital + water plant (stays lit during rotating outages) |
| `Zone_GAS` | gas compressor station + pumpjack field lights |

- Light comes from **emissive materials**, not hundreds of light objects.
- Each zone's emission is controlled by **one value from 0 to 1** (§3). At 0 the zone is fully dark: windows black, street lights off.

## 3. Control object (mandatory)

Create an **Empty named `SIM_CONTROL`** with these float custom properties, connected to the scene with drivers:

| Property | Range | Effect |
|---|---|---|
| `zone_01` … `zone_16`, `zone_crit`, `zone_gas` | 0–1 (default 1) | multiplies the emission of that zone |
| `snow_amount` | 0–1 | snow cover on ground and roofs (0 = dry winter ground, 1 = full snow) |
| `frost_amount` | 0–1 | white-blue frost on wellheads, turbines, lines, substations |
| `snowfall` | 0–1 | density of falling snow |
| `sky_time` | 0–1 | 0 = late afternoon, 0.5 = dusk (like my test renders), 1 = deep night (moonlight only, very dark) |
| `turbines_running` | 0–1 | fraction of turbines whose rotors spin, in a fixed order; stopped rotors look frosted |
| `gas_plant_on` | 0–1 | steam plume visibility + plant site lights |
| `line_glow` | 0–1 | transmission-line glow (power flowing) |
| `battery_glow` | 0–1 | battery-yard status lights |

**Every visual state must be reachable by keyframing only these properties.** No manual material edits.

## 4. Object naming (mandatory)

**Objects:**
- turbines: `Turbine_01…` with rotors `Rotor_01…`
- gas plant: `GasPlant_01`, `Stack_01…`, `Steam_01…`
- `Wellhead_01…` (pumpjacks)
- `Compressor_01`
- `BatteryYard_01`
- `Substation_01…03`
- `Hospital_01`
- `WaterPlant_01`
- transmission lines: `Line_*`

**Top-level collections:**
- `CITY`
- `ZONES`
- `INFRA`
- `WINTER_FX`
- `CAMERAS`

## 5. Cameras (mandatory)

| Camera | Framing | Use |
|---|---|---|
| `CAM_Wide` | elevated 3/4 aerial over the city, like test render 2 | **hero split screen** |
| `CAM_Street` | ground level at the edge of town, looking at downtown along a transmission line, like test render 1 | emotional close shot |
| `CAM_Aerial` | high, near top-down, whole city + wind farm + gas plant + pumpjacks | overview + zone map |
| `CAM_Fly` | animated 20 s slow fly-over: wind farm → pumpjack field → over the city → ends in `CAM_Wide` framing | video |

**Fixed cameras are locked.** Never move them after the stills are rendered.

## 6. Look

- **Palette:**
  - deep navy/indigo night
  - warm amber street lights (~2200 K)
  - cool white downtown windows
  - red aviation blinkers
  - icy blue fog and snow
  - everything else dark and low-saturation
- Windows lit randomly, 60–80% on. Glowing, never blown out.
- **Engine:** EEVEE (Blender 5.x), 1920×1080, 30 fps.
- **View transform:** AgX for previews and animations.
- **Performance:** keep the scene interactive, prefer instancing, and pack textures. Keep the .blend under ~1.5 GB.

## 7. Stills for the live web app: "light layers" (technical, important)

These stills are added together in the web app (**final = base + every lit zone's layer**), so they must be perfectly consistent.

**Cameras:** `CAM_Wide` and `CAM_Street` (and `CAM_Aerial` if time allows). For each camera:

1. **Base images.**
   - All zones = 0, `gas_plant_on` = 0, `line_glow` = 0, `battery_glow` = 0.
   - Render 6 versions: `sky_time` ∈ {0, 0.5, 1} × `snow_amount` ∈ {0, 1}, with `frost_amount` = `snow_amount`.
   - File name: `{CAM}__base__sky{0|05|1}__snow{0|1}.png`
2. **Zone light layers.**
   - World/sky strength 0, sun and moon off.
   - **Only one** zone = 1, every other zone = 0; `snow_amount` = 1.
   - File name: `{CAM}__zone_{01…16|crit|gas}.png`
3. **Infrastructure light layers**, rendered the same way:
   - `{CAM}__infra_gasplant.png` (`gas_plant_on` = 1, steam lit)
   - `{CAM}__infra_lines.png` (`line_glow` = 1)
   - `{CAM}__infra_turbines.png` (aviation lights)
   - `{CAM}__infra_battery.png` (`battery_glow` = 1)
4. **Settings for every light layer and base:**
   - **View Transform = Standard, Look = None, Exposure 0**
   - **no Bloom/Glare or other compositor effects**
   - no auto-exposure
   - identical samples
   - PNG RGB 16-bit
   - black background for light layers

   We add bloom and tone mapping in the browser.
5. **Zone ID map:** flat, unlit renders from `CAM_Wide` and `CAM_Aerial`, one distinct solid color per zone (`Zone_01…16`, `CRIT`, `GAS`), everything else black.
   - Files: `{CAM}__zone_id.png`
   - Plus `zone_id_legend.json` mapping zone name → hex color.
6. **Previews:** one per camera with everything on, AgX look: `{CAM}__preview.png`.

## 8. Control test animation

Render a 10-second `CAM_Wide` test that proves the controls work:

| Time | Action |
|---|---|
| 0–2 s | `sky_time` 0.5 → 1 and `snow_amount` 0 → 1 |
| 2–8 s | zones switch off one by one (01 → 16) |
| at 7 s | `zone_gas` → 0, and over the next second `gas_plant_on` 1 → 0. When the gas facilities lose power, the plant loses fuel |
| from 6 s | `turbines_running` 1 → 0 |
| 9 s | `zone_crit` → 0, the city is fully dark |

Output: `test_controls.mp4` (H.264, AgX).

## 9. Deliverables (folder layout)

```
blender/
  4_37_city.blend
  README_scene.md        ← list every collection, object group, SIM_CONTROL property (what it drives) and camera
  renders/stills/CAM_Wide/...
  renders/stills/CAM_Street/...
  renders/stills/CAM_Aerial/...
  renders/previews/...
  renders/zone_id_legend.json
  renders/test_controls.mp4
```

## 10. Work order: stop and show me after each phase

1. **Blockout:** city layout, the 18 zones colored distinctly in the viewport, infrastructure placement, all cameras. → Show a `CAM_Aerial` screenshot with zones colored.
2. **Look development:** winter materials, emissive lights, sky, fog, snow. → Show `CAM_Wide` and `CAM_Street` previews.
3. **Controls:** `SIM_CONTROL` + drivers. → Show `test_controls.mp4`.
4. **Final renders** (§7) + `README_scene.md`.

## Acceptance checklist (verify before saying "done")

- [ ] Every collection, object and property name matches this brief exactly
- [ ] Setting `zone_07` = 0 darkens only Zone 7 (check at least 3 zones)
- [ ] `zone_gas` and `zone_crit` work independently of the 16 city zones
- [ ] `turbines_running` = 0.5 stops about half the rotors; `gas_plant_on` = 0 removes the steam and site lights
- [ ] Base + all zone + infra layers, summed, look close to the all-on preview (spot check)
- [ ] Fixed cameras did not move between any of the stills
- [ ] No text, logos or UI in any render
