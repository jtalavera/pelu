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
          "aspect-square rounded-full object-cover ring-2 ring-surface",
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
        "inline-flex aspect-square items-center justify-center rounded-full bg-line font-medium text-ink-2 ring-2 ring-surface",
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
