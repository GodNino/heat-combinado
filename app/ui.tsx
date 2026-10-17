"use client";
// The small pieces every screen uses. They live here rather than in page.tsx so a screen
// can be its own file without importing the page back — which would be a circular import.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  const box = useRef<HTMLParagraphElement>(null);
  // The message that has been put away. A saved message puts itself away after about 3 seconds
  // (the fade is in globals.css); an error stays until it is tapped.
  const [gone, setGone] = useState("");
  useEffect(() => {
    if (!text) setGone("");
  }, [text]);
  useEffect(() => {
    if (!text || error) return;
    const id = window.setTimeout(() => setGone(text), 3300);
    return () => window.clearTimeout(id);
  }, [text, error]);
  return text && gone !== text ? (
    <p
      ref={box}
      role={error ? "alert" : "status"}
      className={`notice ${error ? "bad" : "good"}`}
      onClick={error ? () => setGone(text) : undefined}
    >
      <span className="notice-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d={error ? "M18 6 6 18M6 6l12 12" : "M20 6 9 17l-5-5"} /></svg>
      </span>
      {text}
    </p>
  ) : null;
}

// The small (i) beside a label. What it explains stays hidden until it is tapped.
export function InfoButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="count-info-btn" style={{ width: 24, height: 24, flexShrink: 0 }} aria-label="What is this?" title="What is this?" aria-expanded={open} onClick={onClick}>
      <span className="count-info-i" aria-hidden="true">i</span>
    </button>
  );
}

// A line of content (a label, a tick-box sentence) with an (i) after it that opens a short note below.
export function InfoRow({ info, className, children }: { info: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <div className="flex items-center gap-2">{children}<InfoButton open={open} onClick={() => setOpen(value => !value)} /></div>
      {open ? <p className="count-info-text">{info}</p> : null}
    </div>
  );
}

export function Field({
  label,
  info,
  children,
}: {
  label: string;
  // A short explanation, kept behind an (i) beside the label.
  info?: ReactNode;
  children: ReactElement<{ id?: string }>;
}) {
  return (
    <div className="field">
      {info
        ? <InfoRow info={info} className="mb-2"><label htmlFor={children.props.id} style={{ margin: 0 }}>{label}</label></InfoRow>
        : <label htmlFor={children.props.id}>{label}</label>}
      {children}
    </div>
  );
}

// The top of a screen: what kind of screen it is, what it is called, what it is for, and
// the one action it offers. Written once so the library, the allergy check and the words
// tab cannot drift apart again — they each used to spell this out in their own markup.
// `quiet` keeps the header for screen readers while hiding it, which the library does for
// employees: they get the same screen without the manager framing around it.
export function ScreenHeader({
  eyebrow,
  title,
  description,
  info,
  action,
  quiet = false,
  inlineAction = false,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  // Explanatory text that hides behind a small "i" beside the title, instead of sitting
  // open under it. Give this or description, not both.
  info?: ReactNode;
  action?: ReactNode;
  quiet?: boolean;
  // A wide labelled button cannot sit beside the title on a phone, so it drops below it.
  // A small icon always fits, and belongs on the right where it has always been.
  inlineAction?: boolean;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className={quiet ? "sr-only" : `mb-5 flex items-start justify-between gap-5${inlineAction ? "" : " flex-wrap"}`}>
      <div className={inlineAction ? "min-w-0" : undefined}>
        <p className="eyebrow muted mb-3">{eyebrow}</p>
        {info ? (
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            <button type="button" className="count-info-btn" aria-label="What is this screen for?" title="What is this screen for?" aria-expanded={infoOpen} onClick={() => setInfoOpen(value => !value)}>
              <span className="count-info-i" aria-hidden="true">i</span>
            </button>
          </div>
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        )}
        {info && infoOpen ? <p className="count-info-text" style={{ marginBottom: 16 }}>{info}</p> : null}
        {description ? <p className="muted mt-3">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// A small "i" button that shows the counting rules once, instead of repeating
// the same fine print under every set of numbers.
export function CountInfo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="count-info">
      <button type="button" className="count-info-btn" aria-label="How this is counted" title="How this is counted" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="count-info-i" aria-hidden="true">i</span>
      </button>
      {open ? <p className="count-info-text">{children}</p> : null}
    </div>
  );
}

// A small section heading with its explanation hidden behind an "i" beside it.
export function SectionInfo({ heading, headingClassName = "eyebrow muted", children }: { heading: ReactNode; headingClassName?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className={headingClassName}>{heading}</h2>
        <button type="button" className="count-info-btn" aria-label="What is this?" title="What is this?" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span className="count-info-i" aria-hidden="true">i</span>
        </button>
      </div>
      {open ? <p className="count-info-text">{children}</p> : null}
    </div>
  );
}

// The ring used for progress on Home: a thin track, a round-ended arc and the percent in the middle.
// Sizes and colors live in globals.css (.progress-ring).
export function ProgressRing({percent, label}: {percent: number; label: string}) {
  const done = Math.max(0, Math.min(100, percent));
  return <div className="progress-ring" role="img" aria-label={label}><svg viewBox="0 0 46 46" aria-hidden="true"><circle className="progress-ring-track" cx="23" cy="23" r="19"/>{done > 0 && <circle className="progress-ring-arc" cx="23" cy="23" r="19" strokeDasharray={119.38} strokeDashoffset={119.38 * (1 - done / 100)}/>}</svg><span aria-hidden="true">{Math.round(percent)}%</span></div>;
}
