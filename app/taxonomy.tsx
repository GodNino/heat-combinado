"use client";
import { createContext, useContext } from "react";
import { CONTENT_TYPES, CONTENT_LABELS, STARTER_CATEGORIES, type ContentType } from "@/lib/categories";

// What a restaurant calls its libraries, and the sections inside them.
// Every word here is the restaurant's own data. The app only supplies a neutral fallback
// for a restaurant that has not set anything up yet, so nothing on screen is ever empty.
export type SectionWords = {name: string; heading: string; about: string; item_one: string; item_many: string};
export type MenuCategoryRow = {content_type: ContentType; name: string; sort_order: number; archived: boolean};
export type Taxonomy = {categories: MenuCategoryRow[]; sections: Partial<Record<ContentType, SectionWords>>};

export const EMPTY_TAXONOMY: Taxonomy = {categories: [], sections: {}};
export const TaxonomyContext = createContext<Taxonomy>(EMPTY_TAXONOMY);

// The restaurant's own section names for one library, in its own order. Archived ones are left out.
export function namesIn(taxonomy: Taxonomy, type: ContentType): string[] {
  const own = taxonomy.categories.filter(row => row.content_type === type && !row.archived)
    .sort((a, b) => a.sort_order - b.sort_order).map(row => row.name);
  return own.length ? own : [...STARTER_CATEGORIES[type]];
}

// What this restaurant calls the library itself, and one item inside it.
export function wordsIn(taxonomy: Taxonomy, type: ContentType): SectionWords {
  return taxonomy.sections[type] ?? {name: CONTENT_LABELS[type].short, heading: CONTENT_LABELS[type].short,
    about: "", item_one: CONTENT_LABELS[type].one, item_many: CONTENT_LABELS[type].many};
}

export function useTaxonomy() {
  const taxonomy = useContext(TaxonomyContext);
  return {
    namesFor: (type: ContentType) => namesIn(taxonomy, type),
    labelFor: (type: ContentType) => wordsIn(taxonomy, type),
    rank: CONTENT_TYPES.flatMap(type => namesIn(taxonomy, type)),
  };
}
