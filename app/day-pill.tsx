"use client";
// A day shown as a small pill ("Today · Mon, Oct 26") with a menu under it: yesterday, today and the next two
// weeks. Used where a date box used to be (Side work, the floor plan, time off). The plain browser date box is a big grey
// field, and Safari on a Mac turns it into typing segments; a menu looks and works the same everywhere.
// choices: a different list of days (time off looks months ahead; long lists get a heading per month).
// blank: adds a first choice with no day, shown with these words ("Same day").
import { ChevronDown } from "lucide-react";
import { dayChoices, dayWords, monthWords } from "@/lib/day-words";

export function DayPill({label, value, onChange, choices, blank}: {label: string; value: string; onChange: (day: string) => void; choices?: string[]; blank?: string}) {
  const days = choices ?? dayChoices(value);
  const option = (day: string) => <option key={day} value={day}>{dayWords(day)}</option>;
  const months = days.length > 31 ? [...new Set(days.map(day => day.slice(0, 7)))] : [];
  return <span className="sched-pill day-pill">
    <span>{value ? dayWords(value) : blank ?? ""}</span>
    <ChevronDown size={14} aria-hidden="true" />
    <select aria-label={label} value={value} onChange={e => { if (e.target.value || blank !== undefined) onChange(e.target.value); }}>
      {blank !== undefined && <option value="">{blank}</option>}
      {months.length ? months.map(month => <optgroup key={month} label={monthWords(`${month}-01`)}>{days.filter(day => day.startsWith(month)).map(option)}</optgroup>) : days.map(option)}
    </select>
  </span>;
}
