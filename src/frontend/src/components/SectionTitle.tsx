import type { ReactNode } from "react";

/**
 * Title of a block on the Inicio, standing on the page background above its card: big, with a
 * round badge for the count and an optional link on the right.
 */
export function SectionTitle({
  title,
  badge,
  badgeTone = "primary",
  badgeTestId,
  action,
  id,
}: {
  title: string;
  /** Count shown next to the title, e.g. "2" or "1 abierta". */
  badge?: ReactNode;
  badgeTone?: "primary" | "amber";
  badgeTestId?: string;
  /** Right-aligned element, e.g. a link. */
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5" data-testid="section-title">
      <h2 id={id} className="font-heading text-2xl font-extrabold tracking-tight text-ink sm:text-[26px]">
        {title}
      </h2>
      {badge ? (
        <span
          data-testid={badgeTestId}
          className={`inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-full px-2.5 text-sm font-extrabold tabular-nums ${
            badgeTone === "amber"
              ? "border border-warning/35 bg-warning-lt text-warning"
              : "bg-primary text-primary-fg"
          }`}
        >
          {badge}
        </span>
      ) : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}
