import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allergenBadge,serviceSummary,dishDescription,composeDishDescription} from '../lib/menu-summary.ts';
import {assessAllergy,menuAllergies} from '../lib/allergies.ts';
import type {MenuItem} from '../lib/menu.ts';
test('card badges and the Allergy check read the same list',()=>{
 const dish=(note:string):MenuItem=>({id:'1',restaurant_id:'1',name:'Dish',description:'Rice dish',ingredients:['Rice'],allergens:[note],photo_path:'p.jpg'});
 const cases:[string,string][]=[['Salmon','FSH'],['Finfish','FSH'],['Bonito flakes','FSH'],['Garlic','ALL'],['Scallions','ALL'],['Aji amarillo','CAP'],['Honey','HON'],['Butter','DAI'],['Mayonnaise','EGG'],['Shiitake','MSH'],['Panko','GLU'],['Tofu','SOY'],['Spicy','SPI'],['Pineapple','PIN']];
 for(const [note,code] of cases){
  assert.equal(allergenBadge(note).code,code,note);
  const labels=menuAllergies([dish(note)]);
  assert.ok(labels.some(label=>assessAllergy(dish(note),label).status==='avoid'),`${note} is a badge but not blocked by the Allergy check`);
 }
 assert.equal(allergenBadge('Eggplant').code,'NOTE');
 assert.equal(allergenBadge('None').code,'NONE');
 assert.equal(allergenBadge('Nuts').code,'NUT');
 assert.equal(allergenBadge('Peanuts').code,'PNT');
 assert.equal(allergenBadge('Celery (CC)').code,'NOTE');
});
test('compact summaries preserve market prices, missing times and cross-contamination',()=>{
 assert.equal(serviceSummary({price:32,fire_minutes:10}),'$32 · 10 min');
 assert.equal(serviceSummary({price:32.5}),'$32.50');
 assert.equal(serviceSummary({price_label:'Market price',fire_minutes:15}),'Market price · 15 min');
 assert.equal(serviceSummary({}),'');
 assert.equal(allergenBadge('Shellfish (CC)').code,'SHL');
 assert.equal(allergenBadge('Shellfish (CC)').cc,true);
 assert.equal(allergenBadge('Fish').cc,false);
 assert.equal(allergenBadge('Gluten (cross-contamination)').cc,true);
});

test('detail sections separate inline sauce recipes and preserve unknown notes',()=>{
 const d=dishDescription('Lobster.\n\nSauces and component recipes:\nCurry: Ginger, curry (shrimp paste). Plantain Puree: Plantain, salt. Camote: Sweet potato.\n\nSource: Manual page 3.');
 assert.equal(d.intro,'Lobster.');assert.deepEqual(d.recipes.map(x=>x.name),['Curry','Plantain Puree','Camote']);assert.equal(d.recipes[0].details,'Ginger, curry (shrimp paste).');assert.equal(d.source,'Manual page 3.');
 const cocktail=dishDescription('Fruit cocktail.\n\nObservations: No straw\n\nMethod: Building');assert.equal(cocktail.observation,'No straw');assert.ok(cocktail.intro.includes('Method: Building'));assert.ok(!cocktail.intro.includes('Observations:'));
 assert.equal(dishDescription('Plain description').recipes.length,0);
});

test('capitalized legacy sections retain recipes and observations',()=>{
 const original='SALMON NIGIRI.\n\nSAUCES AND COMPONENT RECIPES:\nINCA BASE: AJI, GARLIC.\n\nOBSERVATIONS: DO NOT USE SOY SAUCE.\n\nSOURCE: MENU PAGE 6.';
 const d=dishDescription(original);
 assert.equal(d.intro,'SALMON NIGIRI.');assert.equal(d.observation,'DO NOT USE SOY SAUCE.');assert.equal(d.recipes[0].name,'INCA BASE');assert.equal(d.source,'MENU PAGE 6.');assert.equal(d.recipeText,'INCA BASE: AJI, GARLIC.');
 const mixed=dishDescription('Fish\r\n\r\n Sauce Breakdown :\r\nSauce: Lime\r\nsource : Manual');assert.equal(mixed.recipes[0].details,'Lime');assert.equal(mixed.source,'Manual');
});

test('separate editor fields retain section boundaries when text changes case',()=>{
 const saved=composeDishDescription('SALMON NIGIRI.','INCA BASE: AJI, GARLIC.','Manual page 6.');
 const read=dishDescription(saved);assert.equal(read.intro,'SALMON NIGIRI.');assert.equal(read.recipes[0].name,'INCA BASE');assert.equal(read.source,'Manual page 6.');
 assert.equal(dishDescription(composeDishDescription('Fish','Lime and salt','')).recipes[0].details,'Lime and salt');
});
