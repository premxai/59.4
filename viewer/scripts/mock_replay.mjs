#!/usr/bin/env node
// Generates format-correct MOCK replays (`437-replay/1`, see docs/REPLAY_FORMAT.md) so the
// viewer can be developed before the simulator exporter lands.
//
//   node scripts/mock_replay.mjs            -> public/replays/mock_gen1.json, mock_gen11.json
//
// mock_gen1  : late, small rolling outages -> frequency countdown -> collapse at hour 61.
// mock_gen11 : rotation starts 3 h earlier, protects gas facilities -> survives with
//              rotating outages, lights back by ~hour 140.
// Everything here is invented test data. Never show it as a result.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "replays");
mkdirSync(OUT, { recursive: true });

const HOURS = 192;
const START = Date.parse("2021-02-10T06:00:00Z"); // 00:00 CST
const TOTAL_HOMES = 11_200_000;

// The 8 ERA5 weather points used by the data pass (data/DATA_REPORT.md §3).
const REGIONS = [
  { id: "lubbock", name: "Lubbock", lat: 33.5779, lon: -101.8552 },
  { id: "midland", name: "Midland", lat: 31.9973, lon: -102.0779 },
  { id: "sweetwater", name: "Sweetwater", lat: 32.471, lon: -100.4059 },
  { id: "dallas", name: "Dallas", lat: 32.7767, lon: -96.797 },
  { id: "austin", name: "Austin", lat: 30.2672, lon: -97.7431 },
  { id: "san_antonio", name: "San Antonio", lat: 29.4241, lon: -98.4936 },
  { id: "houston", name: "Houston", lat: 29.7604, lon: -95.3698 },
  { id: "corpus_christi", name: "Corpus Christi", lat: 27.8006, lon: -97.3964 },
];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

function localLabel(ms) {
  const d = new Date(ms - 6 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00 CST`;
}
function skyTime(localHour) {
  const h = localHour;
  if (h >= 8 && h <= 16) return 0;
  if (h > 16 && h < 18) return 0.5 * ((h - 16) / 2);
  if (h >= 18 && h < 21) return 0.5 + 0.5 * ((h - 18) / 3);
  if (h >= 21 || h <= 5) return 1;
  return 1 - (h - 5) / 3; // 05..08
}

// Shared weather (same storm for both runs).
function weather() {
  const rand = mulberry32(42);
  const frames = [];
  const acc = Object.fromEntries(REGIONS.map((r) => [r.id, 0]));
  for (let h = 0; h < HOURS; h++) {
    const localHour = (h % 24 + 24) % 24; // START is local midnight
    const diurnal = -Math.cos(((localHour - 15) / 24) * 2 * Math.PI); // max ~15:00
    const regions = {};
    for (const r of REGIONS) {
      // Front travels NW -> SE.
      const d = ((-r.lon - 93) / 14) * 0.5 + ((r.lat - 25.5) / 11.5) * 0.5; // 0 = SE, 1 = NW
      const arrive = 20 + 40 * (0.75 - d);
      const north = clamp((r.lat - 27.5) / 6, 0, 1);
      const pre = 9 + 4 * (1 - north) + 4 * diurnal;
      const deep = -7 - 10 * north + 2 * diurnal;
      const recover = smooth(132, 176, h);
      const cold = smooth(arrive, arrive + 26, h) * (1 - recover);
      const temp = pre * (1 - cold) + deep * cold + recover * 3 + (rand() - 0.5) * 0.6;
      const snowing = h > arrive + 3 && h < arrive + 3 + 30 + 10 * north && temp < 0.5;
      const snow = snowing ? r1((0.15 + 0.5 * north) * (0.6 + rand() * 0.8)) : 0;
      acc[r.id] = Math.max(0, acc[r.id] + snow - (temp > 1 ? 0.25 : 0.01));
      const wind = 3 + 6 * smooth(arrive - 4, arrive + 2, h) * (1 - smooth(arrive + 20, arrive + 40, h)) + rand() * 2;
      regions[r.id] = { temp_c: r1(temp), snow_cm: snow, wind_ms: r1(wind) };
    }
    const temps = Object.values(regions).map((x) => x.temp_c);
    const meanT = temps.reduce((a, b) => a + b, 0) / temps.length;
    const meanAcc = Object.values(acc).reduce((a, b) => a + b, 0) / REGIONS.length;
    frames.push({ h, localHour, regions, meanT, meanAcc });
  }
  return frames;
}

// City-zone rotation per REPLAY_FORMAT mapping rules.
const ZONE_ORDER = [3, 11, 7, 15, 1, 9, 5, 13, 2, 10, 6, 14, 4, 12, 8, 16];
function zonesFor(h, shedFrac, collapsed, protectGas) {
  const z = {};
  for (let i = 1; i <= 16; i++) z[`zone_${String(i).padStart(2, "0")}`] = 1;
  if (collapsed) {
    for (const k of Object.keys(z)) z[k] = 0;
    z.zone_crit = 0.3;
    z.zone_gas = 0;
    return z;
  }
  const nDark = Math.round(shedFrac * 16);
  const off = Math.floor(h / 2);
  for (let i = 0; i < nDark; i++) {
    const id = ZONE_ORDER[(off + i) % 16];
    z[`zone_${String(id).padStart(2, "0")}`] = 0;
  }
  z.zone_crit = 1;
  z.zone_gas = shedFrac > 0 && !protectGas ? 0 : 1;
  return z;
}

function run({ label, runId, harnessGen, shedLead, collapseHour, protectGas, events: scripted }) {
  const W = weather();
  const rand = mulberry32(7 + harnessGen);
  const frames = [];
  let collapsed = false;
  let maxSupply = 0;
  const raw = [];
  for (const w of W) {
    const h = w.h;
    const coldness = clamp((8 - w.meanT) / 20, 0, 1.2);
    const demand = 46000 + 26000 * coldness + 3500 * Math.sin(((w.localHour - 7) / 24) * 2 * Math.PI) + (rand() - 0.5) * 600;
    // Gas wells freeze off; protected gas facilities lose less.
    const freeze = smooth(34, 58, h) * (1 - smooth(120, 160, h));
    const gasSupply = clamp(1 - freeze * (protectGas ? 0.25 : 0.45) - (rand() - 0.5) * 0.01, 0, 1);
    const fuel = {
      gas: r3(clamp(0.93 * gasSupply - freeze * 0.06, 0, 1)),
      coal: r3(clamp(0.95 - freeze * 0.25, 0, 1)),
      nuclear: r3(h >= 54 && h < 150 ? 0.74 : 1.0),
      wind: r3(clamp(0.34 - smooth(30, 50, h) * 0.24 * (1 - smooth(130, 170, h)), 0, 1)),
      solar: r3(w.localHour >= 8 && w.localHour <= 17 ? 0.15 * Math.sin(((w.localHour - 7) / 11) * Math.PI) : 0),
    };
    const supplyCap = 55000 * fuel.gas + 13500 * fuel.coal + 5100 * fuel.nuclear + 25000 * fuel.wind + 4000 * fuel.solar + 2500;
    raw.push({ w, demand, supplyCap, gasSupply, fuel });
    maxSupply = Math.max(maxSupply, supplyCap);
  }

  let homesDarkHours = 0;
  let peakHomesDark = 0;
  let minFreq = 60;
  let prevShed = 0;
  for (const { w, demand, supplyCap, gasSupply, fuel } of raw) {
    const h = w.h;
    if (collapseHour != null && h >= collapseHour) collapsed = true;
    const gap = demand - supplyCap; // MW short before shedding
    let shed = 0;
    if (!collapsed && gap > -2500) {
      // Operator sheds when the reserve gets thin. shedLead > 0 = acts earlier, keeps a reserve.
      const start = 53 - shedLead;
      if (h >= start) shed = collapseHour != null ? Math.max(0, gap * 0.8) : Math.max(0, gap + 2300);
    }
    let shedFrac = collapsed ? 1 : clamp(shed / demand, 0, 0.45);
    // Gen 1's automatic emergency shedding the hour before collapse.
    if (collapseHour != null && h === collapseHour - 1) shedFrac = Math.max(shedFrac, 0.31);
    shedFrac = r3(shedFrac);
    const served = demand * (1 - shedFrac);
    const supply = collapsed ? 0 : Math.min(supplyCap, served + 1500);
    const reserve = collapsed ? 0 : supply - served;

    let freq = 60 - clamp((served - supplyCap) / 9000, -0.02, 0.6);
    let freqMin = freq - 0.02 - (shedFrac > 0 ? 0.08 : 0);
    let countdown = null;
    if (collapseHour != null) {
      if (h === collapseHour - 2) { freq = 59.52; freqMin = 59.38; countdown = 540; }
      if (h === collapseHour - 1) { freq = 59.33; freqMin = 59.3; countdown = 263; }
    } else if (h === 50) {
      freqMin = 59.56;
    }
    if (collapsed) { freq = 0; freqMin = 0; countdown = null; }
    minFreq = Math.min(minFreq, freqMin);

    const homesDark = Math.round(TOTAL_HOMES * shedFrac);
    homesDarkHours += homesDark;
    peakHomesDark = Math.max(peakHomesDark, homesDark);
    const ms = START + h * 3600e3;
    const evs = (scripted[h] || []).map((e) => ({ ...e }));
    if (!collapsed && shedFrac > 0 && prevShed === 0)
      evs.push({ type: "shed_start", text: collapseHour != null ? "Rolling outages begin, but too few" : "Controlled rolling outages begin. Gas facilities stay powered." });
    if (!collapsed && shedFrac === 0 && prevShed > 0) evs.push({ type: "shed_end", text: "Rolling outages end. Every home has power again." });
    prevShed = shedFrac;
    if (collapseHour != null && h === collapseHour) evs.push({ type: "collapse", text: "The whole grid shut down" });
    frames.push({
      h,
      t: new Date(ms).toISOString().replace(".000Z", "Z"),
      local: localLabel(ms),
      freq_hz: r2(freq),
      freq_min_hz: r2(freqMin),
      countdown_s: countdown,
      demand_mw: Math.round(demand),
      supply_mw: Math.round(supply),
      reserve_mw: Math.round(reserve),
      shed_mw: Math.round(demand * shedFrac),
      shed_frac: shedFrac,
      homes_dark: homesDark,
      fuel_avail_frac: collapsed ? { gas: 0, coal: 0, nuclear: 0, wind: 0, solar: 0 } : fuel,
      gas_supply_frac: r3(gasSupply),
      regions: w.regions,
      zones: zonesFor(h, shedFrac, collapsed, protectGas),
      turbines_running: collapsed ? 0 : r3(clamp(fuel.wind / 0.34, 0, 1)),
      gas_plant_on: collapsed ? 0 : r3(gasSupply),
      line_glow: r3(supply / maxSupply),
      snow_amount: r3(clamp(w.meanAcc / 10, 0, 1)),
      frost_amount: r3(clamp(-w.meanT / 10, 0, 1)),
      sky_time: skyTime(w.localHour),
      events: evs,
    });
  }
  return {
    format: "437-replay/1",
    meta: {
      run_id: runId,
      label,
      scenario_id: "mock_freeze_01",
      scenario_public: "Mock storm (dev data)",
      is_locked_test: false,
      harness: { id: `h_mock_${harnessGen}`, generation: harnessGen, hash: "sha256:mock" },
      model: { operator: "Qwen/Qwen3-30B-A3B-Instruct-2507", weights_frozen: true, fine_tune_runs: 0 },
      seed: 7,
      fleet_year: 2021,
      start_utc: new Date(START).toISOString().replace(".000Z", "Z"),
      hours: HOURS,
      regions: REGIONS,
      collapsed: collapseHour != null,
      collapse_hour: collapseHour,
      totals: { homes_dark_hours: homesDarkHours, peak_homes_dark: peakHomesDark, min_freq_hz: r2(minFreq) },
      mock: true,
    },
    frames,
  };
}

const gen1 = run({
  label: "Gen 1 manual",
  runId: "mock_gen1",
  harnessGen: 1,
  shedLead: 0,
  collapseHour: 61,
  protectGas: false,
  events: {
    30: [{ type: "llm_call", text: "Operator asked about the cold front" }],
    41: [{ type: "false_all_clear", text: "Operator said supply looks fine. Gas wells were already freezing." }],
    46: [{ type: "trip", text: "Power plants are freezing and shutting down" }],
    57: [{ type: "trip", text: "A nuclear unit shuts down in the cold" }],
    60: [{ type: "ufls", text: "Automatic emergency outages switch on" }],
  },
});

const gen11 = run({
  label: "Gen 11 manual",
  runId: "mock_gen11",
  harnessGen: 11,
  shedLead: 3,
  collapseHour: null,
  protectGas: true,
  events: {
    6: [{ type: "build", text: "Before the season: winterized gas wells and plants" }],
    31: [{ type: "sensor_alert", text: "New sensor: gas wells in West Texas at risk of freezing" }],
    44: [{ type: "recall", text: "Recalled from MongoDB: 2011 lesson → starts controlled rotation 3 h earlier", ref: "page_007" }],
    57: [{ type: "trip", text: "A nuclear unit shuts down in the cold" }],
  },
});

for (const [name, doc] of [["mock_gen1.json", gen1], ["mock_gen11.json", gen11]]) {
  const s = JSON.stringify(doc);
  writeFileSync(join(OUT, name), s);
  console.log(name, (s.length / 1024).toFixed(0) + " KB", "peak dark", doc.meta.totals.peak_homes_dark, "min Hz", doc.meta.totals.min_freq_hz);
}
