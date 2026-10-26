import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

const sizes = {
  sm: "size-4 border-2",
  md: "size-6 border-2",
  lg: "size-9 border-[3px]",
} as const;

export type SpinnerProps = {
  className?: string;
  size?: keyof typeof sizes;
  /** Overrides the default translated loading label */
  label?: string;
};

export function Spinner({
  className,
  size = "md",
  label,
}: SpinnerProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("designSystem.spinner.loading");
  return (
    <span
      role="status"
      aria-label={resolvedLabel}
      className={cn("inline-block", className)}
    >
      <span
        className={cn(
          "block animate-spin rounded-full border-line border-t-primary",
          sizes[size],
        )}
      />
      <span className="sr-only">{resolvedLabel}</span>
    </span>
  );
}
