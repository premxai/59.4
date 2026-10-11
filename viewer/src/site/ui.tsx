import type { ReactNode } from "react";

export function SectionHead({ id, n, kicker, title, children }: { id: string; n: string; kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="s-head">
      <div className="s-kicker">
        <span className="s-kicker-n">{n}</span>
        {kicker}
      </div>
      <h2 className="s-h2" id={`${id}-h`}>
        {title}
      </h2>
      {children && <div className="s-lede">{children}</div>}
    </div>
  );
}

export function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`s-section ${className ?? ""}`} aria-labelledby={`${id}-h`}>
      <div className="s-wrap">{children}</div>
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="s-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} aria-pressed={o.v === value} onClick={() => onChange(o.v)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="s-stat">
      <div className="s-stat-label">{label}</div>
      <div className="s-stat-value">{value}</div>
      {sub && <div className="s-stat-sub">{sub}</div>}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="s-note">{children}</p>;
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const top = el.getBoundingClientRect().top + window.scrollY - 64;
  window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}
