"use client";
// A menu shown as a small 30px pill ("Diego io ⌄"). The real menu sits on top of it, invisible, so a tap opens the
// phone's or the computer's own list. The same pill the Schedule's pop-up uses, for places a plain menu looked heavy.
import type { ReactElement } from "react";
import { ChevronDown } from "lucide-react";

export function PillSelect({text, children}: {text: string; id?: string; children: ReactElement}) {
  return <span className="sched-pill"><span>{text}</span><ChevronDown size={14} aria-hidden="true" />{children}</span>;
}
