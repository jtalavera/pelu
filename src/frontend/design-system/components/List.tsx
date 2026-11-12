import { type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type ListProps = HTMLAttributes<HTMLUListElement> & {
  children: ReactNode;
};

export function List({ className, children, ...props }: ListProps) {
  return (
    <ul
      className={cn(
        "divide-y divide-line rounded-lg border border-line bg-surface",
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
        "flex items-center gap-3 px-4 py-3 text-sm text-ink-2",
        className,
      )}
      {...props}
    >
      {media ? <div className="shrink-0">{media}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink">{title}</div>
        {description ? (
          <div className="text-ink-3">{description}</div>
        ) : null}
      </div>
      {end ? <div className="shrink-0 text-ink-3">{end}</div> : null}
    </li>
  );
}
