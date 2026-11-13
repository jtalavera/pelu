import { type HTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

/**
 * Message box of the whole system. Soft tinted background with no border, a round coloured icon
 * and the text in the normal ink colour (a coloured paragraph is hard to read); the title, when
 * there is one, is bold and sits on its own line.
 */
const variants = {
  default: { box: "bg-page text-ink", icon: null },
  info: { box: "bg-primary-lt text-ink", icon: "bg-primary text-surface" },
  success: { box: "bg-success-lt text-ink", icon: "bg-success text-surface" },
  warning: { box: "bg-warning-lt text-ink", icon: "bg-warning text-surface" },
  destructive: { box: "bg-danger-lt text-ink", icon: "bg-danger text-surface" },
} as const;

type Variant = keyof typeof variants;

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: Variant;
  title?: string;
  /** Replaces the round icon of the variant. */
  icon?: ReactNode;
  /**
   * Makes the alert closable: shows a «×» (44 px touch target, top right) that calls this. The alert
   * is not removed by itself — the screen decides when it goes, so a message is never lost before
   * it is read.
   */
  onClose?: () => void;
  /** Accessible name of the «×» button. Defaults to the translated «Cerrar aviso». */
  closeLabel?: string;
};

/** Drawn as SVG (no text), so the alert's text content stays exactly the message. */
function VariantGlyph({ variant }: { variant: Exclude<Variant, "default"> }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (variant) {
    case "success":
      return (
        <svg {...common}>
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M8 3.5v5.5" />
          <path d="M8 12.2v.1" />
        </svg>
      );
    case "destructive":
      return (
        <svg {...common}>
          <path d="M4.5 4.5l7 7" />
          <path d="M11.5 4.5l-7 7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 7.2v5" />
          <path d="M8 3.9v.1" />
        </svg>
      );
  }
}

export function Alert({
  className,
  variant = "default",
  title,
  icon,
  onClose,
  closeLabel,
  children,
  ...props
}: AlertProps) {
  const { t } = useTranslation();
  const style = variants[variant];
  const mark =
    icon ??
    (style.icon ? (
      <span
        data-testid="alert-icon"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          style.icon,
        )}
      >
        <VariantGlyph variant={variant as Exclude<Variant, "default">} />
      </span>
    ) : null);
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-card px-4 py-3 text-sm",
        style.box,
        onClose && "pr-14",
        className,
      )}
      {...props}
    >
      <div className="flex gap-3">
        {mark ? <span className="shrink-0">{mark}</span> : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <p className="font-extrabold leading-snug">{title}</p> : null}
          <div className="leading-relaxed [&_p]:m-0">{children}</div>
        </div>
      </div>
      {onClose ? (
        <button
          type="button"
          data-testid="alert-close"
          aria-label={closeLabel ?? t("designSystem.alert.close")}
          onClick={onClose}
          className="absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-xl text-xl leading-none text-ink transition-colors hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </div>
  );
}
