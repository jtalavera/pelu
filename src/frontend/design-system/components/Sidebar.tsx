import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type SidebarProps = HTMLAttributes<HTMLElement> & {
  /** Shown at top of the rail (logo, product name) */
  header?: ReactNode;
  children: ReactNode;
};

export function Sidebar({ className, header, children, ...props }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-full shrink-0 flex-col border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/80 md:w-56 md:border-b-0 md:border-r",
        className,
      )}
      {...props}
    >
      {header ? (
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          {header}
        </div>
      ) : null}
      <nav className="flex flex-1 flex-col gap-0.5 p-2" aria-label="Sidebar">
        {children}
      </nav>
    </aside>
  );
}

export type SidebarLinkProps = HTMLAttributes<HTMLAnchorElement> & {
  href: string;
  active?: boolean;
};

export function SidebarLink({
  className,
  href,
  active,
  children,
  ...props
}: SidebarLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 sm:min-h-0",
        active && "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300",
        className,
      )}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {children}
    </a>
  );
}
