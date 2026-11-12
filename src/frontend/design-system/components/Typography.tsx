import { type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const headingLevels = {
  h1: "text-3xl font-extrabold tracking-tight md:text-4xl",
  h2: "text-2xl font-bold tracking-tight",
  h3: "text-xl font-bold tracking-tight",
  h4: "text-lg font-bold",
  h5: "text-base font-semibold",
  h6: "text-sm font-semibold uppercase tracking-wide text-ink-2",
} as const;

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: keyof typeof headingLevels;
};

export function Heading({ as: Tag = "h2", className, ...props }: HeadingProps) {
  return (
    <Tag
      className={cn(
        "font-heading",
        Tag !== "h6" && "text-ink",
        headingLevels[Tag],
        className,
      )}
      {...props}
    />
  );
}

const textVariants = {
  lead: "text-lg text-ink-2",
  body: "text-sm text-ink-2",
  small: "text-xs text-ink-3",
  muted: "text-sm text-ink-3",
  /** Uppercase system / UI chrome labels */
  label:
    "text-xs font-medium uppercase tracking-wide text-ink-3",
} as const;

export type TextProps = HTMLAttributes<HTMLParagraphElement> & {
  variant?: keyof typeof textVariants;
  as?: "p" | "span";
};

export function Text({
  variant = "body",
  as: Tag = "p",
  className,
  ...props
}: TextProps) {
  return (
    <Tag className={cn(textVariants[variant], className)} {...props} />
  );
}
