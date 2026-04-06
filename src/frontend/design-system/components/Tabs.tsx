import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within Tabs");
  return ctx;
}

export type TabsProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

export function Tabs({ value, onValueChange, className, children, ...props }: TabsProps) {
  const baseId = useId().replace(/:/g, "");
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange, baseId }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export type TabsListProps = HTMLAttributes<HTMLDivElement>;

export function TabsList({
  className,
  children,
  onKeyDown,
  ...props
}: TabsListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusIndex = useCallback((delta: number) => {
    const root = listRef.current;
    if (!root) return;
    const tabs = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    );
    const i = tabs.findIndex((el) => el === document.activeElement);
    const next = (i + delta + tabs.length) % tabs.length;
    tabs[next]?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = listRef.current?.querySelector<HTMLButtonElement>(
        '[role="tab"]:not([disabled])',
      );
      first?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not([disabled])',
      );
      tabs?.[tabs.length - 1]?.focus();
    }
    onKeyDown?.(e);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn(
        "inline-flex max-w-full min-h-[44px] items-center justify-start gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 text-slate-600 [scrollbar-width:thin] dark:bg-slate-800 dark:text-slate-400 sm:h-9 sm:min-h-0 sm:justify-center",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </div>
  );
}

export type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export function TabsTrigger({
  className,
  value: triggerValue,
  disabled,
  ...props
}: TabsTriggerProps) {
  const { value, setValue, baseId } = useTabs();
  const selected = value === triggerValue;
  const tabId = `${baseId}-tab-${triggerValue}`;
  const panelId = `${baseId}-panel-${triggerValue}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors sm:py-1",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100",
        className,
      )}
      onClick={() => setValue(triggerValue)}
      {...props}
    />
  );
}

export type TabsContentProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function TabsContent({
  className,
  value: contentValue,
  children,
  ...props
}: TabsContentProps) {
  const { value, baseId } = useTabs();
  const tabId = `${baseId}-tab-${contentValue}`;
  const panelId = `${baseId}-panel-${contentValue}`;
  const hidden = value !== contentValue;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={hidden}
      className={cn("mt-4 outline-none", hidden && "hidden", className)}
      tabIndex={0}
      {...props}
    >
      {children}
    </div>
  );
}
