'use client';
// The download button, and the browser half of printing.
//
// `lib/sheets.ts` turns data into PDF bytes and knows nothing about browsers.
// This file is the other half: it fetches the photograph, hands the file to the
// phone or the laptop, and draws the one control that starts all of it.
//
// Who sees the button is decided at each call site, not here, and it follows the
// chip that already governs the screen — Library for a dish card or a quiz,
// Standards for a standard, Pre-shift for the board. There is no separate
// download permission: a chip means you can change things here, and a PDF of a
// dish card holds nothing a server cannot already read on their phone. The
// allergy sheet is the exception in the other direction and is open to everyone,
// because it is the sheet somebody needs with a guest waiting.

import {useState} from 'react';
import {Download} from 'lucide-react';
import {readJpeg,type Jpeg} from '@/lib/pdf';
import type {PrintedSheet} from '@/lib/sheets';

// Enough resolution to print well, small enough to build on a phone without
// stalling. A dish card is about seven inches across on US Letter.
const MAX_EDGE=1600;
const JPEG_QUALITY=0.86;

/**
 * Fetch a photo and hand back JPEG bytes the PDF can carry as they are.
 * Anything that goes wrong returns null and the sheet is printed without the
 * picture — a card with no photograph is still worth having.
 */
export async function loadPhoto(url?:string|null):Promise<Jpeg|null>{
 if(!url)return null;
 try{
  const response=await fetch(url);
  if(!response.ok)return null;
  const blob=await response.blob();
  const direct=new Uint8Array(await blob.arrayBuffer());
  // A JPEG small enough to use untouched keeps its original quality.
  const asIs=readJpeg(direct);
  if(asIs&&Math.max(asIs.width,asIs.height)<=MAX_EDGE)return asIs;
  const bitmap=await createImageBitmap(blob);
  const scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');
  if(!context)return asIs;
  // PNGs and WebPs can be transparent; PDF has no alpha here, so lay them on
  // white rather than letting the background come out black.
  context.fillStyle='#ffffff';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close?.();
  const jpeg=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',JPEG_QUALITY));
  if(!jpeg)return asIs;
  return readJpeg(new Uint8Array(await jpeg.arrayBuffer()))??asIs;
 }catch{
  return null;
 }
}

/** Hand the finished file to the device. */
export function saveSheet(sheet:PrintedSheet):void{
 // Copy into a fresh buffer: the bytes may be a view onto a larger one, and
 // Blob would otherwise take the lot.
 const blob=new Blob([sheet.bytes.slice()],{type:'application/pdf'});
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;
 link.download=sheet.filename;
 link.rel='noopener';
 document.body.append(link);
 link.click();
 link.remove();
 // Safari needs the URL to outlive the click, so it is released a beat later.
 setTimeout(()=>URL.revokeObjectURL(url),30_000);
}

export type SheetChoice={key:string;title:string;hint:string};

/**
 * The control. One tap on anything with a single sensible document; on a quiz,
 * which has two, it asks first — inline, the way Take it down asks, rather than
 * with a dialog to dismiss.
 */
export function DownloadSheet({label,build,choices,variant='chip',buttonLabel='Download',busyLabel='Preparing the file'}:{
 label:string;
 build:(choice:string)=>Promise<PrintedSheet>;
 choices?:SheetChoice[];
 // 'chip' is the round icon button, for sitting beside another round chip such as
 // Refresh. 'button' is a full labelled button, for a row of labelled buttons —
 // an icon alone among four worded buttons reads as a stray object.
 variant?:'chip'|'button';
 buttonLabel?:string;
 busyLabel?:string;
}){
 const [busy,setBusy]=useState('');
 const [asking,setAsking]=useState(false);
 const [error,setError]=useState('');

 async function run(choice:string){
  setError('');
  setAsking(false);
  setBusy(choice||'go');
  try{
   const sheet=await build(choice);
   saveSheet(sheet);
  }catch{
   setError('That did not download. Check your connection and try again.');
  }finally{
   setBusy('');
  }
 }

 if(choices?.length&&asking){
  return (
   <div className="panel mt-2 p-3">
    <p className="eyebrow muted">Which copy?</p>
    <div className="mt-2 space-y-2">
     {choices.map(choice=>(
      <button key={choice.key} type="button" className="panel w-full p-3 text-left" disabled={!!busy}
        onClick={()=>void run(choice.key)}>
       <span className="block font-semibold">{choice.title}</span>
       <span className="muted mt-1 block text-sm">{choice.hint}</span>
      </button>
     ))}
     <button type="button" className="btn secondary w-full" onClick={()=>setAsking(false)}>Cancel</button>
    </div>
   </div>
  );
 }

 return (
  <>
   <button type="button" className={variant==='button'?'btn secondary':'icon-chip'} disabled={!!busy}
     aria-label={busy?busyLabel:label} title={variant==='button'?undefined:label}
     onClick={()=>{if(choices?.length)setAsking(true);else void run('');}}>
    {/* The spinner replaces the label rather than sitting beside it: the button is
      one of four sharing a row, and there is no width to spare for a second word. */}
    {busy?<span className="chip-spinner" aria-hidden="true"/>:variant==='button'?buttonLabel:<Download size={15} />}
   </button>
   {error&&<p role="alert" className="muted mt-2 text-sm">{error}</p>}
  </>
 );
}
