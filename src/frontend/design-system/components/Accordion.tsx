import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type AccordionProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Accordion({ className, children, ...props }: AccordionProps) {
  return (
    <div className={cn("divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700", className)} {...props}>
      {children}
    </div>
  );
}

export type AccordionItemProps = HTMLAttributes<HTMLDetailsElement> & {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function AccordionItem({
  className,
  title,
  children,
  defaultOpen,
  ...props
}: AccordionItemProps) {
  return (
    <details
      className={cn("group bg-white dark:bg-slate-900", className)}
      {...(defaultOpen ? { defaultOpen: true } : {})}
      {...props}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition-colors",
          "marker:content-none [&::-webkit-details-marker]:hidden",
          "hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-100 dark:hover:bg-slate-800/80 dark:focus-visible:ring-indigo-400",
        )}
      >
        <span>{title}</span>
        <span
          className="text-slate-400 transition-transform group-open:rotate-180 dark:text-slate-500"
          aria-hidden
        >
          ▼
        </span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        {children}
      </div>
    </details>
  );
}
