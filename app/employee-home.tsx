"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { learningStatus, summarizeLearning } from '@/lib/learning';
import type { MenuItem } from '@/lib/menu';
import { contentTypeOf, CONTENT_TYPES, categoryOf } from '@/lib/categories';
import { BookOpen } from 'lucide-react';
import { useTaxonomy } from './taxonomy';
import { supabase } from '@/lib/supabase';
import type { ProgressRow } from './quiz';
import { DownloadSheet } from './sheet-download';
import { preshiftSheet } from '@/lib/sheets';
import { SectionInfo } from './ui';
import { MyJobCard } from './checklist-card';

export const SHIFT_STATUS_LABELS = {"86": "86'd", low: "Low count", change: "Changed", new: "New"} as const;
export type ShiftBoardEntry = {menu_item_id: string; status: keyof typeof SHIFT_STATUS_LABELS; detail: string};
// A board is only ever today’s, so minutes and hours are the whole vocabulary.
export function shiftAge(at: string) {
 const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000);
 if (mins < 1) return 'just now';
 if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
 const hours = Math.round(mins / 60);
 return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}
export type ShiftBoardResponse = {service_date: string; board: {id: string; restaurant_id: string; service_date: string; note: string; focus_item_id: string | null; focus_item_ids?: string[] | null; entries: ShiftBoardEntry[]; posted_by?: string | null; posted_by_name?: string | null; created_at?: string | null; updated_at?: string | null} | null};

function EmployeeShiftBoard({restaurantId, items, onFocusQuiz, onBoardItem, canDownload, restaurantName}: {restaurantId: string; items: MenuItem[]; onFocusQuiz: (item: MenuItem) => void; onBoardItem: (item: MenuItem) => void; canDownload: boolean; restaurantName: string}) {
 const [data,setData]=useState<ShiftBoardResponse|null>(null);
 const [error,setError]=useState('');
 const sequence=useRef(0);
 const loadBoard=useCallback(async()=>{
  const request=++sequence.current;
  try {
   if(!supabase)return;
   const result=await supabase.rpc('get_preshift_board',{rid:restaurantId});
   if(result.error)throw new Error(result.error.message);
   if(request===sequence.current){setData(result.data as ShiftBoardResponse);setError('');}
  }catch(e){if(request===sequence.current){setData(null);setError(e instanceof Error?e.message:'Could not load today’s pre-shift board.');}}
 },[restaurantId]);
 useEffect(()=>{
  void loadBoard();
  const refresh=()=>{if(document.visibilityState==='visible')void loadBoard();};
  const timer=setInterval(refresh,60000);
  document.addEventListener('visibilitychange',refresh);
  return()=>{sequence.current++;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[loadBoard]);
 if(error)return <section className="panel mb-6 p-5"><p role="alert">Today’s pre-shift board could not load.</p><button className="mt-3 underline" onClick={()=>void loadBoard()}>Try again</button></section>;
 const board=data?.board;
 if(!board||board.restaurant_id!==restaurantId||board.service_date!==data?.service_date)return null;
 // A board the manager deleted is an empty row, not a missing one. Show nothing.
  // The board carries a list of focus items now; an older board still has the single one.
 const focusIds=board.focus_item_ids?.length?board.focus_item_ids:board.focus_item_id?[board.focus_item_id]:[];
 const focusItems=focusIds.map(id=>items.find(item=>item.id===id)).filter((item): item is MenuItem=>!!item);
 const postedBy=board.posted_by_name?.trim();
 // An edit made after posting is the one thing somebody who already read the board needs to see.
 const edited=!!board.created_at&&!!board.updated_at&&new Date(board.updated_at).getTime()-new Date(board.created_at).getTime()>60000;
 const stamped=board.updated_at?shiftAge(board.updated_at):'';
 if(!board.note.trim()&&!focusIds.length&&!board.entries.length)return null;
 return <section className="panel mb-7 p-5" aria-label="Today’s pre-shift board">
  <div className="flex items-start justify-between gap-3"><p className="eyebrow text-heat">Pre-shift board</p>{canDownload&&<DownloadSheet label="Download today’s board" build={async () => preshiftSheet({serviceDate: board.service_date, note: board.note, postedBy, updated: board.updated_at, focus: focusItems.map(item => item.name), groups: Object.entries(SHIFT_STATUS_LABELS).map(([status, label]) => ({label, entries: board.entries.filter(entry => entry.status === status).map(entry => ({name: items.find(item => item.id === entry.menu_item_id)?.name ?? "Menu item unavailable", status, detail: entry.detail}))}))}, {restaurant: restaurantName})} />}</div>
  <h2 className="mt-2 text-xl font-semibold"><time dateTime={board.service_date}>{new Date(`${board.service_date}T12:00:00Z`).toLocaleDateString(undefined,{dateStyle:'full',timeZone:'UTC'})}</time></h2>
  {(postedBy||stamped)&&<p className="muted mt-1 text-sm">{postedBy?`Posted by ${postedBy}`:'Posted'}{stamped&&<> · {edited?<span className="font-semibold text-heat">updated {stamped}</span>:stamped}</>}</p>}
  {board.note.trim()&&<div className="mt-4 border-l-2 border-heat bg-raised p-4"><h3 className="font-semibold">Note to the floor</h3><p className="mt-2 whitespace-pre-wrap">{board.note}</p></div>}
  {(!!focusItems.length||!!board.entries.length)&&<div className="board-pills mt-4">
  {focusItems.map(item=><button key={item.id} className="board-pill" onClick={()=>onBoardItem(item)}>{item.name} · Focus</button>)}
  {(Object.keys(SHIFT_STATUS_LABELS) as (keyof typeof SHIFT_STATUS_LABELS)[]).flatMap(status=>board.entries.filter(entry=>entry.status===status)).map(entry=>{
   const item=items.find(item=>item.id===entry.menu_item_id);
   return <button key={entry.menu_item_id} className={`board-pill${entry.status==='86'?' out':entry.status==='low'?' low':''}`} disabled={!item} onClick={()=>item&&onBoardItem(item)}>{item?.name??'Menu item unavailable'} · {SHIFT_STATUS_LABELS[entry.status]}{item&&entry.detail?<><span className="dot">·</span><span className="detail">{entry.detail}</span></>:null}</button>;
  })}
 </div>}
 </section>;
}

function EmployeeAssignments({restaurantId,items,progress,onStudy}:{restaurantId:string;items:MenuItem[];progress:ProgressRow[];onStudy:(item?:MenuItem,mode?:'list')=>void}){
 type Assignment={id:string;menu_item_id:string;item_name:string;note:string;due_on:string|null;created_at:string};
 const [assignments,setAssignments]=useState<Assignment[]>([]),[error,setError]=useState('');
 const sequence=useRef(0);
 const load=useCallback(async()=>{
  const request=++sequence.current;
  try{
   if(!supabase)return;
   const result=await supabase.rpc('my_assignments',{rid:restaurantId});
   if(result.error)throw new Error(result.error.message);
   if(request===sequence.current){setAssignments(result.data as Assignment[]);setError('');}
  }catch(e){if(request===sequence.current){setAssignments([]);setError(e instanceof Error?e.message:'Could not load assignments.');}}
 },[restaurantId]);
 useEffect(()=>{void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);return()=>{sequence.current++;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[load]);
 if(error)return <section className="panel mb-6 p-5"><p role="alert">Your study assignments could not load.</p><button className="mt-3 underline" onClick={()=>void load()}>Try again</button></section>;
 // An assignment leaves the employee's Home once they pass it (80% or better, current questions) after it was assigned.
  // A pass from before the assignment does not count, so a manager can ask for a dish to be studied again.
  const finished=(a:Assignment)=>{const score=progress.find(row=>row.menu_item_id===a.menu_item_id);return learningStatus(score)==='At target'&&!!score&&new Date(score.created_at).getTime()>=new Date(a.created_at).getTime();};
  const open=assignments.filter(a=>!finished(a));
  if(!open.length)return null;
 return <section className="panel study-card mb-7 p-5" aria-label="Study assignments"><h2 className="text-xl font-semibold">Your manager asked you to study</h2><ul className="mt-4 space-y-2">{open.map(assignment=>{const item=items.find(item=>item.id===assignment.menu_item_id),done=finished(assignment);return <li key={assignment.id}><button className="panel compact-menu-row w-full justify-between text-left" disabled={!item} onClick={()=>item&&onStudy(item)}><span className="min-w-0"><span className="block font-semibold">{assignment.item_name}</span>{assignment.note&&<span className="muted mt-1 block whitespace-pre-wrap">{assignment.note}</span>}{assignment.due_on&&<span className="muted mt-1 block text-xs">Due {new Date(`${assignment.due_on}T12:00:00`).toLocaleDateString(undefined,{weekday:'long'})}</span>}</span>{done&&<span className="quiz-chip done shrink-0 rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200" aria-label="Completed at 80% or better">✓</span>}</button></li>;})}</ul></section>;
}

export function EmployeeHome({user,items,progress,loading,error,onRetry,onStudy,onProgress,restaurantId,onFocusQuiz,onBoardItem,canDownloadBoard,restaurantName,onChecklists,schedule}:{schedule?:React.ReactNode;onChecklists?:()=>void;restaurantId:string;onFocusQuiz:(item:MenuItem)=>void;onBoardItem:(item:MenuItem)=>void;user:User;items:MenuItem[];progress:ProgressRow[];loading:boolean;error:string;onRetry:()=>void;onStudy:(item?:MenuItem,mode?:'list')=>void;onProgress?:()=>void;canDownloadBoard:boolean;restaurantName:string}){
 const {labelFor}=useTaxonomy();
 const name=typeof user.user_metadata?.display_name==='string'?user.user_metadata.display_name.trim():typeof user.user_metadata?.full_name==='string'?user.user_metadata.full_name.trim():'';
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(name),[saving,setSaving]=useState(false),[nameError,setNameError]=useState('');
 const scores=items.map(item=>({item,score:progress.find(p=>p.menu_item_id===item.id)}));
 const missing=scores.filter(r=>!r.score),review=scores.filter(r=>r.score&&(r.score.needs_review || r.score.correct/r.score.total<0.8));
 const summary=summarizeLearning(items,progress);
 async function save(e:React.FormEvent){e.preventDefault();if(!draft.trim()||saving)return;setSaving(true);setNameError('');const {error}=await supabase!.auth.updateUser({data:{display_name:draft.trim()}});setSaving(false);if(error)setNameError(error.message);else setEditing(false);}
 return <><p className="eyebrow muted mb-3">Your learning space</p><div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{name?`Welcome, ${name}`:'Welcome to HEAT'}</h1>{name&&!editing&&<button className="name-edit shrink-0" aria-label="Edit name" title="Edit name" onClick={()=>{setDraft(name);setEditing(true);}}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>}</div><p className="muted mt-2">A little practice today. More confidence at your next service.</p>
 {(!name||editing)&&<form onSubmit={save} className="panel mt-5 p-5"><label htmlFor="welcome-name">What name should we welcome you by?</label><div className="flex flex-wrap gap-3"><input id="welcome-name" className="flex-1" autoComplete="given-name" required maxLength={60} value={draft} onChange={e=>setDraft(e.target.value)}/><button className="btn" disabled={saving}>{saving?'Saving…':'Save name'}</button>{name&&<button className="btn secondary" type="button" onClick={()=>setEditing(false)}>Cancel</button>}</div>{nameError&&<p role="alert" className="mt-3 verdict-bad">{nameError}</p>}</form>}
 <div className="mt-4">{schedule}{onChecklists&&<MyJobCard key={`job-${restaurantId}`} restaurantId={restaurantId} onOpen={onChecklists}/>}<EmployeeAssignments key={restaurantId} restaurantId={restaurantId} items={items} progress={progress} onStudy={onStudy}/><EmployeeShiftBoard key={`board-${restaurantId}`} restaurantId={restaurantId} items={items} onFocusQuiz={onFocusQuiz} onBoardItem={onBoardItem} canDownload={canDownloadBoard} restaurantName={restaurantName}/></div>
 
 {loading?<p role="status" className="muted py-8">Checking your study progress…</p>:error?<section className="panel mt-6 p-5"><p role="alert">Your study progress could not load.</p><button className="btn secondary mt-3" onClick={onRetry}>Try again</button></section>:!items.length?<p className="panel mt-6 p-5">Your manager is preparing the menu. Check back soon.</p>:<><section className="study-reminder mt-3 px-4 py-2" aria-label="Study reminder"><p className="eyebrow text-heat leading-tight">{missing.length||review.length?'Your next step':'Great progress'}</p><h2 className="mt-0.5 text-[16px] leading-snug font-semibold">{missing.length||review.length?'Keep your knowledge growing.':'You’ve reached the review target on every item.'}</h2><button className={review.length?"btn secondary mt-2 study-pill review-missed":"btn mt-2"} onClick={()=>review.length?onStudy(review[0].item):missing.length?onStudy(missing[0].item,'list'):onStudy()}>{review.length?<><span className="study-alert" aria-hidden="true">!</span>Review a missed item</>:missing.length?'Continue studying':'Explore the menu'}</button></section>
 <div className="mt-3 mb-2"><SectionInfo heading="Your progress">Completion counts finished quizzes. Accuracy uses answered questions in your latest results; unfinished quizzes are excluded. Updated questions keep your previous score and appear under Needs review in Progress.</SectionInfo></div><div className={`mb-3 grid ${summary.review>0?'grid-cols-3':'grid-cols-2'} gap-3`} aria-label="Study summary">{[[`${summary.completed}/${summary.total}`,'Quiz completion'],[summary.accuracy === null ? '—' : `${summary.accuracy}%`,'Quiz accuracy'],...(summary.review>0?[[String(summary.review),'Needs review']]:[])].map(([value,label])=>label==='Needs review'&&onProgress&&summary.review>0?<button type="button" className="panel px-3 py-1.5 text-left sm:px-5 sm:py-2.5" key={label} onClick={onProgress}><p className="text-2xl leading-tight font-semibold">{value}</p><p className="muted mt-0.5 text-xs leading-snug sm:text-sm">{label} →</p></button>:<div className="panel px-3 py-1.5 sm:px-5 sm:py-2.5" key={label}><p className="text-2xl leading-tight font-semibold">{value}</p><p className="muted mt-0.5 text-xs leading-snug sm:text-sm">{label}</p></div>)}</div>
 <section className="panel progress-rings" role="group" aria-label="Library progress">{CONTENT_TYPES.filter(type=>type!=='wine'||scores.some(r=>contentTypeOf(r.item)==='wine')).map(type=>{const group=scores.filter(r=>contentTypeOf(r.item)===type),done=group.filter(r=>r.score),library=summarizeLearning(group.map(r=>r.item),progress),percent=library.completion;return <div className="progress-ring-item" key={type}><div className="progress-ring" role="img" aria-label={labelFor(type).name+': '+percent+'% completed'}><svg viewBox="0 0 46 46" aria-hidden="true"><circle className="progress-ring-track" cx="23" cy="23" r="19"/>{percent>0&&<circle className="progress-ring-arc" cx="23" cy="23" r="19" strokeDasharray={119.38} strokeDashoffset={119.38*(1-Math.min(percent,100)/100)}/>}</svg><span aria-hidden="true">{percent}%</span></div><h2>{labelFor(type).name}</h2><p>{done.length} of {group.length}</p>{library.accuracy !== null && <p>{library.accuracy}% accuracy</p>}</div>})}</section>
 {!!review.length&&<section className="mt-4"><h2 className="text-xl font-semibold">Study these again</h2><div className="menu-list mt-2 grid items-start gap-2">{review.slice(0,5).map(({item,score})=><button type="button" key={item.id} className="panel compact-menu-row study-row w-full text-left" onClick={()=>onStudy(item)}>{item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover"/> : <BookOpen size={24} className="muted shrink-0"/>}<span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><span className="muted mt-1 block text-xs">{categoryOf(item)} · {score!.needs_review ? "Updated, review needed" : `${score!.correct}/${score!.total} · ${learningStatus(score)}`}</span></span><span className="study-pill"><span className="study-alert" aria-hidden="true">!</span>Review</span></button>)}</div></section>}</>}
 </>;
}
