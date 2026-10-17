import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coreFields,hiddenCore,cardFields,shownFields,hiddenFields,canDeleteField,cardEntries,detailsToSave,answerCount,checkNewField,newFieldRow,withHidden,newFieldKey,isCustomKey,MAX_CUSTOM_FIELDS} from '../lib/card-fields.ts';
import type {CardFieldRow} from '../lib/card-fields.ts';

const row=(over:Partial<CardFieldRow>={}):CardFieldRow=>
 ({content_type:'cocktails',field_key:'x_aaaa0001',custom:true,label:'Garnish',kind:'line',hidden:false,on_card:true,show_team:true,sort_order:1,...over});
const ids=(list:{id:string}[])=>list.map(field=>field.id);

test('a restaurant with no settings sees the fields as shipped',()=>{
 assert.deepEqual(ids(cardFields('cocktails',[])),['spec','classification','method','glassware','notes','meaning','extra_fact']);
 assert.deepEqual(ids(cardFields('cocktails')),ids(cardFields('cocktails',[])));
 assert.equal(cardFields('food',[]).length,0);
 assert.ok(cardFields('wine',[]).every(field=>!field.hidden&&field.onCard&&field.showTeam&&!field.custom));
});

test('hiding a shipped field removes it from the form but keeps it listed as hidden',()=>{
 const rows=[withHidden('cocktails',[],'glassware',true)];
 assert.ok(!ids(shownFields('cocktails',rows)).includes('glassware'));
 assert.deepEqual(ids(hiddenFields('cocktails',rows)),['glassware']);
 assert.equal(canDeleteField(hiddenFields('cocktails',rows)[0]),false,'a shipped field can never be deleted');
 const back=[withHidden('cocktails',rows,'glassware',false)];
 assert.ok(ids(shownFields('cocktails',back)).includes('glassware'));
});

test('a restaurant\'s own fields follow the shipped ones, in saved order, and only in their library',()=>{
 const rows=[row({field_key:'x_bbbb0002',label:'Smoke',sort_order:2}),row(),row({content_type:'wine',field_key:'x_cccc0003',label:'Cellar'})];
 assert.deepEqual(cardFields('cocktails',rows).slice(-2).map(field=>field.label),['Garnish','Smoke']);
 assert.equal(cardFields('wine',rows).at(-1)?.label,'Cellar');
 assert.equal(cardFields('food',rows).length,0);
});

test('a field only becomes deletable once it is both the restaurant\'s own and hidden',()=>{
 const own=cardFields('cocktails',[row()]).find(field=>field.id==='x_aaaa0001')!;
 assert.equal(canDeleteField(own),false);
 const hidden=cardFields('cocktails',[row({hidden:true})]).find(field=>field.id==='x_aaaa0001')!;
 assert.equal(canDeleteField(hidden),true);
});

test('rows that cannot be shown are ignored rather than breaking the card',()=>{
 const shipped=cardFields('cocktails',[]).length;
 const rows=[row({label:null}),row({field_key:'glass2'}),row({label:'  '})];
 assert.equal(cardFields('cocktails',rows).length,shipped);
});

test('cards show filled fields only, and card/team switches are respected',()=>{
 const rows=[row({show_team:false}),row({field_key:'x_bbbb0002',label:'Smoke',sort_order:2,on_card:false}),withHidden('cocktails',[],'notes',true)];
 const details={method:'Stirred',glassware:'  ',x_aaaa0001:'Orange peel',x_bbbb0002:'Cherry wood',notes:'hidden but kept'};
 assert.deepEqual(cardEntries('cocktails',details,rows,'team').map(entry=>entry.field.id),['method','x_bbbb0002']);
 assert.deepEqual(cardEntries('cocktails',details,rows,'card').map(entry=>entry.field.id),['method','x_aaaa0001']);
 assert.deepEqual(cardEntries('cocktails',null,rows),[]);
});

test('saving a dish never erases what a hidden field holds',()=>{
 const rows=[withHidden('cocktails',[],'glassware',true)];
 const form:Record<string,string>={method:' Shaken ',spec:''};
 const saved=detailsToSave('cocktails',id=>form[id]??null,{glassware:'Rocks',spec:'old spec',x_gone:'orphan'},rows);
 assert.equal(saved.glassware,'Rocks');
 assert.equal(saved.method,'Shaken');
 assert.ok(!('spec' in saved),'clearing a shown field clears it');
 assert.ok(!('x_gone' in saved),'answers of fields that no longer exist are dropped, as before');
 assert.ok(!('reviewed_by' in detailsToSave('cocktails',()=>null,{reviewed_by:'Gaby'},rows)),'the review stamp is never carried over');
});

test('a new field is checked before it is added',()=>{
 assert.equal(checkNewField('cocktails',[],'  '),'Give the field a name.');
 assert.match(checkNewField('cocktails',[],'x'.repeat(41))!,/under 40/);
 assert.match(checkNewField('cocktails',[],'glassware')!,/already a field/);
 assert.match(checkNewField('cocktails',[withHidden('cocktails',[],'glassware',true)],'Glassware')!,/hidden.*Show it again/);
 assert.equal(checkNewField('cocktails',[],'Pairs   with'),null);
 assert.equal(checkNewField('food',[],'Glassware'),null,'another library may reuse the name');
 const full=Array.from({length:MAX_CUSTOM_FIELDS},(_,i)=>row({field_key:`x_aaaa${String(i).padStart(4,'0')}`,label:`F${i}`,sort_order:i}));
 assert.match(checkNewField('cocktails',full,'One more')!,/up to 12/);
});

test('a new field gets a safe key, a clean name and the next place in line',()=>{
 let n=0;
 const next=()=>((n++)%16)/16;
 const made=newFieldRow('cocktails',[row({sort_order:4})],{label:'  Pairs   with ',kind:'text',onCard:false,showTeam:true},next);
 assert.equal(made.label,'Pairs with');
 assert.equal(made.sort_order,5);
 assert.ok(made.custom&&isCustomKey(made.field_key)&&/^x_[0-9a-f]{8}$/.test(made.field_key));
 assert.equal(made.on_card,false);
 assert.notEqual(newFieldKey(),newFieldKey());
 const taken=newFieldRow('cocktails',[row({field_key:made.field_key})],{label:'A',kind:'line',onCard:true,showTeam:true},(()=>{let k=0;return()=>((k++)%16)/16})());
 assert.notEqual(taken.field_key,made.field_key);
});

test('the warning before a delete counts only the dishes that have an answer in that library',()=>{
 const items=[
  {content_type:'cocktails',details:{x_aaaa0001:'a'}},{content_type:'cocktails',details:{x_aaaa0001:'  '}},
  {content_type:'cocktails',details:null},{content_type:'wine',details:{x_aaaa0001:'b'}},{content_type:'cocktails',details:{x_aaaa0001:'c'}},
 ];
 assert.equal(answerCount(items,'cocktails','x_aaaa0001'),2);
 assert.equal(answerCount(items,'wine','x_aaaa0001'),1);
 assert.equal(answerCount([{details:{x_aaaa0001:'d'}}],'food','x_aaaa0001'),1,'a dish with no library counts as food');
});

test('the optional price, time, notes and sauce parts can be hidden, and the locked ones are not on the list',()=>{
 assert.deepEqual(coreFields('food',[]).map(field=>field.id),['price','fire','price_label','table_setting','observations','sauce']);
 assert.deepEqual(coreFields('wine',[]).map(field=>field.id),['price','price_label','table_setting','observations'],'wines have no fire time or sauces');
 assert.equal(coreFields('cocktails',[]).find(field=>field.id==='fire')?.label,'Elaboration time');
 for(const locked of ['name','category','photo','description','ingredients','allergens']) assert.ok(!coreFields('food',[]).some(field=>field.id===locked),locked+' stays locked');
 assert.equal(hiddenCore('food',[]).size,0);
 const rows=[withHidden('food',[],'price',true),withHidden('food',[],'sauce',true),withHidden('cocktails',[],'observations',true)];
 assert.deepEqual([...hiddenCore('food',rows)].sort(),['price','sauce']);
 assert.deepEqual([...hiddenCore('cocktails',rows)],['observations'],'another library is unaffected');
 assert.ok(coreFields('food',rows).filter(field=>field.hidden).every(field=>!field.custom),'built-in extras are never deletable');
});
