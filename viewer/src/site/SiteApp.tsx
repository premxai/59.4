// Evidence site (?mode=site): one quiet scrolling page; each section answers one question with the
// real exported data (viewer/public/mission/594_mission.json + the showcase replays).
import { useEffect, useState } from "react";
import { useSite } from "./data";
import { Hero } from "./Hero";
import { HowItWorks, SameAI } from "./SameAI";
import { RecordDrawer } from "./Records";
import { LearningCurve } from "./LearningCurve";
import { HarnessVersions } from "./HarnessVersions";
import { FailureTrace } from "./FailureTrace";
import { Learned } from "./Learned";
import { HeadToHead } from "./HeadToHead";
import { CoachRsi } from "./CoachRsi";
import { RaindropNight } from "./RaindropNight";
import { Exam } from "./Exam";
import { Integrity } from "./Integrity";
import "./site.css";

export const SECTIONS = [
  { id: "same", label: "Same AI" },
  { id: "curve", label: "Curve" },
  { id: "versions", label: "Versions" },
  { id: "failure", label: "Failure" },
  { id: "learned", label: "Learned" },
  { id: "h2h", label: "v1 vs final" },
  { id: "coach", label: "Coach" },
  { id: "raindrop", label: "Raindrop" },
  { id: "exam", label: "2021 exam" },
  { id: "integrity", label: "Integrity" },
];

function useFonts() {
  useEffect(() => {
    if (document.getElementById("site-fonts")) return;
    const pre = document.createElement("link");
    pre.rel = "preconnect";
    pre.href = "https://fonts.gstatic.com";
    pre.crossOrigin = "";
    const l = document.createElement("link");
    l.id = "site-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.append(pre, l);
  }, []);
}

function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const line = window.innerHeight * 0.3;
      let cur: string | null = null;
      for (const id of key.split("|")) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      setActive(cur);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    const t = setInterval(measure, 1500); // sections mount after the data arrives
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      clearInterval(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);
  return active;
}

function Nav() {
  const data = useSite((s) => s.data);
  const track = useSite((s) => s.track);
  const theme = useSite((s) => s.theme);
  const active = useScrollSpy(SECTIONS.map((s) => s.id));
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`s-nav ${scrolled ? "s-nav-scrolled" : ""}`}>
      <div className="s-nav-in">
        <a className="s-wordmark" href="#top" aria-label="59.4, back to top">
          59.4
        </a>
        <nav className="s-nav-links" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={active === s.id ? "on" : ""} aria-current={active === s.id ? "true" : undefined}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="s-nav-right">
          {data && data.trackKeys.length > 1 && (
            <div className="s-seg" role="group" aria-label="Track">
              {data.trackKeys.map((k) => (
                <button key={k} className={k === track ? "on" : ""} aria-pressed={k === track} onClick={() => useSite.getState().setTrack(k)} title={k === "A" ? "Track A: the coach may change only in-storm behaviour" : "Track B: the coach may change everything, incl. winter prep"}>
                  Track {k}
                </button>
              ))}
            </div>
          )}
          <button className="s-icon-btn" onClick={() => useSite.getState().setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Theme">
            {theme === "light" ? (
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <a className="s-nav-out" href="?mode=stage">
            Stage
          </a>
          <a className="s-nav-out" href="?mode=mission">
            Mission Control
          </a>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const data = useSite((s) => s.data);
  return (
    <footer className="s-footer">
      <div className="s-wrap s-footer-in">
        <div>
          <div className="s-kicker">How it works</div>
          <ol className="s-how">
            <li>A frozen model runs the Texas grid through a winter storm in a locked simulator, following a notebook of habits, limits, gauges and winter prep.</li>
            <li>Each night a coach reads the failed storms, proposes edits to the notebook, and tests each one against the current version.</li>
            <li>Only edits that help without gaming the test are kept; each kept edit writes a lesson page to MongoDB.</li>
            <li>Every two nights the coach reviews its own predictions and A/B-tests a rewrite of its coaching strategy.</li>
          </ol>
        </div>
        <div className="s-footer-links">
          <a href="?mode=stage">Stage →</a>
          <a href="?mode=mission">Mission Control →</a>
          <a href="#top">Back to top ↑</a>
          {data?.generatedAt && <span className="s-dim">Data exported {data.generatedAt.replace("T", " ")}</span>}
        </div>
      </div>
    </footer>
  );
}

export default function SiteApp() {
  const data = useSite((s) => s.data);
  const error = useSite((s) => s.error);
  const theme = useSite((s) => s.theme);
  useFonts();
  useEffect(() => {
    document.documentElement.classList.add("site-mode");
    document.title = "59.4 · Evidence";
    useSite.getState().load();
    // the bundle is regenerated while the locked exam runs: pick up a new export quietly
    const id = setInterval(() => useSite.getState().load(true), 60_000);
    return () => {
      clearInterval(id);
      document.documentElement.classList.remove("site-mode");
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.siteTheme = theme;
  }, [theme]);
  return (
    <div className={`site site-${theme}`} id="top">
      <a className="s-skip" href="#same">
        Skip to the first chart
      </a>
      <Nav />
      {!data ? (
        <div className="s-loading">{error ? `Could not load the data file: ${error}` : "Loading the evidence…"}</div>
      ) : (
        <main>
          <Hero />
          <HowItWorks />
          <SameAI />
          <LearningCurve />
          <HarnessVersions />
          <FailureTrace />
          <Learned />
          <HeadToHead />
          <CoachRsi />
          <RaindropNight />
          <Exam />
          <Integrity />
        </main>
      )}
      <Footer />
      <RecordDrawer />
    </div>
  );
}
