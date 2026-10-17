import {allergenCode,isCC} from './allergies.ts';
// Card badges use the same allergen list as the Allergy check (lib/allergies.ts).
export function allergenBadge(note:string) {
 const text=note.replace(/\bCC\b/gi,'cross-contamination');
 return {code:allergenCode(note),text,cc:isCC(note)};
}
export function serviceSummary(item:{price_label?:string|null;price?:number|null;fire_minutes?:number|null}) {
 return [item.price_label || (item.price!=null?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:Number(item.price)%1?2:0,maximumFractionDigits:2}).format(Number(item.price)):null),item.fire_minutes!=null?`${item.fire_minutes} min`:null].filter(Boolean).join(' · ');
}

export function dishDescription(description:string) {
 // Legacy descriptions may have been capitalized or had their spacing edited.
 const normalized=description.replace(/\r\n?/g,'\n');
 const observation=normalized.match(/(?:^|\n)[ \t]*Observations[ \t]*:[ \t]*([^\n]*)/i)?.[1]?.trim()??'';
 const withoutObservation=normalized.replace(/(?:^|\n)[ \t]*Observations[ \t]*:[ \t]*[^\n]*(?:\n|$)/i,'\n');
 const marker=/(?:^|\n)[ \t]*(?:Sauces?\s+and\s+component\s+recipes|Sauce\s+breakdown|Sauce\s+descriptions)[ \t]*:[ \t]*/i.exec(withoutObservation);
 const split=marker?.index??-1;
 const text=split<0?withoutObservation:withoutObservation.slice(0,split);
 const intro=text.trim();
 const raw=split<0?'':withoutObservation.slice(split+marker![0].length).trim();
 const source=raw.match(/(?:^|\n)[ \t]*Source[ \t]*:[ \t]*([\s\S]*)$/i)?.[1]?.trim()??'';
 const body=raw.replace(/(?:^|\n)[ \t]*Source[ \t]*:[ \t]*[\s\S]*$/i,'').trim();
 const matches=[...body.matchAll(/(?:^|\n|(?<=\.)\s+)([^:\n.]{1,100}):\s*/g)];
 const recipes:{name:string;details:string}[]=[];
 if(matches.length){
  const prefix=body.slice(0,matches[0].index).trim();
  if(prefix)recipes.push({name:'Recipe notes',details:prefix});
  matches.forEach((m,i)=>recipes.push({name:m[1].trim(),details:body.slice(m.index!+m[0].length,matches[i+1]?.index??body.length).trim()}));
 }else if(body)recipes.push({name:'Recipe notes',details:body});
 return {intro,observation,recipes,source,recipeText:body};
}

// The form owns section boundaries; managers edit the text inside each section.
export function composeDishDescription(intro:string, recipeText:string, source:string) {
 return [intro.trim(),recipeText.trim() ? `Sauces and component recipes:\n${recipeText.trim()}` : '',source.trim() ? `Source: ${source.trim()}` : ''].filter(Boolean).join('\n\n');
}
