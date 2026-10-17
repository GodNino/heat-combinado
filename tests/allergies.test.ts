import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessAllergy, assessAllergies, menuAllergies } from '../lib/allergies.ts';
import type { MenuItem } from '../lib/menu.ts';
const dish = (allergens: string[], ingredients = ['Rice'], description = 'Rice dish'): MenuItem => ({id:'1',restaurant_id:'1',name:'Dish',description,ingredients,allergens,photo_path:'photo.jpg'});
test('allergen aliases and cross-contamination remain blocked, including modifiable notes', () => {
  for (const note of ['Tree nut','Nuts']) assert.equal(assessAllergy(dish([note]),'Tree nuts').status,'avoid');
  // Cross-contact notes get their own tier, but must never come back as clear.
  for (const note of ['Tree nuts (CC)','Tree nuts (cross-contamination, modifiable)']) {
    assert.equal(assessAllergy(dish([note]),'Tree nuts').status,'cross-contact');
    assert.notEqual(assessAllergy(dish([note]),'Tree nuts').status,'no-match');
  }
  assert.equal(assessAllergy(dish(['Nuts']),'Peanuts').status,'avoid');
  assert.equal(assessAllergy(dish(['Shellfish']),'Fish').status,'no-match');
  assert.equal(assessAllergy(dish(['Finfish']),'Fish').status,'avoid');
  assert.equal(assessAllergy(dish(['Eggs']),'Egg').status,'avoid');
  assert.equal(assessAllergy(dish(['Sesame seeds/oil']),'Sesame').status,'avoid');
});
test('missing details never enter no-match results; recipe conflicts are blocked', () => {
  assert.equal(assessAllergy(dish([]),'Tree nuts').status,'unknown');
  assert.equal(assessAllergy(dish(['Egg'],['Ingredients not provided in the source menu.']),'Tree nuts').status,'unknown');
  assert.equal(assessAllergy(dish(['Soy'],['Rice'],'Sauce: almond slices'),'Tree nuts').status,'avoid');
  assert.equal(assessAllergy(dish(['Tree nuts'],[]),'Tree nuts').status,'avoid');
});
test('all menu labels available, aliases grouped, custom notes preserved', () => {
  const options = menuAllergies([dish(['Tree nut','Tree nuts','Nuts','Eggs','Egg (mayo)','Celery (CC)'])]);
  assert.equal(options.filter(x=>x==='Tree nuts').length,1);
  assert.ok(options.includes('Peanuts')); assert.ok(options.includes('Egg')); assert.ok(options.includes('Celery'));
  assert.equal(assessAllergy(dish(['Celery (CC)']),'Celery').status,'cross-contact');
});

test('multiple allergies use any-match blocking and all-clear intersection', () => {
  const choices = ['Tree nuts', 'Egg', 'Sesame'];
  assert.equal(assessAllergies(dish(['Egg']), choices).status, 'avoid');
  assert.equal(assessAllergies(dish(['Sesame (CC)']), choices).status, 'cross-contact');
  assert.equal(assessAllergies(dish(['Fish']), choices).status, 'no-match');
  assert.equal(assessAllergies(dish(['Fish'], []), choices).status, 'unknown');
  assert.equal(assessAllergies(dish(['Egg'], []), choices).status, 'avoid');
  assert.equal(assessAllergies(dish(['Egg']), []).status, 'unknown');
  const result = assessAllergies(dish(['Egg', 'Sesame (CC)']), choices);
  assert.ok(result.reasons.some(r => r.startsWith('Egg:')));
  assert.ok(result.reasons.some(r => r.startsWith('Sesame:')));
  assert.equal(assessAllergies(dish(['Egg']), ['Tree nuts']).status, 'no-match');
});

test('an ingredient match outranks cross-contact, and no reason is hidden', () => {
  const both = assessAllergies(dish(['Egg','Sesame (CC)']), ['Egg','Sesame']);
  assert.equal(both.status,'avoid');
  assert.ok(both.reasons.some(r => r.startsWith('Egg:')), 'ingredient reason kept');
  assert.ok(both.reasons.some(r => r.startsWith('Sesame:')), 'cross-contact reason still shown');
  assert.equal(assessAllergies(dish(['Sesame (CC)'],[]), ['Sesame']).status,'unknown','incomplete records outrank cross-contact');
});
test('cocktails await manual allergen review even when recipe mentions an allergen', () => {assert.equal(assessAllergies({...dish([],['Egg white']),content_type:'cocktails'},['Egg']).status,'unknown');});

// A verdict with no section on the Allergy screen makes the dish vanish from the results,
// which is how a cross-contamination note went unseen. Keep the screen and the verdicts in step.
test('every verdict the allergy check can return has a section on the Allergy screen', async () => {
  const [lib, page] = await Promise.all([
    readFile(new URL('../lib/allergies.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/workspace.tsx', import.meta.url), 'utf8'),
  ]);
  const union = lib.match(/status:\s*((?:'[a-z-]+'\s*\|\s*)+'[a-z-]+')/)![1];
  const verdicts = [...union.matchAll(/'([a-z-]+)'/g)].map(match => match[1]).sort();
  const body = page.slice(page.indexOf('const groupsByStatus'), page.indexOf('const groups = ('));
  const sections = [...body.matchAll(/"([a-z-]+)":\s*\{title:/g)].map(match => match[1]).sort();
  assert.deepEqual(sections, verdicts, 'each verdict needs its own section, or its dishes show nowhere');
});
