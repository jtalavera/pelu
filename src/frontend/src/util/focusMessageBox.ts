/** Scrolls a result-message container into view and moves keyboard/screen-reader focus to it. */
export function focusMessageBox(el: HTMLElement | null): void {
  if (!el) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
}
