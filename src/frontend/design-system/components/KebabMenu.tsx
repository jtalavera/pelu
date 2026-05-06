import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

export type KebabMenuItem = {
  /** Stable id of the action (used for keyboard nav and `data-testid`). */
  id: string;
  /** Visible label for the action. Must be already translated. */
  label: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** When true, renders the item with destructive accent. */
  destructive?: boolean;
};

export type KebabMenuProps = {
  /** Accessible name for the trigger button (i18n responsibility of caller). */
  triggerAriaLabel: string;
  items: KebabMenuItem[];
  className?: string;
  /** Optional id used to disambiguate `data-testid` between many menus. */
  id?: string;
};

/**
 * Three-vertical-dots overflow menu (Material's `more_vert` / Google kebab
 * pattern). Clicking the trigger opens a popover anchored under it; clicking
 * an item runs its `onSelect` and closes the menu. ESC and outside click also
 * close it.
 */
export function KebabMenu({
  triggerAriaLabel,
  items,
  className,
  id,
}: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const menuId = id ? `${id}-menu` : `kebab-${generatedId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    if (open) {
      const first = itemRefs.current.find(Boolean);
      first?.focus();
    }
  }, [open]);

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleItemKeyDown(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = (idx + 1) % itemRefs.current.length;
      itemRefs.current[next]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = (idx - 1 + itemRefs.current.length) % itemRefs.current.length;
      itemRefs.current[next]?.focus();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[itemRefs.current.length - 1]?.focus();
    }
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={id ? `${id}-trigger` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-slate-600 transition-colors",
          "hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30",
          "dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        )}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={triggerAriaLabel}
          className={cn(
            "absolute right-0 z-50 mt-1 min-w-[12rem] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg",
            "dark:border-slate-700 dark:bg-slate-900",
          )}
        >
          {items.map((item, idx) => (
            <li key={item.id} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                data-testid={id ? `${id}-item-${item.id}` : undefined}
                onKeyDown={(e) => handleItemKeyDown(e, idx)}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  "hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800",
                  item.destructive
                    ? "text-red-600 dark:text-red-400"
                    : "text-slate-900 dark:text-slate-100",
                )}
              >
                {item.icon ? <span aria-hidden>{item.icon}</span> : null}
                <span className="flex-1">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
