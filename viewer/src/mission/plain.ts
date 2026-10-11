// Plain-language layer: everything a judge reads on the main screen goes through here.
// Technical strings (expressions, ids, hashes) only appear in the inspector.
import type { Counts, Edit, EditOp, NightStep, Track } from "./types";

// ------------------------------------------------------------------ organs
export interface OrganMeta {
  key: string;
  label: string;
  icon: string;
  color: string;
  blurb: string;
}

export const ORGANS: OrganMeta[] = [
  { key: "habit", label: "Habits", icon: "📘", color: "#ffb35c", blurb: "what to do when trouble starts" },
  { key: "hard_limit", label: "Hard limits", icon: "🛡️", color: "#ff7a6b", blurb: "lines the AI may never cross" },
  { key: "gauge_alarm", label: "Gauges & alarms", icon: "👀", color: "#8fd0ff", blurb: "what it measures, when it wakes the AI" },
  { key: "briefing_memory", label: "What the AI sees & remembers", icon: "🧠", color: "#c9a6ff", blurb: "its briefing + lesson pages from MongoDB" },
  { key: "authority", label: "What the AI decides", icon: "🤖", color: "#7dffb2", blurb: "which levers are the AI's own call" },
  { key: "build", label: "Winter prep", icon: "🧰", color: "#ffd86b", blurb: "equipment readied before winter" },
];

export function organMeta(key: string | null | undefined): OrganMeta {
  return ORGANS.find((o) => o.key === key) ?? { key: key ?? "other", label: humanize(key ?? "other"), icon: "📄", color: "#9fb0d8", blurb: "" };
}

/** One short line describing how big this part of the notebook is. */
export function organSummary(key: string, c: Counts): string {
  const n = (k: keyof Counts) => c[k] ?? 0;
  switch (key) {
    case "habit":
      return plural(n("habits"), "habit");
    case "hard_limit":
      return plural(n("hard_limits"), "hard limit");
    case "gauge_alarm":
      return `${plural(n("gauges"), "gauge")} · ${plural(n("alarms"), "alarm")}`;
    case "briefing_memory":
      return `sees ${n("briefing_items")} things${n("forecast") ? " + forecast" : ""} · recalls ${plural(n("memory_pages_shown"), "page")}`;
    case "authority":
      return `decides ${plural(n("ai_decides"), "lever")} · asked every ${n("ask_ai_every_h") || 1} h`;
    case "build":
      return plural(n("build_items"), "prep item");
    default:
      return "";
  }
}

/** Number of "items" in an organ, used to draw the little item dots. */
export function organSize(key: string, c: Counts): number {
  const n = (k: keyof Counts) => c[k] ?? 0;
  switch (key) {
    case "habit":
      return n("habits");
    case "hard_limit":
      return n("hard_limits");
    case "gauge_alarm":
      return n("gauges") + n("alarms");
    case "briefing_memory":
      return n("briefing_items") + n("memory_pages_shown");
    case "authority":
      return n("ai_decides");
    case "build":
      return n("build_items");
    default:
      return 0;
  }
}

// ------------------------------------------------------------------ edit outcome
export function isKept(e: Edit): boolean {
  return e.status === "accepted" || e.status === "stacked";
}

/** Short reason tag for a rejected idea. */
export function reasonTag(e: Edit): string {
  const k = (e.reason_kind ?? "").toLowerCase();
  const r = (e.reason ?? "").toLowerCase();
  if (k.includes("calm") || /calm day/.test(r)) return "kept homes dark on a calm day";
  if (k.includes("memor") || /memori[sz]/.test(r)) return "memorized storm timing";
  if (k.includes("gaming")) return "tried to game the test";
  if (k.includes("regress") || k.includes("worse") || k.includes("broke") || /worse|broke/.test(r)) return "made another storm worse";
  if (k === "redundant") return "nothing extra on top of tonight's kept idea";
  if (k.includes("dup") || /duplicate/.test(r)) return "duplicate";
  if (k.includes("invalid") || /invalid/.test(r)) return "broken edit";
  if (k.includes("insufficient") || /enough/.test(r)) return "didn't help enough";
  if (e.status === "inconclusive") return "test was inconclusive";
  if (e.reason) return e.reason.length > 46 ? e.reason.slice(0, 44) + "…" : e.reason;
  return "rejected";
}

export function statusWord(e: Edit): string {
  switch (e.status) {
    case "accepted":
      return "Kept";
    case "stacked":
      return "Stacked on top";
    case "rejected":
      return "Rejected";
    case "inconclusive":
      return "Inconclusive";
    default:
      return humanize(e.status);
  }
}

// ------------------------------------------------------------------ numbers
const MINUS = "−";

export function fmtBig(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function fmtBigWords(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)} billion`;
  if (a >= 1e6) return `${Math.round(n / 1e6)} million`;
  return Math.round(n).toLocaleString("en-US");
}

/** -46.5 -> "−47%" ; 9.4 -> "+9%" */
export function fmtPct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return "–";
  const v = Number(p.toFixed(digits));
  if (v === 0) return "0%";
  return `${v < 0 ? MINUS : "+"}${Math.abs(v).toFixed(digits)}%`;
}

/** Plain sentence for a % change in homes dark (negative = better). */
export function darkPhrase(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "effect unknown";
  const v = Math.round(Math.abs(p));
  if (v === 0) return "no change in homes in the dark";
  return p < 0 ? `${v}% fewer homes in the dark` : `${v}% more homes in the dark`;
}

export function storms(n: number | null | undefined): string {
  if (n == null) return "";
  return `${n >= 0 ? "+" : MINUS}${Math.abs(n)} storm${Math.abs(n) === 1 ? "" : "s"}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export type Tick = "pass" | "fail" | "unknown";

export function parseTicks(s: string | null | undefined): Tick[] {
  if (!s) return [];
  return [...s].map((c) => (c === "✓" || c === "✔" || c === "1" ? "pass" : c === "✗" || c === "✘" || c === "x" || c === "0" ? "fail" : "unknown"));
}

// ------------------------------------------------------------------ storms
const STORM_WORDS: Record<string, string> = {
  flash: "Flash freeze",
  ice: "Ice storm",
  surge: "Demand surge",
  west_gas: "West gas freeze",
  late_march: "Late-March cold",
  late_feb: "Late-Feb cold",
  south_flash: "South flash freeze",
  coast: "Coastal freeze",
  long_freeze: "Long freeze",
  feb: "February cold",
  freeze: "Freeze",
  judge: "Judge's storm",
};

export function stormName(id: string | null | undefined): { name: string; year: string } {
  if (!id) return { name: "Storm", year: "" };
  let s = id.replace(/^(heldout|train|syn|dev|judge|locked)_/, "");
  const m = /_(\d{4})(?:_.*)?$/.exec(s);
  const year = m ? m[1] : "";
  if (m) s = s.slice(0, m.index);
  const name = STORM_WORDS[s] ?? humanize(s);
  return { name, year };
}

export function stormLabel(id: string | null | undefined): string {
  const { name, year } = stormName(id);
  return year ? `${name} ${year}` : name;
}

// ------------------------------------------------------------------ notebooks
/** Which night (as the coach names it) belongs to generation g: from the night's own text, else g (night 0 = zero-shot). */
export function nightNumber(t: Track, g: number): number {
  const steps = t.nights[g] ?? [];
  for (const s of steps) {
    if (s.type !== "sleep_start") continue;
    const m = /Night\s+(\d+)/i.exec(s.text);
    if (m) return Number(m[1]);
  }
  if (t.edits.some((e) => e.generation === g && e.night0)) return 0;
  return g;
}

/** Plain name of a notebook version (a harness id). */
export function notebookName(t: Track, id: string | null | undefined): string {
  if (!id) return "notebook";
  const node = t.lineage.find((l) => l.id === id);
  if (node && !node.parent_id) return "Day-1 notebook";
  if (node?.born_from && /zero.?shot/i.test(node.born_from)) return "Night 0 draft";
  const e = t.edits.find((x) => x.child_id === id || x.stacked_id === id);
  if (e) return e.night0 ? "Night 0 draft" : `Night ${nightNumber(t, e.generation)} notebook`;
  if (t.generations[0]?.harness_id === id) return "Day-1 notebook";
  if (node?.night != null) return `Night ${node.night} notebook`;
  return "notebook";
}

/** Version label of a notebook: its position in the champion lineage (v1, v2, …). */
export function notebookVersion(t: Track | null | undefined, id: string | null | undefined): string {
  if (!t || !id) return "v?";
  const i = t.lineage.findIndex((l) => l.id === id);
  if (i >= 0) return `v${i + 1}`;
  const g = t.generations.findIndex((x) => x.harness_id === id);
  if (g >= 0) return `v${g + 1}`;
  return "v?";
}

/** Short chip name for the lineage chain. */
export function notebookShort(t: Track, id: string): string {
  const n = notebookName(t, id);
  if (n === "Day-1 notebook") return "v1";
  return n.replace(/ notebook$/, "").replace(/ draft$/, "");
}

// ------------------------------------------------------------------ text cleanup
export function plainText(t: Track | null, s: string): string {
  let out = s
    .replace(/->/g, "→")
    .replace(/\bManual habit\b/g, "Notebook habit")
    .replace(/\bmanuals\b/g, "notebooks")
    .replace(/\bmanual\b/g, "notebook")
    .replace(/\bManual\b/g, "Notebook")
    .replace(/\((1) pages\)/g, "($1 page)")
    .replace(/storm\(s\)/g, "storms")
    .replace(/\s{2,}/g, " ");
  if (t) out = out.replace(/\b[A-Za-z0-9]+-h\d{3}\b/g, (id) => `notebook ${notebookVersion(t, id)}`).replace(/\bnotebook notebook\b/g, "notebook");
  return out.trim();
}

export function humanize(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// ------------------------------------------------------------------ notebook ops in plain words
const VARS: Record<string, string> = {
  demand: "demand",
  supply: "supply",
  reserve: "spare power",
  reserve_margin: "spare power (%)",
  supply_trend: "supply trend",
  supply_drop: "how fast supply is falling",
  cold_ahead: "coldest temperature ahead",
  freq: "grid frequency",
  shed: "homes cut off",
  temp: "temperature",
  battery_soc: "battery charge",
  dr_left: "big-customer cutbacks left",
  fc_min_24: "forecast low (next 24 h)",
  fc_min_48: "forecast low (next 48 h)",
  reserve_gap: "extra cuts actually needed",
  excess_shed: "cuts that could be undone",
};

const LEVERS: Record<string, string> = {
  shed_mw: "how much to cut",
  restore_mw: "how much to bring back",
  rotation_min: "how long each area stays dark",
  protect_gas: "keeping gas sites powered",
  conservation: "asking the public to save power",
  imports_mw: "imports from neighbors",
  dr_mw: "big-customer cutbacks",
  battery_mw: "batteries",
  precommit: "starting extra plants early",
  rt_shed: "letting the control room cut fast",
};

export const plainVar = (v: string) => VARS[v] ?? humanize(v);
export const plainLever = (v: string) => LEVERS[v] ?? humanize(v);

const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : String(x));

function buildPlain(o: Record<string, unknown>): string {
  const parts: string[] = [];
  const wp = o.winterize_plants;
  if (wp && typeof wp === "object") {
    const items = Object.entries(wp as Record<string, unknown>).map(([k, v]) => `${pct(v)} of ${k} plants`);
    if (items.length) parts.push(`winterize ${items.join(", ")}`);
  }
  if (o.winterize_wells != null) parts.push(`winterize ${pct(o.winterize_wells)} of gas wells`);
  if (o.firm_fuel != null) parts.push(`firm fuel contracts for ${pct(o.firm_fuel)}`);
  if (o.critical_load_map === true) parts.push("map gas facilities so blackouts skip them");
  if (typeof o.battery_mw === "number" && o.battery_mw > 0) parts.push(`add a ${o.battery_mw.toLocaleString("en-US")} MW battery yard`);
  return parts.length ? parts.join("; ") : "change winter preparations";
}

export function opPlain(op: EditOp): string {
  const d = typeof op.description === "string" ? op.description : "";
  const name = typeof op.name === "string" ? op.name : "";
  const id = typeof op.id === "string" ? op.id : "";
  switch (op.op) {
    case "add_sensor":
      return `New gauge “${plainVar(name)}”${d ? `: ${d}` : ""}`;
    case "remove_sensor":
      return `Removed gauge “${plainVar(name)}”`;
    case "add_rule":
      return `New habit: ${d || "(no description)"}`;
    case "modify_rule":
      return `Rewrote a habit: ${d || id}`;
    case "remove_rule":
      return `Tore out a habit${d ? `: ${d}` : id ? ` (${id})` : ""}`;
    case "add_guardrail":
      return `New hard limit: ${d || "(no description)"}`;
    case "modify_guardrail":
      return `Rewrote a hard limit: ${d || id}`;
    case "remove_guardrail":
      return `Removed a hard limit${d ? `: ${d}` : ""}`;
    case "set_alert":
    case "add_alert":
      return `Alarm: ${d || "changed when the AI is woken"}`;
    case "set_context": {
      const show = Array.isArray(op.show) ? (op.show as unknown[]).map(String) : [];
      const bits = [show.length ? `the AI's briefing shows ${show.map(plainVar).join(", ")}` : "changed the AI's briefing"];
      if (op.show_forecast === true) bits.push("plus the weather forecast");
      if (typeof op.memory_top_k === "number") bits.push(`recalls ${op.memory_top_k} lesson pages`);
      if (typeof op.recent_hours === "number") bits.push(`remembers the last ${op.recent_hours} h`);
      return humanize(bits.join("; "));
    }
    case "set_authority": {
      const l = Array.isArray(op.llm_decides) ? (op.llm_decides as unknown[]).map(String) : [];
      const all = Object.keys(LEVERS);
      const removed = all.filter((x) => l.length && !l.includes(x));
      return `The AI decides ${l.length ? l.map(plainLever).join(", ") : "nothing"}${removed.length ? ` — the notebook's habits now handle ${removed.map(plainLever).join(", ")}` : ""}`;
    }
    case "set_build":
      return `Winter prep: ${buildPlain(op)}`;
    case "set_memory_policy":
      return `Memory: ${typeof op.max_active_pages === "number" ? `keeps at most ${op.max_active_pages} lesson pages active` : "changed how lesson pages are kept"}`;
    default:
      return d ? `${humanize(op.op)}: ${d}` : humanize(op.op);
  }
}

/** The raw condition/action of an op, for the inspector's technical view. */
export function opTech(op: EditOp): string {
  const rest = Object.entries(op).filter(([k]) => k !== "op" && k !== "description");
  return `${op.op}  ${rest.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join("  ")}`;
}

// ------------------------------------------------------------------ night steps (sidebar)
export type Tone = "day" | "coach" | "idea" | "test" | "keep" | "reject" | "cheat" | "page" | "deep" | "ab" | "good" | "bad" | "info";

export interface StepView {
  icon: string;
  tone: Tone;
  title: string;
  detail?: string;
  ticks?: string;
  tags?: string[];
  edit?: Edit;
}

const IDEA_STEPS = ["proposal", "test", "stack_test", "accept", "stacked", "reject", "reject_gaming", "reject_memorization", "page_written"];

export function editForStep(t: Track, s: NightStep, g: number): Edit | undefined {
  // only steps about an idea; gen_start also carries a harness_id (the notebook of the day), not an idea
  if (!IDEA_STEPS.includes(s.type)) return undefined;
  const vid = typeof s.data.vid === "string" ? s.data.vid : typeof s.data.harness_id === "string" ? s.data.harness_id : null;
  const inGen = t.edits.filter((e) => e.generation === g);
  if (vid) {
    const e = inGen.find((x) => x.child_id === vid || x.stacked_id === vid) ?? t.edits.find((x) => x.child_id === vid || x.stacked_id === vid);
    if (e) return e;
  }
  if (["proposal", "test", "stack_test", "accept", "stacked", "reject", "reject_gaming", "reject_memorization"].includes(s.type))
    return inGen.find((e) => s.text.includes(e.title));
  return undefined;
}

function quoted(s: string): string | undefined {
  const m = /[“"]([^"”]{8,})[”"]/.exec(s);
  return m ? m[1] : undefined;
}

const after = (s: string, sep: string) => {
  const i = s.indexOf(sep);
  return i >= 0 ? s.slice(i + sep.length).trim() : s;
};

export function nightStepView(t: Track, s: NightStep, g: number): StepView {
  const e = editForStep(t, s, g);
  const txt = plainText(t, s.text);
  const organ = e ? organMeta(e.organ) : null;
  switch (s.type) {
    case "gen_start": {
      const hid = typeof s.data.harness_id === "string" ? s.data.harness_id : undefined;
      const gen = t.generations.find((x) => x.generation === g);
      const pages = gen?.pages;
      return {
        icon: "☀️",
        tone: "day",
        title: `Day ${g}: the AI runs the winter's storms`,
        detail: `with notebook ${notebookVersion(t, hid ?? gen?.harness_id)}${pages != null ? ` (${plural(pages, "lesson page")})` : ""}`,
      };
    }
    case "sleep_start":
      return { icon: "🌙", tone: "coach", title: txt.replace(/\s*\(the baseline[^)]*\)/, ""), detail: /baseline/.test(txt) ? "the baseline every learning night must beat" : undefined };
    case "replay": {
      const m = /Replay of ([a-z0-9_]+):\s*/i.exec(s.text);
      const storm = m ? stormLabel(m[1]) : "a failed storm";
      const chain = plainText(t, m ? s.text.slice(m.index + m[0].length) : s.text).replace(/\bh(\d+):\s*/g, "");
      return { icon: "↺", tone: "coach", title: `Coach replays “${storm}” to see what went wrong`, detail: chain };
    }
    case "alarm_flags":
      return { icon: "🚩", tone: "coach", title: "Alarm flags from the storms", detail: txt };
    case "diagnosis":
      return { icon: "🩺", tone: "coach", title: "Coach's diagnosis", detail: txt };
    case "proposal": {
      const expects: string[] = [];
      if (e?.predicted_pct != null) expects.push(darkPhrase(e.predicted_pct));
      if (e?.predicted) expects.push(storms(e.predicted));
      return {
        icon: "💡",
        tone: "idea",
        title: e ? `Idea: ${e.title}` : txt,
        detail: expects.length ? `Coach expects: ${expects.join(", ")}` : undefined,
        tags: [organ ? `${organ.icon} ${organ.label}` : "", e?.redteam ? "red-team test" : ""].filter(Boolean),
        edit: e,
      };
    }
    case "test":
    case "stack_test": {
      const ticks = /[✓✗]{2,}/.exec(s.text)?.[0] ?? e?.ticks;
      const m = /\(([-+−]?\d+(?:\.\d+)?)% (?:homes dark|more change)/.exec(s.text);
      const p = m ? Number(m[1].replace("−", "-")) : null;
      const runs = /on (\d+) storm runs/.exec(s.text)?.[1];
      return {
        icon: "🧪",
        tone: "test",
        title: s.type === "stack_test" ? `Stack test: “${e?.title ?? "idea"}” on top of tonight's keeper` : `Test: “${e?.title ?? "idea"}”${runs ? ` on ${runs} storm runs` : ""}`,
        detail: p != null ? (s.type === "stack_test" ? `${darkPhrase(p)} on top` : `${darkPhrase(p)} on the failed storms`) : undefined,
        ticks,
        edit: e,
      };
    }
    case "accept":
      return { icon: "✅", tone: "keep", title: `Kept: ${e?.title ?? after(txt, "Kept:")}`, detail: e ? `${darkPhrase(e.actual_pct)} on the failed storms${e.actual ? `, ${storms(e.actual)}` : ""}` : undefined, edit: e };
    case "stacked":
      return { icon: "➕", tone: "keep", title: `Stacked on top: ${e?.title ?? after(txt, ":")}`, detail: e ? darkPhrase(e.actual_pct) : undefined, edit: e };
    case "page_written": {
      const title = quoted(s.text) ?? e?.lesson ?? "a lesson";
      return { icon: "✍️", tone: "page", title: `Lesson page saved to MongoDB: “${title}”`, detail: after(after(txt, title), ":").replace(/^[”"]\s*:?\s*/, "") || undefined };
    }
    case "reject":
      return { icon: "🗑️", tone: "reject", title: `Rejected: ${e?.title ?? after(txt, "Rejected:")}`, tags: e ? [reasonTag(e), ...(e.redteam ? ["red-team test"] : [])] : undefined, edit: e };
    case "reject_gaming":
    case "reject_memorization":
      return {
        icon: "🚫",
        tone: "cheat",
        title: `Cheating caught: ${e?.title ?? after(txt, "Rejected:")}`,
        tags: e ? [reasonTag(e), ...(e.redteam ? ["red-team test"] : [])] : [s.type === "reject_gaming" ? "tried to game the test" : "memorized storm timing"],
        edit: e,
      };
    case "no_change":
      return { icon: "⏸️", tone: "info", title: "No idea passed the test tonight", detail: "The notebook stays the same." };
    case "deep_sleep": {
      const q = quoted(s.text);
      const rate = typeof s.data.acceptance_rate === "number" ? s.data.acceptance_rate : null;
      return {
        icon: "🌌",
        tone: "deep",
        title: "Deep sleep: the coach reviews its own track record",
        detail: q ? `“${q}”` : txt,
        tags: rate != null ? [`${Math.round(rate * 100)}% of its ideas kept so far`] : undefined,
      };
    }
    case "ab_test":
      return { icon: "⚖️", tone: "ab", title: "A/B test: does the coach's rewritten playbook predict better?", detail: txt };
    case "strategy_adopted":
      return { icon: "🏅", tone: "good", title: "The coach's rewrite passed its own test: adopted", detail: txt };
    case "strategy_reverted":
      return { icon: "↩️", tone: "bad", title: "The coach rejected its own rewrite: reverted", detail: txt };
    case "deadline":
      return { icon: "⏰", tone: "info", title: txt };
    case "all_passed":
      return { icon: "🏆", tone: "good", title: txt };
    default:
      return { icon: "•", tone: "info", title: txt || humanize(s.type) };
  }
}

// ------------------------------------------------------------------ per-hour storm steps (showcase / live)
export function hourStepIcon(type: string): string {
  switch (type) {
    case "sensor_alert":
      return "👀";
    case "rule_fired":
      return "📘";
    case "memory_recall":
    case "recall":
      return "🧠";
    case "ai_decision":
    case "llm_call":
      return "🤖";
    case "guardrail":
      return "🛡️";
    case "false_all_clear":
      return "🚩";
    case "freeze_off":
    case "icing":
      return "🧊";
    case "shed_start":
    case "shed_end":
      return "🏠";
    case "ufls":
      return "⚡";
    case "collapse":
      return "⬛";
    case "gas_feedback":
      return "🔥";
    case "restore":
      return "🔌";
    case "trip":
      return "🏭";
    case "build":
      return "🧰";
    default:
      return "•";
  }
}

export function hourStepText(type: string, actor: string | undefined, text: string): string {
  let t = text.replace(/^Manual habit:\s*/i, "Habit: ").replace(/^Remembers:\s*/i, "Remembers ");
  if (type === "false_all_clear" && actor !== "raindrop") t = t.replace(/^Raindrop[^:]*:\s*/i, "Alarm: ");
  if (type === "guardrail" && !/^hard limit/i.test(t)) t = t.replace(/^Guardrail:\s*/i, "Hard limit: ");
  return t;
}

// ------------------------------------------------------------------ loop stages
export type StageKey = "day" | "read" | "ideas" | "test" | "decide" | "review" | "ab" | "adopt";

export const STAGES: { key: StageKey; label: string; every2?: boolean }[] = [
  { key: "day", label: "Day" },
  { key: "read", label: "Coach reads failures" },
  { key: "ideas", label: "3 ideas" },
  { key: "test", label: "Test" },
  { key: "decide", label: "Keep / reject" },
  { key: "review", label: "Coach self-review", every2: true },
  { key: "ab", label: "A/B", every2: true },
  { key: "adopt", label: "Adopt / revert", every2: true },
];

export function stageOf(type: string): StageKey {
  switch (type) {
    case "gen_start":
      return "day";
    case "sleep_start":
    case "replay":
    case "alarm_flags":
    case "diagnosis":
      return "read";
    case "proposal":
      return "ideas";
    case "test":
    case "stack_test":
      return "test";
    case "deep_sleep":
      return "review";
    case "ab_test":
      return "ab";
    case "strategy_adopted":
    case "strategy_reverted":
      return "adopt";
    default:
      return "decide";
  }
}
