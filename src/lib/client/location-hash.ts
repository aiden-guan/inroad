"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

function readHash() {
  const hash = window.location.hash.slice(1);
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

export function useLocationHash() {
  return useSyncExternalStore(subscribe, readHash, () => "");
}

/** Update the fragment without losing Next's router state or the browser's Back history. */
export function navigateToHash(id: string, pageTop = false) {
  if (readHash() !== id) {
    history.pushState(history.state, "", `#${encodeURIComponent(id)}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  requestAnimationFrame(() => focusAnchor(id, pageTop));
}

/** Called after the destination panel is visible, including on direct links and Back/Forward. */
export function focusAnchor(id: string, pageTop = false) {
  const target = document.getElementById(id);
  if (!target || target.closest("[hidden]")) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  const heading = target.querySelector<HTMLElement>("h1, h2, h3") ?? target;
  heading.tabIndex = -1;
  heading.classList.add("outline-none");
  heading.focus({ preventScroll: true });
  if (pageTop) window.scrollTo({ top: 0, behavior: "instant" });
  else target.scrollIntoView({ block: "start" });
}
