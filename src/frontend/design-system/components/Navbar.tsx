import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type NavbarProps = HTMLAttributes<HTMLElement> & {
  /** Optional product or section label. Omit to give primary navigation the full width (recommended for admin shells). */
  brand?: ReactNode;
  /** Primary links or nav items */
  center?: ReactNode;
  end?: ReactNode;
};

export function Navbar({ className, brand, center, end, ...props }: NavbarProps) {
  const hasBrand = Boolean(brand);
  return (
    <header
      className={cn(
        "flex min-h-14 w-full flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900 sm:h-14 sm:flex-nowrap sm:gap-4 sm:py-0",
        className,
      )}
      {...props}
    >
      {hasBrand ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">{brand}</div>
      ) : null}
      {center ? (
        <nav
          className={cn(
            "min-w-0 flex-1 items-center gap-x-6 gap-y-2",
            hasBrand
              ? "hidden justify-center md:flex"
              : "flex flex-wrap justify-start",
          )}
          aria-label="Main"
        >
          {center}
        </nav>
      ) : null}
      <div className="flex shrink-0 items-center justify-end gap-2">{end}</div>
    </header>
  );
}

export type NavbarLinkProps = HTMLAttributes<HTMLAnchorElement> & {
  href: string;
  current?: boolean;
};

export function NavbarLink({
  className,
  href,
  current,
  children,
  ...props
}: NavbarLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex min-h-[44px] items-center text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 sm:min-h-0",
        current && "text-indigo-600 dark:text-indigo-400",
        className,
      )}
      aria-current={current ? "page" : undefined}
      {...props}
    >
      {children}
    </a>
  );
}
