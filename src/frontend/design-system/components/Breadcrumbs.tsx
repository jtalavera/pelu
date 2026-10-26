import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconChevronRight } from "./Icon";

export type BreadcrumbsProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  children: ReactNode;
};

export function Breadcrumbs({ className, children, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn(className)} {...props}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-3">
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
        className="font-medium text-ink-2 underline-offset-4 hover:text-primary hover:underline"
      >
        {children}
      </a>
    ) : (
      <span
        className={cn(
          "font-medium",
          current && "text-ink",
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
        <IconChevronRight className="mx-0.5 text-ink-3" />
      ) : null}
    </li>
  );
}
