import { createPortal } from "react-dom";
import { useOutletContext } from "react-router-dom";
import type { ReactNode } from "react";

/** The header slot (next to the page title) that settings sections can portal their primary action into. */
export type SettingsOutletContext = { actionSlot: HTMLElement | null };

/**
 * Renders `children` in the header action slot of the settings layout, or in place when the page is
 * rendered on its own (tests, deep embeds).
 */
export function SettingsHeaderAction({ children }: { children: ReactNode }) {
  const ctx = useOutletContext<SettingsOutletContext | null>();
  if (ctx?.actionSlot) return createPortal(children, ctx.actionSlot);
  if (ctx) return null; // slot not mounted yet; the layout re-renders once it is
  return <div className="flex justify-end">{children}</div>;
}
