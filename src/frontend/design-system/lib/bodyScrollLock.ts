let locks = 0;
let original = "";

/**
 * Locks the page scroll while a modal/drawer is open. Shared counter: with several dialogs open at
 * once (they stack), the scroll is restored only when the LAST one closes, whatever the closing order.
 * Returns the release function (idempotent).
 */
export function lockBodyScroll(): () => void {
  if (locks === 0) {
    original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = original;
  };
}
