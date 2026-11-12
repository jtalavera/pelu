import { type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-transparent bg-ink text-page",
  secondary:
    "border-transparent bg-page text-ink",
  outline:
    "border-line text-ink",
  success:
    "border-transparent bg-success-lt text-success",
  warning:
    "border-transparent bg-warning-lt text-warning",
  destructive:
    "border-transparent bg-danger-lt text-danger",
  info: "border-transparent bg-primary-lt text-primary-dk",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
