"use client";

// Training > one person > Assign study. A manager sees the dishes this person still needs to work on and
// can hand any dish over with one tap. The list starts on "Needs practice", but every dish on the menu is
// reachable (Not quizzed yet, All dishes, or the search), flagged or not.
import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { MenuItem } from "@/lib/menu";

export type DishGroup = {key: string; heading: string; items: MenuItem[]};
type Show = "practice" | "new" | "all";
// Past this many dishes at once, "Assign all" asks once more, so a stray tap cannot flood someone's phone.
const CONFIRM_FROM = 8;

const dishKey = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function AssignDishes({items, practiceIds, quizzedIds, scores, assignedIds, busy, group, onAssign}: {
  items: MenuItem[];
  practiceIds: ReadonlySet<string>;
  quizzedIds: ReadonlySet<string>;
  scores: ReadonlyMap<string, string>;
  assignedIds: ReadonlySet<string>;
  busy: boolean;
  group: (list: MenuItem[]) => DishGroup[];
  onAssign: (ids: string[], note: string, due: string) => Promise<void>;
}) {
  const [show, setShow] = useState<Show>("practice");
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [sure, setSure] = useState(false);
  const newIds = items.filter(item => !quizzedIds.has(item.id));
  const practice = items.filter(item => practiceIds.has(item.id));
  const needle = dishKey(search);
  // Typing in the search looks at the whole menu, whichever chip is lit, so no dish can be hidden by a filter.
  const shown = items.filter(item => needle ? dishKey(item.name).includes(needle) : show === "all" ? true : show === "new" ? !quizzedIds.has(item.id) : practiceIds.has(item.id));
  const groups = group(shown);
  const todo = (show === "new" ? newIds : practice).filter(item => !assignedIds.has(item.id));
  const chips: [Show, string][] = [["practice", `Needs practice · ${practice.length}`], ["new", `Not quizzed yet · ${newIds.length}`], ["all", "All dishes"]];
  async function give(ids: string[]) {
    setSure(false);
    await onAssign(ids, note, due);
    setNote(""); setDue("");
  }
  return <section className="panel assign-dishes" aria-label="Assign study">
    <h2 className="assign-dishes-title">Assign study</h2>
    <div className="dish-picker-field">
      <Search size={18} aria-hidden="true" className="dish-picker-lens" />
      <input type="search" autoComplete="off" aria-label="Search menu items to assign" placeholder="Search dishes" value={search} style={{paddingLeft: 44}} onChange={event => setSearch(event.target.value)} onKeyDown={event => {if (event.key === "Enter") event.preventDefault();}} />
    </div>
    <div className="category-tabs" role="group" aria-label="Show">
      {chips.map(([key, text]) => <button key={key} type="button" aria-pressed={!needle && show === key} onClick={() => {setSearch(""); setSure(false); setShow(key);}}>{text}</button>)}
    </div>
    {groups.length ? <div className="assign-dishes-list">{groups.map(section => <div key={section.key}>
      <p className="eyebrow muted">{section.heading}</p>
      <ul>{section.items.map(item => {
        const score = scores.get(item.id);
        const given = assignedIds.has(item.id);
        return <li key={item.id}>
          <span className="assign-dishes-name"><b>{item.name}</b>{score && <small>{score}</small>}</span>
          {given ? <span className="assign-dishes-done"><Check size={14} aria-hidden="true" />Assigned</span>
            : <button type="button" className="btn secondary" disabled={busy} aria-label={`Assign ${item.name}`} onClick={() => void give([item.id])}>Assign</button>}
        </li>;
      })}</ul>
    </div>)}</div> : <p className="muted assign-dishes-empty">{needle ? `No dish called “${search.trim()}”.` : show === "new" ? "Every menu item has a completed quiz." : show === "practice" ? "Nothing needs practice." : "No dishes on this menu yet."}</p>}
    {!needle && show !== "all" && todo.length > 1 && <div className="assign-dishes-foot">
      {sure ? <>
        <span className="muted">{`Assign ${todo.length} dishes to this person?`}</span>
        <span className="assign-dishes-buttons">
          <button type="button" className="btn secondary" disabled={busy} onClick={() => setSure(false)}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void give(todo.map(item => item.id))}>Yes, assign</button>
        </span>
      </> : <button type="button" className="btn" disabled={busy} onClick={() => todo.length >= CONFIRM_FROM ? setSure(true) : void give(todo.map(item => item.id))}>{`Assign all ${todo.length}`}</button>}
    </div>}
    <details className="assign-dishes-more">
      <summary>Add a note or due date<ChevronDown size={16} aria-hidden="true" /></summary>
      <label>Note (optional)<input maxLength={200} value={note} onChange={event => setNote(event.target.value)} /></label>
      <label>Due date (optional)<input type="date" value={due} onChange={event => setDue(event.target.value)} /></label>
    </details>
  </section>;
}
