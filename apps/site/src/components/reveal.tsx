"use client";

import { useEffect } from "react";

/**
 * Renders nothing. Render it once per page (inside LandingPage): on mount it watches
 * every [data-reveal] element of the document and sets data-visible on each, once,
 * the first time it scrolls into view. The sections stay server components and keep
 * their data-reveal attributes in the prerendered HTML.
 */
export function Reveal(): null {
  // Scroll reveal: each [data-reveal] element animates in once, the first time it is seen.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-visible", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    for (const el of document.querySelectorAll("[data-reveal]")) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return null;
}
