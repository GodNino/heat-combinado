"use client";
// English or Spanish, with one tap. The app is written in English; when Spanish is on, the
// Translator swaps every piece of interface text it knows (lib/i18n-es.ts) right on the page,
// and swaps it back when English is chosen again. Anything it doesn't know stays in English, and
// what a restaurant writes itself (dish names, descriptions, notes) is never touched.
//
// The choice is kept in the browser and, once signed in, on the account, so it follows the
// person to their other devices.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { translateText } from "@/lib/i18n-es";

export type Lang = "en" | "es";
const STORAGE_KEY = "heat-lang";
const EVENT = "heat-lang";


export function currentLang(): Lang {
  return typeof document !== "undefined" && document.documentElement.lang === "es" ? "es" : "en";
}

export function setLang(lang: Lang, remember = true) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent(EVENT, {detail: lang}));
  if (remember) void supabase?.auth.getSession().then(({data}) => {
    if (data.session && data.session.user.user_metadata?.heat_lang !== lang) void supabase!.auth.updateUser({data: {heat_lang: lang}});
  });
}

export function useLang(): Lang {
  const [lang, setState] = useState<Lang>("en");
  useEffect(() => {
    setState(currentLang());
    const changed = (event: Event) => setState((event as CustomEvent<Lang>).detail);
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return lang;
}

// The button. Its two labels are names of languages, so they are the same in both.
export function LanguageSwitch({compact = false}: {compact?: boolean}) {
  const lang = useLang();
  const choices = <div className="category-tabs lang-switch" role="group" aria-label="Language">
    {(["en", "es"] as const).map(value => <button key={value} type="button" lang={value} aria-pressed={lang === value} data-no-translate onClick={() => setLang(value)}>
      {value === "en" ? "EN" : "ES"}
    </button>)}
  </div>;
  if (compact) return choices;
  return <div className="theme-choice mt-6">
    <p className="eyebrow muted mb-2">Language</p>
    {choices}
  </div>;
}

// ── The page translator ───────────────────────────────────────────────────────────────────────
const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "CODE", "PRE"]);
type Swap = {original: string; shown: string};
const texts = new WeakMap<Text, Swap>();
const attributes = new WeakMap<Element, Map<string, Swap>>();
const touchedTexts = new Set<WeakRef<Text>>();
const touchedElements = new Set<WeakRef<Element>>();

function skipped(element: Element | null) {
  return !element || SKIP.has(element.tagName) || !!element.closest("[data-no-translate],[contenteditable='true']");
}

function translateNode(node: Text) {
  if (skipped(node.parentElement)) return;
  const value = node.nodeValue ?? "";
  const known = texts.get(node);
  // Already showing our Spanish: leave it. Changed by the app since: start from the new English.
  if (known && value === known.shown) return;
  const spanish = translateText(value);
  if (spanish === null || spanish === value) {
    if (known) texts.delete(node);
    return;
  }
  texts.set(node, {original: value, shown: spanish});
  touchedTexts.add(new WeakRef(node));
  node.nodeValue = spanish;
}

// A text box's own words (its placeholder, its label) are interface, even though what's typed in it isn't.
function translateAttributes(element: Element) {
  if (element.closest("[data-no-translate]")) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const saved = attributes.get(element)?.get(name);
    if (saved && value === saved.shown) continue;
    const spanish = translateText(value);
    if (spanish === null || spanish === value) continue;
    const map = attributes.get(element) ?? new Map<string, Swap>();
    map.set(name, {original: value, shown: spanish});
    attributes.set(element, map);
    touchedElements.add(new WeakRef(element));
    element.setAttribute(name, spanish);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateNode(root as Text);
  if (!(root instanceof Element) && !(root instanceof Document) && !(root instanceof DocumentFragment)) return;
  if (root instanceof Element) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateNode(node as Text);
    else translateAttributes(node as Element);
  }
}

function restoreAll() {
  for (const ref of touchedTexts) {
    const node = ref.deref();
    const saved = node && texts.get(node);
    if (node && saved && node.nodeValue === saved.shown) node.nodeValue = saved.original;
    if (node) texts.delete(node);
  }
  touchedTexts.clear();
  for (const ref of touchedElements) {
    const element = ref.deref();
    const map = element && attributes.get(element);
    if (element && map) for (const [name, saved] of map) if (element.getAttribute(name) === saved.shown) element.setAttribute(name, saved.original);
    if (element) attributes.delete(element);
  }
  touchedElements.clear();
}

let englishTitle = "";
// The tab's title: Next.js puts the English one back on every page change.
function translateTitle() {
  const spanish = translateText(document.title);
  if (spanish && spanish !== document.title) {
    englishTitle = document.title;
    document.title = spanish;
  }
}

export function Translator() {
  const lang = useLang();
  useEffect(() => {
    if (lang !== "es") return;
    translateTitle();
    const titleWatch = new MutationObserver(translateTitle);
    titleWatch.observe(document.head, {subtree: true, childList: true, characterData: true});
    translateTree(document.body);
    // New screens, loaded data and changed labels: translated as they appear, a frame at a time.
    let pending = new Set<Node>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = pending;
      pending = new Set();
      for (const node of batch) if (node.isConnected) translateTree(node);
    };
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") pending.add(record.target);
        else if (record.type === "attributes") pending.add(record.target);
        else record.addedNodes.forEach(node => pending.add(node));
      }
      if (!frame) frame = requestAnimationFrame(flush);
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES]});
    return () => {
      observer.disconnect();
      titleWatch.disconnect();
      if (frame) cancelAnimationFrame(frame);
      restoreAll();
      if (englishTitle) document.title = englishTitle;
    };
  }, [lang]);
  return null;
}
