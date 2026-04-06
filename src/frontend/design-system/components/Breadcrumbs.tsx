import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconChevronRight } from "./Icon";

export type BreadcrumbsProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children: ReactNode;
};

export function Breadcrumbs({ className, children, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn(className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
        {children}
      </ol>
    </nav>
  );
}

export type BreadcrumbItemProps = HTMLAttributes<HTMLLIElement> & {
  href?: string;
  current?: boolean;
};

export function BreadcrumbItem({
  className,
  href,
  current,
  children,
  ...props
}: BreadcrumbItemProps) {
  const content =
    href && !current ? (
      <a
        href={href}
        className="font-medium text-slate-700 underline-offset-4 hover:text-indigo-600 hover:underline dark:text-slate-200 dark:hover:text-indigo-400"
      >
        {children}
      </a>
    ) : (
      <span
        className={cn(
          "font-medium",
          current && "text-slate-900 dark:text-slate-100",
        )}
        aria-current={current ? "page" : undefined}
      >
        {children}
      </span>
    );

  return (
    <li className={cn("flex items-center gap-1", className)} {...props}>
      {content}
      {!current ? (
        <IconChevronRight className="mx-0.5 text-slate-400 dark:text-slate-500" />
      ) : null}
    </li>
  );
}
