import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-line bg-page text-ink",
  info: "border-primary bg-primary-lt text-primary-dk",
  success:
    "border-success bg-success-lt text-success",
  warning:
    "border-warning bg-warning-lt text-warning",
  destructive:
    "border-danger bg-danger-lt text-danger",
} as const;

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof variants;
  title?: string;
  icon?: ReactNode;
};

export function Alert({
  className,
  variant = "default",
  title,
  icon,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-xl border px-4 py-3 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    >
      <div className="flex gap-3">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <p className="font-medium leading-none">{title}</p> : null}
          <div className="leading-relaxed [&_p]:m-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
