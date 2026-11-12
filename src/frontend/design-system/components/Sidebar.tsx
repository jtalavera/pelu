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
        "flex h-full w-full shrink-0 flex-col border-b border-line bg-page md:w-56 md:border-b-0 md:border-r",
        className,
      )}
      {...props}
    >
      {header ? (
        <div className="border-b border-line px-4 py-3">
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
        "flex min-h-[44px] items-center rounded-full px-4 py-2 text-sm font-semibold text-ink-2 transition-colors hover:bg-primary-lt hover:text-ink sm:min-h-0",
        active && "bg-primary text-primary-fg hover:bg-primary hover:text-primary-fg",
        className,
      )}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {children}
    </a>
  );
}
