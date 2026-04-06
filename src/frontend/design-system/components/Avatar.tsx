import { type ImgHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type AvatarProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallback?: string;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
} as const;

export function Avatar({
  className,
  src,
  alt = "",
  fallback,
  size = "md",
  ...props
}: AvatarProps) {
  const fromAlt = alt
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const initials = (fallback ?? fromAlt) || "?";

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={cn(
          "aspect-square rounded-full object-cover ring-2 ring-white dark:ring-slate-900",
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex aspect-square items-center justify-center rounded-full bg-slate-200 font-medium text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-900",
        sizes[size],
        className,
      )}
      role="img"
      aria-label={alt || initials}
    >
      {initials}
    </span>
  );
}
