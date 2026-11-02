"use client";
// The list of steps on a job: type them, remove one, add one, or hold the handle and drag a
// step into place. Used by the saved-job form and by "a job for today".
import { useRef, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";

export const MAX_STEPS = 30;

// The words default to a job's steps; the running side work lists (floor-plan.tsx) say "jobs" instead.
export function StepsEditor({steps, onChange, idPrefix, label = "Steps", addLabel = "Add a step", placeholder = "The next thing they do…"}: {steps: string[]; onChange: (next: string[]) => void; idPrefix: string; label?: string; addLabel?: string; placeholder?: string}) {
  // The step being dragged, and where each step row sits so the drag knows what it is over.
  const [dragging, setDragging] = useState<number | null>(null);
  const rows = useRef<Array<HTMLDivElement | null>>([]);
  const setStep = (index: number, value: string) => onChange(steps.map((step, i) => i === index ? value : step));
  const addStep = () => { if (steps.length < MAX_STEPS) onChange([...steps, ""]); };
  const dropStep = (index: number) => onChange(steps.length > 1 ? steps.filter((_, i) => i !== index) : [""]);
  function moveStep(from: number, to: number) {
    if (from === to || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }
  // While a handle is held, whichever row the finger is over is where the step goes.
  function dragOver(y: number) {
    if (dragging === null) return;
    if (y > window.innerHeight - 90) window.scrollBy(0, 14); else if (y < 90) window.scrollBy(0, -14);
    const target = rows.current.findIndex(el => !!el && y >= el.getBoundingClientRect().top && y <= el.getBoundingClientRect().bottom);
    if (target >= 0 && target !== dragging) { moveStep(dragging, target); setDragging(target); }
  }
  return <div>
    <label htmlFor={idPrefix + "-0"}>{label}</label>
    <div className="mt-2 space-y-2">{steps.map((step, index) => <div key={index} ref={el => {rows.current[index] = el;}} className="flex items-center gap-2" style={dragging === index ? {outline: "2px solid var(--lime)", outlineOffset: 4, borderRadius: 12} : undefined}>
      <button type="button" className="icon-chip shrink-0" style={{touchAction: "none", cursor: dragging === index ? "grabbing" : "grab"}} aria-label={"Drag step " + (index + 1) + " to move it"} title="Drag to move this step"
        onPointerDown={e => {e.currentTarget.setPointerCapture(e.pointerId); setDragging(index);}}
        onPointerMove={e => dragOver(e.clientY)}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}><GripVertical size={15} /></button>
      <span className="step-number shrink-0">{index + 1}</span>
      <input id={idPrefix + "-" + index} className="min-w-0 flex-1" maxLength={200} value={step} onChange={e => setStep(index, e.target.value)} placeholder={placeholder} />
      <button type="button" className="icon-chip shrink-0" onClick={() => dropStep(index)} aria-label={"Remove step " + (index + 1)} title="Remove this step"><X size={15} /></button>
    </div>)}</div>
    {steps.length < MAX_STEPS && <button type="button" className="muted mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm" onClick={addStep}><Plus size={15} />{addLabel}</button>}
  </div>;
}
