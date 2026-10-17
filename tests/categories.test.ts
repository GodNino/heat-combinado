import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterContent, categoryOf } from '../lib/categories.ts';
test('the libraries stay separate across search and section filtering', () => {
 const items=[{name:'Lime ceviche',description:'Citrus',ingredients:['Lime'],category:'Starters'},{name:'Lime sour',description:'Citrus',ingredients:['Lime'],category:'Signature',content_type:'cocktails'}];
 assert.deepEqual(filterContent(items,'All','lime','food').map(i=>i.name),['Lime ceviche']);
 assert.deepEqual(filterContent(items,'Signature','lime','cocktails').map(i=>i.name),['Lime sour']);
 assert.equal(filterContent(items,'Starters','','cocktails').length,0);
});
test('a section is whatever the restaurant calls it, and a blank one falls back to Other', () => {
 assert.equal(categoryOf({category:'Happy Hour'}),'Happy Hour');
 assert.equal(categoryOf({category:'  Negroni Week  '}),'Negroni Week');
 assert.equal(categoryOf({}),'Other');
 assert.equal(categoryOf({category:'   '}),'Other');
});
