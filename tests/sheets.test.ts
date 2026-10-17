import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measure,wrap,transliterate,readJpeg,Sheet} from '../lib/pdf.ts';
import {dishCard,quizSheet,standardSheet,preshiftSheet,allergySheet,employeeSheet,wordsSheet,guideSheet,storySheet,slug,printDate} from '../lib/sheets.ts';
import type {CustomTerm} from '../lib/glossary.ts';
import type {MenuItem} from '../lib/menu.ts';
import {withHidden} from '../lib/card-fields.ts';
import type {CardFieldRow} from '../lib/card-fields.ts';

const ctx={restaurant:'Osaka',printed:new Date('2026-10-02T12:00:00Z')};
const item=(over:Partial<MenuItem>={}):MenuItem=>
 ({id:'1',restaurant_id:'1',name:'Dish',description:'',ingredients:[],allergens:[],photo_path:null,...over});
const text=(bytes:Uint8Array)=>String.fromCharCode(...bytes);
const isPdf=(bytes:Uint8Array)=>text(bytes.slice(0,8))==='%PDF-1.4'&&text(bytes.slice(-7)).trim()==='%%EOF';

test('every sheet produces a file a reader will open',()=>{
 const sheets=[
  dishCard({item:item({name:'Wasabi Ceviche',description:'Corvina, lime',ingredients:['Corvina'],allergens:['Fish']})},ctx),
  quizSheet({itemName:'Wasabi Ceviche',answers:true,questions:[{prompt:'Which fish?',options:['Corvina','Salmon'],correct:0}]},ctx),
  quizSheet({itemName:'Wasabi Ceviche',answers:false,questions:[{prompt:'Which fish?',options:['Corvina','Salmon'],correct:0}]},ctx),
  standardSheet({title:'Otoshi',steps:['Greet','Serve']},ctx),
  preshiftSheet({serviceDate:'2026-10-02',focus:['Ceviche'],groups:[{label:"86'd",entries:[{name:'Toro',status:'86'}]}]},ctx),
  allergySheet({allergies:['Shellfish'],items:[item({name:'Ebi',allergens:['Shellfish']})]},ctx),
 ];
 for(const sheet of sheets){
  assert.ok(isPdf(sheet.bytes),`${sheet.filename} is not a PDF`);
  assert.ok(sheet.bytes.length>500,`${sheet.filename} is suspiciously small`);
  assert.match(sheet.filename,/^[a-z0-9-]+\.pdf$/);
 }
});

test('a sheet names itself so thirty of them in a folder are still readable',()=>{
 assert.equal(dishCard({item:item({name:'Pisco Sour · Keró!'})},ctx).filename,'pisco-sour-kero.pdf');
 assert.equal(quizSheet({itemName:'Wasabi Ceviche',answers:true,questions:[{prompt:'q',options:['a'],correct:0}]},ctx).filename,'wasabi-ceviche-quiz-answers.pdf');
 assert.equal(quizSheet({itemName:'Wasabi Ceviche',answers:false,questions:[{prompt:'q',options:['a'],correct:0}]},ctx).filename,'wasabi-ceviche-quiz.pdf');
 assert.equal(standardSheet({title:'Otoshi',steps:[]},ctx).filename,'otoshi-standard.pdf');
 assert.equal(preshiftSheet({serviceDate:'2026-10-02',focus:[],groups:[]},ctx).filename,'preshift-2026-10-02.pdf');
 assert.equal(allergySheet({allergies:['Shellfish'],items:[]},ctx).filename,'allergy-shellfish-2026-10-02.pdf');
 assert.equal(slug('———'),'heat');
});

test('a quiz with no stored answers cannot be printed as a trainer copy',()=>{
 // Asking for answers on a quiz that has none must not produce a sheet claiming
 // to be marked. It falls back to the blank copy, filename and all.
 const sheet=quizSheet({itemName:'Nothing',answers:true,questions:[{prompt:'q',options:['a','b']}]},ctx);
 assert.equal(sheet.filename,'nothing-quiz.pdf');
});

test('an item with nothing recorded is printed as unknown, never as safe',()=>{
 const bytes=dishCard({item:item({name:'Mystery',allergens:[]})},ctx).bytes;
 // The warning is drawn as text in the content stream, so it is in the bytes.
 assert.ok(text(bytes).includes('not the same as safe'));
});

test('both dates reach the paper',()=>{
 const bytes=dishCard({item:item({name:'Dish',updated_at:'2026-09-28T10:00:00Z'})},ctx).bytes;
 const body=text(bytes);
 assert.ok(body.includes('Printed 2 Oct 2026'));
 assert.ok(body.includes('28 Sep 2026'));
 assert.equal(printDate('not a date'),'');
});

test('text wraps on real letter widths and never runs off the paper',()=>{
 const width=400;
 for(const line of wrap('Corvina cured in a wasabi leche de tigre with sweet potato and choclo','regular',10,width)){
  assert.ok(measure(line,'regular',10)<=width);
 }
 assert.equal(wrap('one\ntwo','regular',10,500).length,2,'a typed newline is a line');
 assert.ok(wrap('x'.repeat(300),'regular',10,100).length>1,'an unbreakable word is cut rather than lost');
 assert.ok(measure('W','bold',10)>measure('i','bold',10));
});

test('letters the typeface cannot set are folded, not dropped',()=>{
 assert.equal(transliterate('shōyu'),'shoyu');
 assert.equal(transliterate('Perú jalapeño'),'Perú jalapeño');
 assert.equal(transliterate('aあb'),'ab','a letter with no fold is left out rather than drawn as rubbish');
});

test('a photograph is embedded only when it is really a photograph',()=>{
 assert.equal(readJpeg(new Uint8Array([1,2,3,4])),null);
 assert.equal(readJpeg(new Uint8Array(0)),null);
 const jpeg=new Uint8Array([0xff,0xd8,0xff,0xc0,0,17,8,0,200,1,44,3,1,0x11,0,2,0x11,1,3,0x11,1]);
 assert.deepEqual(readJpeg(jpeg)&&{w:readJpeg(jpeg)!.width,h:readJpeg(jpeg)!.height,gray:readJpeg(jpeg)!.gray},{w:300,h:200,gray:false});
});

test('long content flows onto more paper instead of falling off the page',()=>{
 const long='Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
 const sheet=standardSheet({title:'Long',summary:long,steps:Array.from({length:30},(_,i)=>`${long.slice(0,100)} (${i})`)},ctx);
 assert.ok(isPdf(sheet.bytes));
 assert.ok(Number(/\/Type \/Pages \/Count (\d+)/.exec(text(sheet.bytes))![1]) > 1);
});

test('an empty everything still produces a sheet rather than throwing',()=>{
 assert.ok(isPdf(dishCard({item:item({name:''})},ctx).bytes));
 assert.ok(isPdf(quizSheet({itemName:'',answers:true,questions:[]},ctx).bytes));
 assert.ok(isPdf(standardSheet({title:'',steps:[]},ctx).bytes));
 assert.ok(isPdf(preshiftSheet({serviceDate:'2026-10-02',focus:[],groups:[]},ctx).bytes));
 assert.ok(isPdf(allergySheet({allergies:[],items:[]},ctx).bytes));
});

test('a one page sheet does not say "1 of 1"',()=>{
 const sheet=new Sheet({restaurant:'Osaka',kind:'Standard',printed:'2 Oct 2026'});
 sheet.body('short');
 assert.ok(!text(sheet.finish('t')).includes('1 of 1'));
});

test('a sheet names itself correctly in a viewer, not in the wrong encoding',()=>{
 // The Info dictionary is read as PDFDocEncoding, where the WinAnsi em dash is
 // Scaron — every sheet used to be called "Name S-caron card" in the title bar.
 const bytes=dishCard({item:item({name:'Tsurami Brasa'})},ctx).bytes;
 const body=text(bytes);
 assert.ok(body.includes('/Title <FEFF'),'the title is not a UTF-16 string');
 assert.ok(!/\/Title\s*\(/.test(body),'the title is still a literal string');
 // "Tsurami Brasa — card", spelled out in UTF-16BE.
 assert.ok(body.includes('0054007300750072'),'the title lost its text');
 assert.ok(body.includes('2014'),'the em dash did not survive');
});

test('a drink with nothing recorded says so quietly, and sends you to the bar',()=>{
 const drink=text(dishCard({item:item({name:'Kero Sour',content_type:'cocktails'})},ctx).bytes);
 assert.ok(drink.includes('None recorded'),'the drink says nothing about allergens');
 assert.ok(drink.includes('ask the bar'),'a bartender is told to ask the kitchen');
 assert.ok(!drink.includes('not the same as safe'),'the loud band is still on a drink');

 // A dish keeps the banner, and still points at the kitchen.
 const dish=text(dishCard({item:item({name:'Mystery'})},ctx).bytes);
 assert.ok(dish.includes('not the same as safe'));
 assert.ok(dish.includes('ask the kitchen'));

 // A drink that really does carry one gets the loud band back.
 const egg=text(dishCard({item:item({name:'Nikkei Sour',content_type:'cocktails',allergens:['Egg']})},ctx).bytes);
 assert.ok(egg.includes('ALLERGENS'),'a drink with an allergen lost its banner');
});

test('a cocktail spec preserves quantities and line order',()=>{
 const bytes=dishCard({item:item({
  name:'Chilcano',content_type:'cocktails',
  details:{spec:'2 oz pisco quebranta\n1 1/2 oz lime juice\nTop with ginger beer',glassware:'Highball'},
 })},ctx).bytes;
 const body=text(bytes);
 // Each pour keeps its quantity and ingredient together on a separate line.
 assert.ok(body.includes('(2 oz pisco quebranta) Tj'),'the first pour was lost');
 assert.ok(body.includes('(1 1/2 oz lime juice) Tj'),'the mixed fraction was lost');
 // A line that is not a pour is left whole rather than forced into a column.
 assert.ok(body.includes('(Top with ginger beer) Tj'),'a non-pour line was broken up');
});

test('what is said under the name is not said again further down',()=>{
 const body=text(dishCard({item:item({
  name:'Chilcano',content_type:'cocktails',
  details:{glassware:'Highball',method:'Built',classification:'Long drink',notes:'Roll once.'},
 })},ctx).bytes);
 // Each stored detail is printed once with its label.
 assert.equal(body.split('Highball').length-1,1,'the glass is printed twice');
 assert.ok(body.includes('Built') && body.includes('Long drink'),'service details were lost');
 assert.ok(body.includes('Roll once.'),'the notes were dropped with the headline fields');
});

test('a card draws only the rules that mean something',()=>{
 // Section headings used to carry a hairline each. A bold, dark, letter-spaced
 // line of capitals is already a heading; what is left is the header rule, the
 // rule below the allergens, and the footer.
 const bytes=dishCard({item:item({name:'Dish',allergens:['Fish'],ingredients:['Corvina'],
  description:'A dish.',observations:'Main kitchen.'})},ctx).bytes;
 const fills=text(bytes).match(/re f/g)??[];
 assert.ok(fills.length<=12,`expected a few rules, found ${fills.length}`);
});

test('a bottle leads with what you say, not with who made it',()=>{
 const body=text(dishCard({item:item({name:'Kikusui',content_type:'wine',
  details:{producer:'Kikusui Shuzo',region:'Niigata',grade:'Junmai Ginjo',serve:'Well chilled',
   tasting:'Pear and melon.',pairs:'Anything raw.',style:'Off-dry'}})},ctx).bytes);
 assert.ok(body.includes('WHAT TO SAY'),'the tasting notes are not given their own heading');
 // The three on the line under the name are not repeated in the list below.
 assert.equal(body.split('Niigata').length-1,1,'the region is printed twice');
 assert.equal(body.split('Well chilled').length-1,1,'the serving temperature is printed twice');
 // The producer is not on that line; it belongs in the list.
 assert.ok(!/\(Niigata[^)]*Kikusui Shuzo/.test(body),'the producer crept into the headline');
 assert.ok(body.includes('Kikusui Shuzo'),'the producer was dropped altogether');
});

test('card photos use a consistent box and retain their proportions',()=>{
 // A 30 by 40 photo must fit the 164-point box without stretching.
 const FIXTURE='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAoAB4DASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAYDBAX/xAAkEAACAQIEBwEAAAAAAAAAAAAAAQMCBBE0U3IUFSIxkqKx0f/EABgBAQEBAQEAAAAAAAAAAAAAAAEAAwIE/8QAGhEAAwEBAQEAAAAAAAAAAAAAAAEDEQISIf/aAAwDAQACEQMRAD8Amjp5fc6Xsv05ikOK0fGYemM13unh1WNxRS6qo8Eli+pHOUFzlpdj+E+Mu32voWmuGsBSE2acRPrSeTCk33hSop7p7lzlpdj+E+aOeZppy1tPunUzMZ8eEFaLt6gADUyAAIj/2Q==';
 // Decoded without Buffer: this file is type-checked by the app's build, where
 // Node's globals are not in scope.
 const binary=globalThis.atob(FIXTURE);
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
 const photo=readJpeg(bytes);
 // A plain throw rather than assert.ok, so the narrowing holds for the compiler
 // as well as at runtime: this file is type-checked by the app's build.
 if(!photo) throw new Error('the fixture is not a readable jpeg');
 assert.equal(photo.width,30);
 assert.equal(photo.height,40);
 const drawn=(spec:string)=>{
  const body=text(dishCard({item:item({name:'Drink',content_type:'cocktails',details:{spec}}),photo},ctx).bytes);
  const m=/q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm/.exec(body);
  assert.ok(m,'no picture was drawn');
  return {w:parseFloat(m![1]),h:parseFloat(m![2])};
 };
 const short=drawn('2 oz pisco');
 const long=drawn(Array.from({length:9},(_,i)=>`${i+1} oz something quite long indeed`).join('\n'));
 assert.equal(short.h,long.h,'photo size should be consistent across cards');
 assert.ok(short.h>=105,`the picture shrank past its floor: ${short.h}`);
 assert.ok(long.h<=164,`the picture grew past its box: ${long.h}`);
 // Whatever the size, it keeps its shape.
 assert.ok(Math.abs(short.w/short.h-long.w/long.h)<0.001,'the picture was stretched');
});


// Validate the generated drawing operations, including continuation pages.
const pdfText = (bytes:Uint8Array) => new TextDecoder('latin1').decode(bytes);
const pages = (bytes:Uint8Array) => Number(/\/Type \/Pages \/Count (\d+)/.exec(pdfText(bytes))![1]);
function checkPlainBounds(bytes:Uint8Array) {
 const body=pdfText(bytes);
 for(const match of body.matchAll(/\/(F\d) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) {
  assert.ok(Number(match[2])>=6 && Number(match[2])<=24,'text stays between the smallest label and the title size');
  assert.ok(Number(match[3])>=48 && Number(match[3])<565,'text starts within the margins');
  assert.ok(Number(match[4])>=25 && Number(match[4])<=760,'text stays above the footer and below the header');
 }
}

test('food uses Letter paper, retains numeric prices and legacy recipe/service data',()=>{
 const bytes=dishCard({item:item({name:'Reference',price:40,fire_minutes:10,category:'Dinner',
 description:'Guest description.\nObservations: Legacy observation.\nSauces and component recipes:\nSauce: Original recipe.\nSource: Original manual.',
 table_setting:'Spoon',observations:'Current observation.',ingredients:['Rice'],allergens:['Fish','Sesame (CC)']})},ctx).bytes;
 const body=pdfText(bytes);
 assert.match(body,/MediaBox \[0 0 612 792\]/);
 for(const value of ['PRICE','$40','FIRE TIME','10 min','Original recipe.','Original manual.','Legacy observation.','Current observation.','cross-contamination']) assert.ok(body.includes(value),value);
 assert.equal(pages(bytes),1);checkPlainBounds(bytes);
});

test('long food descriptions and names continue without reducing the font',()=>{
 const bytes=dishCard({item:item({name:'An unusually long dish name '.repeat(6),description:'Detailed preparation notes. '.repeat(300),ingredients:['Final ingredient'],observations:'Last service instruction'})},ctx).bytes;
 assert.ok(pages(bytes)>1);checkPlainBounds(bytes);
 const body=pdfText(bytes);assert.ok(body.includes('Final ingredient'));assert.ok(body.includes('Last service instruction'));
});

test('all allergy statuses survive and same-named dishes keep their own categories',()=>{
 const bytes=allergySheet({allergies:['Sesame'],items:[
 item({id:'a',name:'Shared name',category:'Starters',allergens:['Sesame']}),
 item({id:'b',name:'Shared name',category:'Mains',allergens:['Sesame']}),
 item({id:'c',name:'Cross',allergens:['Sesame (CC)'],ingredients:['Rice']}),
 item({id:'d',name:'Unknown'}),
 item({id:'e',name:'No match',allergens:['Fish'],ingredients:['Rice']}),
 ]},ctx).bytes;
 const body=pdfText(bytes);
 for(const value of ['DO NOT SERVE','CROSS-CONTAMINATION','ASK THE KITCHEN','NO RECORDED MATCH','Starters','Mains'])assert.ok(body.includes(value),value);
 assert.equal((body.match(/\(Shared name\) Tj/g)||[]).length,2);
 checkPlainBounds(bytes);
});

test('large allergy lists retain every item and repeat their status across pages',()=>{
 const items=Array.from({length:400},(_,i)=>item({id:String(i),name:`UniqueItem${i}`,category:i<350?'Large category':'Other category',allergens:['Sesame']}));
 const bytes=allergySheet({allergies:['Sesame'],items},ctx).bytes;
 assert.ok(pages(bytes)>1);checkPlainBounds(bytes);
 const body=pdfText(bytes);
 for(let i=0;i<400;i++)assert.equal((body.match(new RegExp(`\\(UniqueItem${i}\\) Tj`,'g'))||[]).length,1,`item ${i} retained exactly once`);
 assert.equal((body.match(/DO NOT SERVE \//g)||[]).length,pages(bytes),'status repeats on each continuation page');
});

test('long allergy/category names wrap instead of running into the next column',()=>{
 const bytes=allergySheet({allergies:['Sesame'],items:Array.from({length:30},(_,i)=>item({id:String(i),name:`Dish ${i} with several long words and detailed preparation`,category:'A longer restaurant-specific category title',allergens:['Sesame']}))},ctx).bytes;
 checkPlainBounds(bytes);assert.ok(pdfText(bytes).includes('category'));
});

test('ordinary multiline dish names stay on one allergy page',()=>{
 const items=Array.from({length:350},(_,i)=>item({id:String(i),name:`Item ${i} with a long descriptive name and garnish`,category:`Category ${i%10}`,ingredients:['Rice'],allergens:i%3?['Sesame']:['Fish']}));
 const bytes=allergySheet({allergies:['Sesame'],items},ctx).bytes;
 const streams=[...pdfText(bytes).matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match=>[...match[1].matchAll(/\(([^()]*)\) Tj/g)].map(row=>row[1]).join(' '));
 for(const entry of items)assert.ok(streams.some(stream=>stream.includes(entry.name)),`${entry.name} split or lost`);
 checkPlainBounds(bytes);
});


const word=(over:Partial<CustomTerm>={}):CustomTerm=>({id:'1',term:'Miso',say:'MEE-soh',means:'Fermented soybean paste.',note:'Soy',also:['Miso paste'],hidden:false,story:'Made by fermentation.',photo_path:'',...over});

test('beverage exports preserve every detail and use the plain Letter layout',()=>{
 for(const content_type of ['cocktails','wine'] as const){
  const details:Record<string,string>=content_type==='cocktails'
   ? {spec:'2 oz pisco\n1 oz lime',method:'Shaken',glassware:'Coupe',classification:'Sour',notes:'Dry shake',meaning:'A story',extra_fact:'A fact'}
   : {producer:'Maker',region:'Niigata',vintage:'NV',grade:'Junmai',polish:'50%',style:'Dry',body:'Light',serve:'Chilled',tasting:'Pear',pairs:'Fish',extra_fact:'A fact'};
  const bytes=dishCard({item:item({content_type,details,price:24,observations:'Serve promptly',table_setting:'Napkin'})},ctx).bytes;
  checkPlainBounds(bytes);
  assert.ok(pdfText(bytes).includes('/MediaBox [0 0 612 792]'));
  for(const value of Object.values(details)) for(const line of value!.split('\n')) assert.ok(pdfText(bytes).includes(line),line);
  assert.ok(pdfText(bytes).includes('Serve promptly'));
 }
});

test('all words are alphabetized, complete, and paginate without hidden entries or stories',()=>{
 const words=Array.from({length:80},(_,i)=>word({id:String(i),term:`Term ${String(i).padStart(3,'0')}`,means:`Definition ${i}. `+'Some useful explanation. '.repeat(8)})).reverse();
 words.push(word({term:'HIDDENWORD',hidden:true}));
 const bytes=wordsSheet(words,ctx).bytes;
 checkPlainBounds(bytes); assert.ok(pages(bytes)>1);
 const body=pdfText(bytes);
 for(let i=0;i<80;i++) assert.equal(body.split(`(Term ${String(i).padStart(3,'0')}) Tj`).length-1,1);
 assert.ok(body.indexOf('(Term 000)')<body.indexOf('(Term 079)'));
 assert.ok(!body.includes('HIDDENWORD')); assert.ok(!body.includes('Made by fermentation'));
 assert.ok(body.includes('Other spellings:')); assert.ok(body.includes('Allergens:'));
});

test('individual guides and standards keep long content and consistent text size',()=>{
 const story='A full paragraph explaining this ingredient. '.repeat(100)+' ENDOFGUIDE';
 const guide=guideSheet({word:word({story})},ctx);
 checkPlainBounds(guide.bytes); assert.ok(pages(guide.bytes)>1);
 assert.ok(pdfText(guide.bytes).includes('ENDOFGUIDE'));
 assert.equal(guide.filename,'miso-guide.pdf');
 const standard=standardSheet({title:'Service',steps:Array.from({length:45},(_,i)=>`Instruction ${i}: `+'Keep the table ready. '.repeat(8))},ctx);
 checkPlainBounds(standard.bytes); assert.ok(pages(standard.bytes)>1);
 assert.ok(pdfText(standard.bytes).includes('Instruction 44:'));
});

test('matching quiz copies preserve questions while blank copies never disclose answers',()=>{
 const questions=Array.from({length:18},(_,i)=>({prompt:`Question ${i}`,topic:'Service',options:['First choice','Second choice'],correct:1,explanation:`PRIVATEANSWER ${i}`}));
 const blank=quizSheet({itemName:'Training',questions,answers:false},ctx);
 const trainer=quizSheet({itemName:'Training',questions,answers:true},ctx);
 for(const sheet of [blank,trainer]) {checkPlainBounds(sheet.bytes);assert.ok(pages(sheet.bytes)>1);assert.ok(pdfText(sheet.bytes).includes('Question 17'));}
 assert.ok(!pdfText(blank.bytes).includes('PRIVATEANSWER'));
 assert.ok(!pdfText(blank.bytes).includes(' - correct'));
 assert.ok(pdfText(trainer.bytes).includes('PRIVATEANSWER 17'));
 assert.ok(pdfText(trainer.bytes).includes('Second choice - correct'));
 const invalid=quizSheet({itemName:'Unknown',answers:true,questions:[{prompt:'Q',options:['A'],correct:-1}]},ctx);
 assert.equal(invalid.filename,'unknown-quiz.pdf');
});

test('employee summary reports current results without inventing attempt history',()=>{
 const input={name:'Alex',role:'Server',owner:false,access:['Words & Guides'],items:[item({id:'a',name:'Ceviche'}),item({id:'b',name:'Sour',content_type:'cocktails'})],results:[{menu_item_id:'a',item_name:'Ceviche',attempt_count:2,correct:3,total:5,created_at:'2026-10-01T12:00:00Z'}],assignments:[{menu_item_id:'b',item_name:'Sour',note:'Study the spec',due_on:'2026-10-10'}]};
 const sheet=employeeSheet(input,ctx),body=pdfText(sheet.bytes);
 checkPlainBounds(sheet.bytes);assert.equal(pages(sheet.bytes),1,'the summary fits one page');
 for(const value of ['1 of 2','60%','Study the spec','2026-10-10','Ceviche','Sour','COACHING NOTES','QUIZZES NOT YET COMPLETED','No quiz yet']) assert.ok(body.includes(value),value);
 assert.ok(body.includes('2x'));
 assert.ok(!body.includes('continued'));
 const updated=employeeSheet({...input,results:[{...input.results[0],correct:5,needs_review:true}],assignments:[{...input.assignments[0],menu_item_id:'a'}]},ctx);
 const changed=pdfText(updated.bytes);
 assert.ok(changed.includes('Was 5/5'));
 assert.ok(changed.includes('Review needed'));
 assert.ok(changed.includes('0 of 1 passed'));
 assert.ok(changed.includes('1 of 2'));
 const empty=employeeSheet({...input,items:[],results:[],assignments:[]},ctx);
 assert.equal(pages(empty.bytes),1);assert.ok(pdfText(empty.bytes).includes('None yet'));
});

test('pending employee quizzes stay readable across pages with long names',()=>{
 const items=Array.from({length:111},(_,i)=>item({id:String(i),name:`Menu item ${String(i).padStart(3,'0')} ${i%7===0?'with an unusually long name that wraps within its own column':''}`,category:i%2?'Ceviches':'Nigiri',content_type:i<70?'food':i<98?'cocktails':'wine'}));
 const bytes=employeeSheet({name:'Alex',role:'Server',owner:false,access:[],items,results:[],assignments:[]},ctx).bytes;
 checkPlainBounds(bytes);
 const body=pdfText(bytes);
 assert.ok(pages(bytes)<=3,'111 waiting quizzes stay readable in a few pages');
 assert.ok(body.includes('QUIZZES NOT YET COMPLETED'));
 assert.ok(body.includes('Wine & sake'));
 for(let i=0;i<111;i++) assert.equal(body.split(`Menu item ${String(i).padStart(3,'0')}`).length-1,1);
});

test('pre-shift matches the 11pt Letter style and preserves board details and service date',()=>{
 const bytes=preshiftSheet({serviceDate:'2026-10-05',postedBy:'Alex',updated:'2026-10-04T12:00:00Z',
  note:'Review reservations before service.',focus:['Seasonal tasting menu'],groups:[
   {label:"86'd",entries:[{name:'Toro',status:'86',detail:'Unavailable tonight'}]},
   {label:'Low count',entries:[{name:'Ceviche',status:'low',detail:'Only 8 portions'}]},
   {label:'Changed',entries:[{name:'Sour',status:'changed',detail:'New garnish'}]},
   {label:'New',entries:[{name:'Sake flight',status:'new',detail:'Offer with tasting menu'}]},
  ]},ctx).bytes;
 const body=pdfText(bytes);
 checkPlainBounds(bytes);assert.equal(pages(bytes),1);
 assert.ok(body.includes('/MediaBox [0 0 612 792]'));
 for(const value of ['5 Oct 2026','Posted by Alex','Review reservations before service.',"Tonight's focus",'Seasonal tasting menu',"86'd",'Toro','Unavailable tonight','Low count','Only 8 portions','Changed','New garnish','Sake flight','Offer with tasting menu','Content last updated 4 Oct 2026']) assert.ok(body.includes(value),value);
});

test('long pre-shift groups repeat their status and preserve all entries across pages',()=>{
 const entries=Array.from({length:40},(_,i)=>({name:`Item ${i}`,status:'low',detail:`Detail ${i}: ${'Confirm portions with the kitchen. '.repeat(i===20?70:3)}END${i}`}));
 const bytes=preshiftSheet({serviceDate:'2026-10-05',note:'Manager briefing',focus:[],groups:[{label:'Low count',entries}]},ctx).bytes;
 checkPlainBounds(bytes);assert.ok(pages(bytes)>1);
 const body=pdfText(bytes);
 for(let i=0;i<40;i++){assert.ok(body.includes(`Item ${i}`));assert.ok(body.includes(`END${i}`));}
 const streams=[...body.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match=>match[1]);
 for(const stream of streams.slice(1)) assert.ok(stream.includes('Low count \\(continued\\)'), 'status remains clear on every continuation');
});

test('our story prints one topic or all of them, grouped, without losing a paragraph',()=>{
 const one=storySheet({topics:[{title:'Our concept',section:'The restaurant',body:'First paragraph.\n\nSecond paragraph.'}]},ctx);
 assert.equal(one.filename,'our-concept-our-story.pdf');
 const oneBody=pdfText(one.bytes);
 checkPlainBounds(one.bytes);assert.equal(pages(one.bytes),1);
 for(const value of ['Our concept','The restaurant','First paragraph.','Second paragraph.','OUR STORY'])assert.ok(oneBody.includes(value),value);
 const topics=[
  {title:'Concept',section:'The restaurant',body:'Para. '.repeat(400)+'ENDCONCEPT'},
  {title:'The chefs',section:'The people',body:'Chefs. '.repeat(300)+'ENDCHEFS'},
  {title:'Loose',body:'No group. ENDLOOSE'},
 ];
 const all=storySheet({topics},ctx);
 assert.equal(all.filename,'osaka-our-story.pdf');
 const body=pdfText(all.bytes);
 checkPlainBounds(all.bytes);assert.ok(pages(all.bytes)>1);
 for(const value of ['Our story','3 topics','The restaurant','The people','More','Concept','The chefs','Loose','ENDCONCEPT','ENDCHEFS','ENDLOOSE'])assert.ok(body.includes(value),value);
 assert.ok(isPdf(storySheet({topics:[]},ctx).bytes),'an empty story still prints');
});

test('an allergy sheet shrinks to stay on one page for a long menu and keeps every item',()=>{
 const items=Array.from({length:120},(_,i)=>item({id:String(i),name:`Plate ${String(i).padStart(3,'0')}`,category:`Category ${i%9}`,ingredients:['Rice'],allergens:i<4?['Sesame']:['Fish']}));
 const bytes=allergySheet({allergies:['Sesame'],items},ctx).bytes;
 assert.equal(pages(bytes),1,'120 items fit on one page');
 checkPlainBounds(bytes);
 const body=pdfText(bytes);
 for(let i=0;i<120;i++)assert.equal((body.match(new RegExp(`\\(Plate ${String(i).padStart(3,'0')}\\) Tj`,'g'))||[]).length,1,`plate ${i} printed once`);
 for(const value of ['DO NOT SERVE','NO RECORDED MATCH'])assert.ok(body.includes(value),value);
});

test('the printed card follows the restaurant\'s card-field settings',()=>{
 const drink=item({name:'Negroni Kunsei',content_type:'cocktails',category:'Signature',description:'A smoky take.',ingredients:['Gin'],allergens:['None'],details:{glassware:'Rocksglass',method:'StirredMethod',x_aaaa0001:'NikuPairing'}});
 const own=(over:Partial<CardFieldRow>={}):CardFieldRow=>({content_type:'cocktails',field_key:'x_aaaa0001',custom:true,label:'Pairs with',kind:'line',hidden:false,on_card:true,show_team:true,sort_order:1,...over});
 const printed=(cardFields?:CardFieldRow[])=>text(dishCard({item:drink,cardFields},ctx).bytes);
 const plain=printed();
 assert.ok(plain.includes('Rocksglass')&&plain.includes('StirredMethod'),'no settings prints the fields as shipped');
 assert.ok(!plain.includes('NikuPairing'),'a field nobody has set up is not invented');
 assert.ok(!printed([withHidden('cocktails',[],'glassware',true)]).includes('Rocksglass'),'a hidden field stays off the paper');
 assert.ok(printed([own()]).includes('NikuPairing'),'a field the restaurant added prints');
 assert.ok(!printed([own({hidden:true})]).includes('NikuPairing'),'a hidden one does not');
 assert.ok(!printed([own({on_card:false})]).includes('NikuPairing'),'one not marked print-on-card does not');
});

test('the printed card leaves out the built-in extras a restaurant has hidden',()=>{
 const base={name:'Wasabi Ceviche',content_type:'food' as const,category:'Ceviches',description:'Corvina, lime\n\nSauces and component recipes:\nLeche de tigre: lime, aji',ingredients:['Corvina'],allergens:['Fish'],price:87.25,fire_minutes:41,table_setting:'TableSpoonSet',observations:'ObservedNote'};
 const plainDish=item(base);
 const labelled=item({...base,price_label:'LabelMarket'});
 const printed=(dish:MenuItem,ids:string[]=[])=>text(dishCard({item:dish,cardFields:ids.map(id=>withHidden('food',[],id,true))},ctx).bytes);
 const plain=printed(plainDish);
 for(const shown of ['87.25','41 min','TableSpoonSet','ObservedNote','Leche de tigre']) assert.ok(plain.includes(shown),shown+' prints by default');
 assert.ok(!printed(plainDish,['price']).includes('87.25'),'price');
 assert.ok(!printed(plainDish,['fire']).includes('41 min'),'fire time');
 assert.ok(!printed(plainDish,['table_setting']).includes('TableSpoonSet'),'table setting');
 assert.ok(!printed(plainDish,['observations']).includes('ObservedNote'),'observations');
 assert.ok(!printed(plainDish,['sauce']).includes('Leche de tigre'),'sauce breakdown');
 assert.ok(printed(labelled).includes('LabelMarket'),'the label prints by default');
 const noLabel=printed(labelled,['price_label']);
 assert.ok(!noLabel.includes('LabelMarket')&&noLabel.includes('87.25'),'a hidden label falls back to the plain price');
});
