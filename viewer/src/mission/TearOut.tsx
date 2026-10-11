// "Tear out a page": ablations from baselines.llm ("a2:<notebook> (full)" vs "a2:minus <organ> <id> (<name>)").
// Every number is read from the bundle.
import { fmtBig } from "./plain";
import { useMission } from "./store";
import type { LlmBaseline } from "./types";

const PLAIN_NAMES: Record<string, string> = {
  restore: "bring homes back each hour",
  "protect gas": "keep gas facilities powered",
  build: "winter prep",
};

const ORGAN_WORD: Record<string, string> = { habit: "habit", "hard limit": "hard limit", guardrail: "hard limit", gauge: "gauge", alarm: "alarm", build: "winter prep" };

function stats(b: LlmBaseline): { passed: number | null; hh: number | null } {
  const seeds = Object.values(b.by_seed);
  const hhs = seeds.map((s) => s.homes_dark_hours).filter((v): v is number => typeof v === "number").sort((a, c) => a - c);
  const hh = hhs.length ? hhs[Math.floor((hhs.length - 1) / 2)] : null;
  const passed = b.majority_passed ?? (seeds.length === 1 ? (seeds[0].passed ?? null) : null);
  return { passed, hh };
}

function describe(key: string): { what: string; organ: string } {
  // "a2:minus habit r1_2 (restore)" | "a2:minus hard limit g1_3 (protect gas)" | "a2:minus build"
  const body = key.replace(/^[^:]*:\s*minus\s+/i, "");
  const paren = /\(([^)]+)\)\s*$/.exec(body)?.[1]?.trim();
  const organ = Object.keys(ORGAN_WORD).find((w) => body.toLowerCase().startsWith(w)) ?? body.split(/\s+/)[0];
  const name = paren ? (PLAIN_NAMES[paren.toLowerCase()] ?? paren) : (PLAIN_NAMES[organ] ?? body);
  return { what: name, organ: ORGAN_WORD[organ] ?? organ };
}

const NO_BASELINES: Record<string, LlmBaseline> = {};

const pagePhrase = (d: { what: string; organ: string }) => (d.organ === d.what ? `the ${d.what}` : `the ${d.organ} “${d.what}”`);

export function TearOut() {
  const llm = useMission((s) => s.mission?.baselines.llm ?? NO_BASELINES);
  const keys = Object.keys(llm);
  const fullKey = keys.find((k) => /\(full\)\s*$/i.test(k));
  if (!fullKey) return null;
  const prefix = fullKey.split(":")[0];
  const full = stats(llm[fullKey]);
  const minus = keys
    .filter((k) => k.startsWith(prefix + ":") && /:\s*minus\s/i.test(k))
    .map((k) => ({ k, s: stats(llm[k]), d: describe(k) }))
    .map((x) => ({ ...x, ratio: full.hh && x.s.hh ? x.s.hh / full.hh : null }));
  if (!minus.length) return null;
  const hero = minus.find((x) => /restore/i.test(x.k)) ?? [...minus].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  const rest = minus.filter((x) => x !== hero);
  const notebook = fullKey.replace(/^[^:]*:\s*/, "").replace(/\s*\(full\)\s*$/i, "");
  return (
    <section className="mc-panel mc-tearout">
      <header className="mc-panel-head">
        <div className="mc-panel-title">✂️ Tear out a page</div>
        <div className="mc-panel-right mc-dim">does every page earn its place?</div>
      </header>
      <div className="mc-panel-body">
        <div className="mc-tear-lead">
          Remove <b>{pagePhrase(hero.d)}</b> from a finished notebook ({notebook}):
        </div>
        <div className="mc-tear-big">
          <span>
            <b>{full.passed ?? "?"}</b>/8 → <b className="mc-bad">{hero.s.passed ?? "?"}</b>/8 <small>unseen storms</small>
          </span>
          {hero.ratio != null && (
            <span>
              homes in the dark <b className="mc-bad">{hero.ratio.toFixed(1)}×</b>
            </span>
          )}
        </div>
        <div className="mc-tear-sub mc-dim">
          {fmtBig(full.hh)} → {fmtBig(hero.s.hh)} home-hours dark
        </div>
        {rest.length > 0 && (
          <div className="mc-tear-rest">
            {rest.map((x) => (
              <div key={x.k} className="mc-tear-row">
                <span>without {pagePhrase(x.d)}</span>
                <span>
                  {full.passed ?? "?"}/8 → {x.s.passed ?? "?"}/8
                  {x.ratio != null && <span className={x.ratio > 1.05 ? "mc-bad" : "mc-dim"}> · {x.ratio.toFixed(1)}× dark</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
