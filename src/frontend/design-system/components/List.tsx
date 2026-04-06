import { type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type ListProps = HTMLAttributes<HTMLUListElement> & {
  children: ReactNode;
};

export function List({ className, children, ...props }: ListProps) {
  return (
    <ul
      className={cn(
        "divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
      {...props}
    >
      {children}
    </ul>
  );
}

export type ListItemProps = LiHTMLAttributes<HTMLLIElement> & {
  /** e.g. avatar or icon */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  end?: ReactNode;
};

export function ListItem({
  className,
  media,
  title,
  description,
  end,
  ...props
}: ListItemProps) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-sm text-slate-700 dark:text-slate-200",
        className,
      )}
      {...props}
    >
      {media ? <div className="shrink-0">{media}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-900 dark:text-slate-100">{title}</div>
        {description ? (
          <div className="text-slate-500 dark:text-slate-400">{description}</div>
        ) : null}
      </div>
      {end ? <div className="shrink-0 text-slate-500 dark:text-slate-400">{end}</div> : null}
    </li>
  );
}
