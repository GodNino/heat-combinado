"use client";
// The landing page's one bit of motion: sections rise into place as they scroll into view.
// Nothing is hidden until this runs, so the page reads the same with scripts off, and someone
// who asked their device for less motion gets every section in place straight away.
import { useEffect } from "react";

export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    const items = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const watch = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("in");
        watch.unobserve(entry.target);
      }
    }, {rootMargin: "0px 0px -8% 0px"});
    // Whatever is already on screen shows at once; only what's below waits for the scroll.
    for (const item of items) {
      if (item.getBoundingClientRect().top < window.innerHeight) item.classList.add("in");
      else watch.observe(item);
    }
    root.classList.add("reveal-ready");
    return () => {watch.disconnect(); root.classList.remove("reveal-ready");};
  }, []);
  return null;
}
