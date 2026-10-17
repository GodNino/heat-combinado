"use client";
import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { ContentType } from "@/lib/categories";
import type { MenuItem } from "@/lib/menu";
import { answerCount, canDeleteField, checkNewField, coreFields, hiddenCore, hiddenFields, newFieldRow, shownFields, withHidden, MAX_LABEL, type CardField, type CardFieldRow } from "@/lib/card-fields";
import { InfoButton, Notice, SectionInfo } from "./ui";

// The restaurant's card-field settings, for every card on screen. Empty until the settings load (or
// the card_fields table exists), which is the same as "the fields as shipped".
export const CardRowsContext = createContext<CardFieldRow[]>([]);
export const useCardRows = () => useContext(CardRowsContext);

// Every change here applies to the whole library and saves at once, separately from the item being
// edited. When the settings table is not there yet (ready is false) nothing below shows a control and
// the form is exactly what the app shipped with.

const sameRow = (a: CardFieldRow, b: CardFieldRow) => a.content_type === b.content_type && a.field_key === b.field_key;

async function saveRow(restaurantId: string, row: CardFieldRow, rows: CardFieldRow[], onRows: (rows: CardFieldRow[]) => void) {
  if (!supabase) throw new Error("Not connected. Refresh and try again.");
  const result = await supabase.from("card_fields").upsert(
    {restaurant_id: restaurantId, ...row, updated_at: new Date().toISOString()},
    {onConflict: "restaurant_id,content_type,field_key"},
  );
  if (result.error) throw result.error;
  onRows([...rows.filter(r => !sameRow(r, row)), row]);
}

const errorText = (e: unknown) => {
  const message = typeof e === "object" && e && "message" in e ? String((e as {message: unknown}).message) : "";
  return message || "That did not save. Please try again.";
};

export type CardScope = {
  restaurantId: string;
  contentType: ContentType;
  rows: CardFieldRow[];
  onRows: (rows: CardFieldRow[]) => void;
  // "cocktails", "dishes", "wines and sakes": how this library is named in the warnings.
  many: string;
};

const smallChip = {minHeight: 28, padding: "3px 11px", flexShrink: 0} as const;

// One field of the form with a small Hide beside its name. Hide asks first, in a line with an (i),
// and keeps the box in the page while it asks, so nothing already typed in it is lost on Cancel.
function Hideable({scope, id, name, label, htmlFor, badge, info, children}: {scope: CardScope; id: string; name: string; label: string; htmlFor: string; badge?: ReactNode; info?: ReactNode; children: ReactNode}) {
  const {restaurantId, contentType, rows, onRows, many} = scope;
  const [asking, setAsking] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function hide() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveRow(restaurantId, withHidden(contentType, rows, id, true), rows, onRows);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return <div>
    {asking && <div className="panel mb-5 p-4">
      <SectionInfo heading={`Hide ${name} for all ${many}?`} headingClassName="text-sm font-semibold">
        It disappears from the cards, this form and printed sheets. Nothing is erased, and you can show it again anytime from Hidden fields.
      </SectionInfo>
      <Notice text={error} error />
      <div className="card-admin-actions mt-3">
        <button type="button" className="btn" disabled={busy} onClick={() => void hide()}>Hide it</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setAsking(false); setError(""); }}>Cancel</button>
      </div>
    </div>}
    <div className="field" hidden={asking}>
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6}}>
        <div style={{display: "flex", alignItems: "center", gap: 8, minWidth: 0}}>
          <label htmlFor={htmlFor} style={{margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0}}>{label}{badge}</label>
          {info ? <InfoButton open={help} onClick={() => setHelp(open => !open)} /> : null}
        </div>
        <button type="button" className="word-chip" style={smallChip} aria-label={`Hide ${name} for all ${many}`} onClick={() => setAsking(true)}>Hide</button>
      </div>
      {info && help ? <p className="count-info-text" style={{marginTop: 0, marginBottom: 10}}>{info}</p> : null}
      {children}
    </div>
  </div>;
}

// One of the form's built-in optional boxes (price, time, price label, table setting, observations,
// sauces). Hidden for the library: nothing is drawn. Settings not loaded: the box as it always was.
export function CoreField({id, name, label, info, ready, scope, children}: {id: string; name: string; label: string; info?: ReactNode; ready: boolean; scope: CardScope; children: ReactElement<{id?: string}>}) {
  const htmlFor = children.props.id ?? "";
  if (!ready) return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}</div>;
  if (hiddenCore(scope.contentType, scope.rows).has(id)) return null;
  return <Hideable scope={scope} id={id} name={name} label={label} htmlFor={htmlFor} info={info}>{children}</Hideable>;
}

const nounOf = (contentType: ContentType) => contentType === "wine" ? "wine and sake" : contentType === "cocktails" ? "cocktail" : "dish";

// The detail fields of the "Edit menu item" form.
//   part "shipped": the fields the app comes with, each in place with a small Hide.
//   part "extra":   one compact box near the Save button: the restaurant's own fields, a small
//                   "+ Add a field", and "Hidden fields" for everything hidden anywhere on the form.
export function CardFieldInputs({part = "shipped", restaurantId, contentType, rows, ready, items, many, values, onRows, onDeleted}: {
  part?: "shipped" | "extra";
  restaurantId: string;
  contentType: ContentType;
  rows: CardFieldRow[];
  ready: boolean;
  items: MenuItem[];
  many: string;
  // What the item being edited has stored now, to fill the boxes.
  values?: Record<string, string> | null;
  onRows: (rows: CardFieldRow[]) => void;
  // Called after a field and its answers were erased, so the open item can pick up its new version.
  onDeleted: () => Promise<void>;
}) {
  const scope: CardScope = {restaurantId, contentType, rows, onRows, many};
  const [confirmDelete, setConfirmDelete] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [help, setHelp] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"line" | "text">("line");
  const [onCard, setOnCard] = useState(true);
  const [showTeam, setShowTeam] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = ready ? rows : [];
  const shown = shownFields(contentType, active);
  const input = (field: CardField) => field.kind === "text"
    ? <textarea id={`detail-${field.id}`} name={`detail-${field.id}`} rows={3} maxLength={field.max} placeholder={field.hint ?? ""} defaultValue={values?.[field.id] ?? ""} />
    : <input id={`detail-${field.id}`} name={`detail-${field.id}`} maxLength={field.max} placeholder={field.hint ?? ""} defaultValue={values?.[field.id] ?? ""} />;

  if (part === "shipped") {
    return <>{shown.filter(field => !field.custom).map(field => {
      const label = `${field.label} (optional)`;
      return ready
        ? <Hideable key={field.id} scope={scope} id={field.id} name={field.label} label={label} htmlFor={`detail-${field.id}`}>{input(field)}</Hideable>
        : <div className="field" key={field.id}><label htmlFor={`detail-${field.id}`}>{label}</label>{input(field)}</div>;
    })}</>;
  }
  if (!ready) return null;

  // Everything hidden on this form, built-in or the restaurant's own.
  const hidden: CardField[] = [
    ...hiddenFields(contentType, active),
    ...coreFields(contentType, active).filter(field => field.hidden),
  ];
  const own = shown.filter(field => field.custom);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const showAgain = (field: CardField) => run(() => saveRow(restaurantId, withHidden(contentType, rows, field.id, false), rows, onRows));

  const add = () => {
    const problem = checkNewField(contentType, rows, name);
    if (problem) return setError(problem);
    return run(async () => {
      await saveRow(restaurantId, newFieldRow(contentType, rows, {label: name, kind, onCard, showTeam}), rows, onRows);
      setName("");
      setKind("line");
      setOnCard(true);
      setShowTeam(true);
      setAdding(false);
    });
  };

  const erase = (field: CardField) => run(async () => {
    if (!supabase) throw new Error("Not connected. Refresh and try again.");
    const result = await supabase.rpc("delete_card_field", {rid: restaurantId, ctype: contentType, fkey: field.id});
    if (result.error) throw result.error;
    onRows(rows.filter(r => !(r.content_type === contentType && r.field_key === field.id)));
    setConfirmDelete("");
    await onDeleted();
  });

  return <section className="panel mb-4" style={{padding: "8px 12px"}} aria-label="Extra fields">
    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10}}>
      <div style={{display: "flex", alignItems: "center", gap: 8, minWidth: 0}}>
        <h2 className="eyebrow muted">Extra fields</h2>
        <InfoButton open={help} onClick={() => setHelp(open => !open)} />
      </div>
      {!adding && <button type="button" className="btn" style={{minHeight: 28, padding: "2px 12px", fontSize: 13, width: "auto", flexShrink: 0}} disabled={busy} onClick={() => { setError(""); setAdding(true); }}>+ Add a field</button>}
    </div>
    {help && <p className="count-info-text">Add your own boxes, like “Pairs with” or “Smoke method”. They appear on every {nounOf(contentType)}, for all {many}. A box left empty never shows or prints.</p>}
    <Notice text={error} error />
    {own.length > 0 && <div className="mt-3">
      {own.map(field => <Hideable key={field.id} scope={scope} id={field.id} name={field.label} label={field.label} htmlFor={`detail-${field.id}`} badge={<span className="menu-badge">Yours</span>}>{input(field)}</Hideable>)}
    </div>}
    {adding && <div className="mt-3">
      <div className="field">
        <label htmlFor="new-field-name">Field name</label>
        <input id="new-field-name" value={name} maxLength={MAX_LABEL} placeholder="Pairs with, Smoke method…" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void add(); } }} />
      </div>
      <div className="word-chips mb-4" role="group" aria-label="Type of box">
        <button type="button" className="word-chip" aria-pressed={kind === "line"} onClick={() => setKind("line")}>Short text</button>
        <button type="button" className="word-chip" aria-pressed={kind === "text"} onClick={() => setKind("text")}>Long text</button>
      </div>
      <div className="space-y-2 mb-4">
        <label className="check-row"><input type="checkbox" checked={onCard} onChange={event => setOnCard(event.target.checked)} /><span>Print it on the card</span></label>
        <label className="check-row"><input type="checkbox" checked={showTeam} onChange={event => setShowTeam(event.target.checked)} /><span>Show it to the team</span></label>
      </div>
      <div className="card-admin-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void add()}>Add field</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setAdding(false); setError(""); }}>Cancel</button>
      </div>
    </div>}
    {hidden.length > 0 && <div className="mt-3 space-y-2">
      <button type="button" className="panel compact-menu-row w-full text-left" aria-expanded={showHidden} onClick={() => setShowHidden(open => !open)}>
        <span className="min-w-0 flex-1 font-semibold">Hidden fields</span>
        <span className="menu-badge">{hidden.length}</span>
        <span aria-hidden="true" style={{marginLeft: 8}}>{showHidden ? "−" : "+"}</span>
      </button>
      {showHidden && hidden.map(field => {
        const count = field.custom ? answerCount(items, contentType, field.id) : 0;
        return <div key={field.id} className="panel p-4">
          <span className="block font-semibold">{field.label}</span>
          {field.custom && <span className="muted block text-xs">{count ? `Answers kept on ${count} ${many}` : "No answers yet"}</span>}
          {confirmDelete === field.id
            ? <>
                <p className="mt-3 text-sm"><b>Delete “{field.label}” for good?</b> {count ? `This erases it and its answers on ${count} ${many}.` : "This erases it."} It can’t be undone.</p>
                <div className="card-admin-actions mt-3">
                  <button type="button" className="btn secondary card-admin-danger" disabled={busy} onClick={() => void erase(field)}>Delete for good</button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmDelete("")}>Keep</button>
                </div>
              </>
            : <div className="card-admin-actions mt-3">
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void showAgain(field)}>Show again</button>
                {canDeleteField(field) && <button type="button" className="btn secondary card-admin-danger" disabled={busy} onClick={() => { setError(""); setConfirmDelete(field.id); }}>Delete</button>}
              </div>}
        </div>;
      })}
    </div>}
  </section>;
}
