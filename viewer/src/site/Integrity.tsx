import { useState } from "react";
import { useSite } from "./data";
import { Section, SectionHead } from "./ui";
import { VaultProbe } from "./Records";

export function Integrity() {
  const data = useSite((s) => s.data)!;
  const h = data.honesty;
  const [files, setFiles] = useState(false);
  const denied = h.atlas.filter((r) => /denied/i.test(r.detail));
  return (
    <Section id="integrity">
      <SectionHead id="integrity" n="08" kicker="Integrity" title="What keeps the results honest">
        The agent cannot read or write the exam vault, the simulator is fingerprinted, and the notebooks were hashed when they were frozen. These are the recorded checks.
      </SectionHead>
      <div className="s-int-grid">
        <div className="s-int-block">
          <h3 className="s-h3">MongoDB Atlas permission check</h3>
          <p className="s-small s-dim">
            Run {h.atlasAt?.replace("T", " ") ?? "–"}. {denied.length} of {h.atlas.length} checks are attempts that must be refused; all were refused by the server.
          </p>
          <table className="s-table s-table-sm">
            <thead>
              <tr>
                <th>Check</th>
                <th>Server answer</th>
                <th className="r">Result</th>
              </tr>
            </thead>
            <tbody>
              {h.atlas.map((r, i) => (
                <tr key={i} className={/denied/i.test(r.detail) ? "s-row-key" : ""}>
                  <td>{r.check}</td>
                  <td>
                    <code className={/denied/i.test(r.detail) ? "s-code-deny" : ""}>{r.detail}</code>
                  </td>
                  <td className={`r ${r.status === "PASS" ? "s-acc-t" : r.status === "FAIL" ? "s-bad-t" : "s-dim"}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <VaultProbe />
          <p className="s-caption">
            <code>harness_rw</code> is the database user the learning loop runs as; <code>evaluator</code> is the separate user that writes exam results. Code 13 is
            MongoDB's “Unauthorized”.
          </p>
        </div>
        <div className="s-int-block">
          <h3 className="s-h3">Simulator fingerprint</h3>
          <code className="s-hash">{h.simHash ?? "–"}</code>
          <p className="s-small s-dim">
            SHA-256 over {h.simFiles.length} simulator files, locked before learning started.{" "}
            {h.simFiles.length > 0 && (
              <button className="s-link" onClick={() => setFiles(!files)} aria-expanded={files}>
                {files ? "Hide files" : "Show files"}
              </button>
            )}
          </p>
          {files && (
            <ul className="s-files">
              {h.simFiles.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          )}

          <h3 className="s-h3 s-mt">Frozen notebooks</h3>
          <p className="s-small s-dim">Frozen {h.frozenAt?.replace("T", " ") ?? "–"}; the locked exam refuses to run twice for the same hashes.</p>
          <table className="s-table s-table-sm">
            <thead>
              <tr>
                <th>Track</th>
                <th>Hash</th>
                <th className="r">Nights incl. Night 0</th>
                <th className="r">Habits · limits · prep</th>
              </tr>
            </thead>
            <tbody>
              {data.trackKeys.map((k) => {
                const f = data.tracks[k].frozen;
                return (
                  <tr key={k}>
                    <td>Track {k}</td>
                    <td>
                      <code>{f?.hash ?? "–"}</code>
                    </td>
                    <td className="r num">{f?.generationsRun ?? "–"}</td>
                    <td className="r num">
                      {f ? `${f.counts.habits ?? 0} · ${f.counts.hard_limits ?? 0} · ${f.counts.build_items ?? 0}` : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="s-h3 s-mt">What the AI is never shown</h3>
          <ul className="s-plain">
            <li>Storm names, dates and places: every storm reaches the AI anonymised (the replays label them only “Unseen storm”).</li>
            <li>The 8 unseen storms and the 2021 exam are never used for learning; the coach only sees its training storms' failures.</li>
            <li>Its own weights: the model is frozen; only the notebook changes.</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}
