import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type AccordionProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Accordion({ className, children, ...props }: AccordionProps) {
  return (
    <div className={cn("divide-y divide-line rounded-lg border border-line", className)} {...props}>
      {children}
    </div>
  );
}

export type AccordionItemProps = Omit<HTMLAttributes<HTMLDetailsElement>, "title"> & {
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
      className={cn("group bg-surface", className)}
      {...(defaultOpen ? { open: true } : {})}
      {...props}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink outline-none transition-colors",
          "marker:content-none [&::-webkit-details-marker]:hidden",
          "hover:bg-page focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          "group-open:bg-[var(--color-stone)] group-open:hover:bg-[var(--color-stone)]",
        )}
      >
        <span>{title}</span>
        <span
          className="text-ink-3 transition-transform group-open:rotate-180"
          aria-hidden
        >
          ▼
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm text-ink-2">
        {children}
      </div>
    </details>
  );
}
