import { useTranslation } from "react-i18next";

export type BadgeStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "ACTIVE"
  | "INACTIVE";

const BADGE_STYLE: Record<BadgeStatus, { bg: string; color: string }> = {
  IN_PROGRESS: { bg: "var(--color-rose-lt)",    color: "var(--color-rose-dk)"   },
  CONFIRMED:   { bg: "var(--color-success-lt)", color: "var(--color-success)"   },
  PENDING:     { bg: "var(--color-warning-lt)", color: "var(--color-warning)"   },
  CANCELLED:   { bg: "var(--color-danger-lt)",  color: "var(--color-danger)"    },
  NO_SHOW:     { bg: "var(--color-stone)",       color: "var(--color-ink-2)"    },
  COMPLETED:   { bg: "var(--color-mauve-lt)",   color: "var(--color-mauve-dk)"  },
  ACTIVE:      { bg: "var(--color-success-lt)", color: "var(--color-success)"   },
  INACTIVE:    { bg: "var(--color-stone)",       color: "var(--color-ink-2)"    },
};

export function StatusBadge({ status }: { status: BadgeStatus | string }) {
  const { t } = useTranslation();
  const s = BADGE_STYLE[status as BadgeStatus] ?? BADGE_STYLE.INACTIVE;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        display: "inline-block",
        whiteSpace: "nowrap",
        background: s.bg,
        color: s.color,
      }}
    >
      {t(`femme.status.${status}`, { defaultValue: status })}
    </span>
  );
}
