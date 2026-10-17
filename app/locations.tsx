"use client";
// Locations: a brand (Osaka) and the restaurants inside it (Miami, Chicago...). Each location keeps
// its own menu. A new one starts empty, and its manager picks which dishes to bring over from
// another location — now or any time later — rather than copying a whole menu it won't serve.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Store } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { MenuItem, Restaurant } from "@/lib/menu";
import { CONTENT_LABELS, CONTENT_TYPES, STARTER_CATEGORIES, categoryOf, contentTypeOf, type ContentType } from "@/lib/categories";
import { Field } from "./ui";

export type Organization = { id: string; name: string; owner_id: string };

// Every new restaurant gets its three libraries and a starter set of sections to rename.
export async function setUpLibraries(restaurantId: string) {
  const sections = await supabase!.from("menu_sections").insert(CONTENT_TYPES.map(type => ({
    restaurant_id: restaurantId, content_type: type, name: CONTENT_LABELS[type].short,
    heading: CONTENT_LABELS[type].short, item_one: CONTENT_LABELS[type].one, item_many: CONTENT_LABELS[type].many,
  })));
  if (sections.error) throw new Error(`The restaurant was created, but its libraries were not: ${sections.error.message}`);
  const starters = await supabase!.from("menu_categories").insert(CONTENT_TYPES.flatMap(type =>
    STARTER_CATEGORIES[type].map((categoryName, index) => ({
      restaurant_id: restaurantId, content_type: type, name: categoryName, sort_order: index + 1,
    }))));
  if (starters.error) throw new Error(`The restaurant was created, but its sections were not: ${starters.error.message}`);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function Locations({userId, restaurant, restaurants, organizations, items, canImport, busy, action, setMessage, onChanged, onItemsChanged, onOpen}: {
  userId: string;
  restaurant: Restaurant;
  restaurants: Restaurant[];
  organizations: Organization[];
  items: MenuItem[];
  canImport: boolean;
  busy: boolean;
  action: (work: () => Promise<void>) => Promise<void>;
  setMessage: (text: string) => void;
  onChanged: () => Promise<void>;
  onItemsChanged: () => Promise<void>;
  onOpen: (restaurantId: string) => void;
}) {
  const organization = organizations.find(o => o.id === restaurant.organization_id);
  const ownsBrand = organization?.owner_id === userId;
  const locations = organization ? restaurants.filter(r => r.organization_id === organization.id) : [];
  // Restaurants this person owns outright that could join the brand.
  const loose = restaurants.filter(r => !r.organization_id && r.owner_id === userId && !r.is_demo);
  const others = locations.filter(r => r.id !== restaurant.id);

  async function startBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("brand-name") ?? "").trim();
    await action(async () => {
      const result = await supabase!.rpc("create_organization", {org_name: name, rid: restaurant.id});
      if (result.error) throw new Error(result.error.message);
      await onChanged();
      setMessage(`${name} is set up. Add your other locations below.`);
    });
  }
  async function openLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("location-name") ?? "").trim();
    await action(async () => {
      const result = await supabase!.rpc("create_location", {oid: organization!.id, location_name: name});
      if (result.error) throw new Error(result.error.message);
      await setUpLibraries(result.data as string);
      await onChanged();
      form.reset();
      onOpen(result.data as string);
      setMessage(`${name} is open. Its menu is empty: choose the dishes it shares with your other locations below.`);
    });
  }
  async function addToBrand(target: Restaurant) {
    await action(async () => {
      const result = await supabase!.rpc("add_restaurant_to_organization", {oid: organization!.id, rid: target.id});
      if (result.error) throw new Error(result.error.message);
      await onChanged();
      setMessage(`${target.name} is now part of ${organization!.name}.`);
    });
  }

  return <section className="mx-auto max-w-3xl">
    <p className="eyebrow muted">Locations</p>
    {!organization ? <>
      <h1 className="mt-3 text-2xl font-semibold">{restaurant.name}</h1>
      {restaurant.owner_id === userId && !restaurant.is_demo ? <div className="panel mt-6 p-6">
        <Store size={24} aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold">Run several locations?</h2>
        <p className="muted mt-2">Group them under your brand. Each location keeps its own menu and team, and you can open new ones and bring over the dishes they share.</p>
        <form className="mt-5" onSubmit={startBrand}>
          <Field label="Brand name"><input id="brand-name" name="brand-name" required maxLength={100} placeholder="e.g. Osaka" /></Field>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Create brand"}</button>
        </form>
      </div> : <p className="muted mt-3">This restaurant is not part of a brand.</p>}
    </> : <>
      <h1 className="mt-3 text-2xl font-semibold">{organization.name}</h1>
      <p className="muted mt-2">{locations.length} {locations.length === 1 ? "location" : "locations"}. Each one has its own menu, team and pre-shift.</p>
      <ul className="mt-6 space-y-2">
        {locations.map(location => <li key={location.id} className="panel flex items-center gap-3 px-5 py-4">
          <Store size={19} aria-hidden="true" />
          <span className="min-w-0 flex-1 font-semibold">{location.name}</span>
          {location.id === restaurant.id
            ? <span className="eyebrow muted">You're here</span>
            : <button type="button" className="btn secondary" onClick={() => onOpen(location.id)}>Open</button>}
        </li>)}
      </ul>
      {ownsBrand && loose.length > 0 && <div className="mt-6">
        <h2 className="text-lg font-semibold">Your other restaurants</h2>
        <ul className="mt-3 space-y-2">{loose.map(other => <li key={other.id} className="panel flex items-center gap-3 px-5 py-4">
          <span className="min-w-0 flex-1">{other.name}</span>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void addToBrand(other)}>Add to {organization.name}</button>
        </li>)}</ul>
      </div>}
      {ownsBrand && <form className="panel mt-6 p-6" onSubmit={openLocation}>
        <h2 className="text-lg font-semibold">Open a new location</h2>
        <p className="muted mt-2 mb-5">It starts with an empty menu. Next you choose which dishes it shares with your other locations.</p>
        <Field label="Location name"><input id="location-name" name="location-name" required maxLength={100} placeholder={`e.g. ${organization.name} Chicago`} /></Field>
        <button className="btn" disabled={busy}>{busy ? "Opening…" : "Open location"}</button>
      </form>}
      {canImport && others.length > 0 && <ImportDishes key={restaurant.id} target={restaurant} sources={others} targetItems={items} busy={busy} action={action} setMessage={setMessage} onImported={onItemsChanged} />}
    </>}
  </section>;
}

type SourceItem = Pick<MenuItem, "id" | "name" | "category" | "content_type" | "photo_path">;

function ImportDishes({target, sources, targetItems, busy, action, setMessage, onImported}: {
  target: Restaurant;
  sources: Restaurant[];
  targetItems: MenuItem[];
  busy: boolean;
  action: (work: () => Promise<void>) => Promise<void>;
  setMessage: (text: string) => void;
  onImported: () => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(sources[0].id);
  const [sourceItems, setSourceItems] = useState<SourceItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    setSourceItems(null); setLoadError(""); setPicked(new Set());
    void supabase!.from("menu_items").select("id,name,category,content_type,photo_path").eq("restaurant_id", sourceId).order("name")
      .then(({data, error}) => {
        if (!live) return;
        if (error) setLoadError(error.message); else setSourceItems((data ?? []) as SourceItem[]);
      });
    return () => {live = false;};
  }, [sourceId]);
  const source = sources.find(s => s.id === sourceId)!;
  const isHere = (item: SourceItem) => targetItems.some(t => contentTypeOf(t) === contentTypeOf(item) && sameName(t.name, item.name));
  // Library, then category, in the order they come: the way the source's own menu reads.
  const groups = useMemo(() => CONTENT_TYPES.map(type => {
    const ofType = (sourceItems ?? []).filter(item => contentTypeOf(item) === type);
    const categories = [...new Set(ofType.map(item => categoryOf(item)))];
    return {type, categories: categories.map(name => ({name, items: ofType.filter(item => categoryOf(item) === name)}))};
  }).filter(group => group.categories.length), [sourceItems]);
  const toggle = (ids: string[], on: boolean) => setPicked(current => {
    const next = new Set(current);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });

  async function importPicked() {
    await action(async () => {
      const result = await supabase!.rpc("import_menu_items", {source_rid: sourceId, target_rid: target.id, item_ids: [...picked]});
      if (result.error) throw new Error(result.error.message);
      const rows = (result.data ?? []) as {new_id: string; source_photo: string | null}[];
      // Photos are copied file by file. A photo that fails leaves its dish without one, nothing worse.
      let missed = 0;
      for (const row of rows) {
        if (!row.source_photo) continue;
        const extension = row.source_photo.split(".").pop() || "jpg";
        const destination = `${target.id}/${crypto.randomUUID()}.${extension}`;
        const copied = await supabase!.storage.from("menu-photos").copy(row.source_photo, destination);
        const saved = copied.error ? copied : await supabase!.from("menu_items").update({photo_path: destination}).eq("id", row.new_id);
        if (saved.error) missed++;
      }
      setPicked(new Set());
      await onImported();
      const count = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
      setMessage(rows.length
        ? `Imported ${count} from ${source.name}. They belong to ${target.name} now: edit them freely.${missed ? ` ${missed} photo${missed === 1 ? "" : "s"} could not be copied; add ${missed === 1 ? "it" : "them"} from the dish.` : ""}`
        : "Nothing new to import: those are already here.");
    });
  }

  return <div className="panel mt-6 p-6">
    <h2 className="text-lg font-semibold">Bring dishes into {target.name}</h2>
    <p className="muted mt-2 mb-5">Which dishes does {target.name} share with another location? Pick only those. The copies are {target.name}&apos;s own, and you can come back for new ones any time.</p>
    {sources.length > 1 && <Field label="Import from"><select id="import-source" value={sourceId} onChange={e => setSourceId(e.target.value)}>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
    {loadError ? <p className="muted">Could not load {source.name}&apos;s menu: {loadError}</p>
      : !sourceItems ? <p className="muted" role="status">Loading {source.name}&apos;s menu…</p>
      : !sourceItems.length ? <p className="muted">{source.name} has no dishes yet.</p>
      : <>
        {groups.map(group => <fieldset key={group.type} className="import-group">
          <legend className="eyebrow muted">{CONTENT_LABELS[group.type as ContentType].short} · from {source.name}</legend>
          {group.categories.map(category => {
            const open = category.items.filter(item => !isHere(item)).map(item => item.id);
            const all = open.length > 0 && open.every(id => picked.has(id));
            return <div key={category.name} className="import-category">
              <label className="import-row import-category-head">
                <input type="checkbox" checked={all} disabled={!open.length} onChange={e => toggle(open, e.target.checked)} />
                <span>{category.name}</span>
                <span className="muted ml-auto text-xs">{category.items.length}</span>
              </label>
              {category.items.map(item => {
                const here = isHere(item);
                return <label key={item.id} className={`import-row ${here ? "muted" : ""}`}>
                  <input type="checkbox" checked={!here && picked.has(item.id)} disabled={here} onChange={e => toggle([item.id], e.target.checked)} />
                  <span className="min-w-0 flex-1">{item.name}</span>
                  {here && <span className="import-here"><Check size={14} aria-hidden="true" />Already here</span>}
                </label>;
              })}
            </div>;
          })}
        </fieldset>)}
        <button type="button" className="btn mt-5 w-full" disabled={busy || !picked.size} onClick={() => void importPicked()}>
          {busy ? "Importing…" : picked.size ? `Import ${picked.size} ${picked.size === 1 ? "item" : "items"} into ${target.name}` : "Choose the dishes to import"}
        </button>
      </>}
  </div>;
}
