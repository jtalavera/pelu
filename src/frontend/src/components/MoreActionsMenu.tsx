import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn, FloatingDropdown } from "@design-system";

export type MoreActionsItem = {
  /** Stable id (keyboard navigation and default `data-testid`). */
  id: string;
  /** Already translated. */
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Destructive action (e.g. cancel): red, and set apart by a separator. */
  destructive?: boolean;
  /** Marks the option whose panel is currently showing. */
  active?: boolean;
  /** Secondary line under the label. */
  hint?: string;
  testId?: string;
  hintTestId?: string;
};

export type MoreActionsMenuProps = {
  /** Visible trigger text, e.g. "Más acciones". Already translated. */
  label: string;
  items: MoreActionsItem[];
  /** Controlled open state (lets the parent close the menu from its own handlers). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerTestId?: string;
  menuTestId?: string;
  /** Trigger click override (the parent decides what "press again" means). */
  onTriggerClick?: () => void;
  disabled?: boolean;
  className?: string;
};

const MENU_WIDTH = 264;

export function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Labeled "Más acciones ▾" button that opens a floating menu with bordered, shadowed options, an
 * icon each and a hover state; destructive options sit last, in red, after a separator. Replaces
 * the bare "⋯" button so it reads as a button. Esc / outside click close it; ↑ ↓ move between
 * options. The panel is portalled (it flips above the trigger when there is no room below), so
 * modals and scroll containers never clip it.
 */
export function MoreActionsMenu({
  label,
  items,
  open,
  onOpenChange,
  triggerTestId,
  menuTestId,
  onTriggerClick,
  disabled,
  className,
}: MoreActionsMenuProps) {
  const menuId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    // Let the portal mount, then put focus on the first enabled option.
    const id = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  const regular = items.filter((i) => !i.destructive);
  const destructive = items.filter((i) => i.destructive);

  const renderItem = (item: MoreActionsItem) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-pressed={item.active === undefined ? undefined : item.active}
      data-testid={item.testId ?? `more-action-${item.id}`}
      onClick={() => {
        onOpenChange(false);
        item.onSelect();
      }}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        item.destructive
          ? "text-danger hover:bg-danger/10"
          : "text-ink hover:bg-primary-lt",
        item.active && "bg-primary-lt",
      )}
    >
      {item.icon ? (
        <span aria-hidden className={cn("shrink-0", item.destructive ? "text-danger" : "text-ink-3")}>
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        {item.label}
        {item.hint ? (
          <span data-testid={item.hintTestId} className="block text-xs font-normal text-ink-3">
            {item.hint}
          </span>
        ) : null}
      </span>
      {item.active ? (
        <span aria-hidden className="text-primary">
          ✓
        </span>
      ) : null}
    </button>
  );

  return (
    <div ref={anchorRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        data-testid={triggerTestId}
        onClick={onTriggerClick ?? (() => onOpenChange(!open))}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border-[1.5px] px-4 text-sm font-semibold",
          "border-primary bg-primary-lt text-primary transition-colors hover:bg-primary-lt/70",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {label}
        <IconChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </button>
      <FloatingDropdown ref={panelRef} anchorRef={anchorRef} open={open} width={MENU_WIDTH}>
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          data-testid={menuTestId}
          onKeyDown={onKeyDown}
          className="flex flex-col gap-0.5 rounded-card border border-line bg-surface p-1.5 shadow-lg"
        >
          {regular.map(renderItem)}
          {regular.length > 0 && destructive.length > 0 ? (
            <div role="separator" className="mx-1.5 my-1 h-px bg-line" />
          ) : null}
          {destructive.map(renderItem)}
        </div>
      </FloatingDropdown>
    </div>
  );
}
