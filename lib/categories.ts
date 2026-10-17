export type ContentType = 'food' | 'cocktails' | 'wine';
export const CONTENT_TYPES: readonly ContentType[] = ['food', 'cocktails', 'wine'];
// The plain fallback words, used only until a restaurant sets its own in Library settings.
// Nothing here is specific to any one menu.
export const CONTENT_LABELS: Record<ContentType, {short: string; one: string; many: string}> = {
  food: {short: 'Food', one: 'dish', many: 'dishes'},
  cocktails: {short: 'Cocktails', one: 'cocktail', many: 'cocktails'},
  wine: {short: 'Wine', one: 'wine', many: 'wines'},
};
export function contentTypeOf(item: {content_type?: string}): ContentType {
  return item.content_type === 'cocktails' || item.content_type === 'wine' ? item.content_type : 'food';
}
// Whatever the restaurant filed the item under is what shows. The app holds no list of
// allowed names: a section is whatever a restaurant calls it.
export function categoryOf(item: {category?: string}): string {
  return (item.category ?? '').trim() || 'Other';
}
// A restaurant with no sections of its own yet starts here. Nothing cuisine-specific.
export const STARTER_CATEGORIES: Record<ContentType, readonly string[]> = {
  food: ['Starters', 'Mains', 'Sides', 'Desserts', 'Other'],
  cocktails: ['Signature', 'Classics', 'Alcohol-free', 'Other'],
  wine: ['Sparkling', 'White', 'Rosé', 'Red', 'Dessert', 'Other'],
};
export function filterContent<T extends {name:string;description:string;ingredients:string[];allergens?:string[];category?:string;content_type?:string}>(items:T[], category:string, query:string, contentType?: ContentType):T[] {
  const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normalize(query.trim());
  return items.filter(item=>(!contentType || contentTypeOf(item)===contentType)&&(category==='All'||categoryOf(item)===category)&&(!q||normalize([item.name,item.description,...item.ingredients,...(item.allergens??[])].join(' ')).includes(q)));
}
