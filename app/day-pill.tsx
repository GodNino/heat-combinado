"use client";
// A day shown as a small pill ("Today · Mon, Oct 26") with a menu under it: yesterday, today and the next two
// weeks. Used where a date box used to be (Side work, the floor plan). The plain browser date box is a big grey
// field, and Safari on a Mac turns it into typing segments; a menu looks and works the same everywhere.
import { ChevronDown } from "lucide-react";
import { dayChoices, dayWords } from "@/lib/day-words";

export function DayPill({label, value, onChange}: {label: string; value: string; onChange: (day: string) => void}) {
  return <span className="sched-pill day-pill">
    <span>{dayWords(value)}</span>
    <ChevronDown size={14} aria-hidden="true" />
    <select aria-label={label} value={value} onChange={e => e.target.value && onChange(e.target.value)}>
      {dayChoices(value).map(day => <option key={day} value={day}>{dayWords(day)}</option>)}
    </select>
  </span>;
}
