import { type HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const headingLevels = {
  h1: "text-3xl font-bold tracking-tight md:text-4xl",
  h2: "text-2xl font-semibold tracking-tight",
  h3: "text-xl font-semibold tracking-tight",
  h4: "text-lg font-semibold",
  h5: "text-base font-semibold",
  h6: "text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400",
} as const;

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: keyof typeof headingLevels;
};

export function Heading({ as: Tag = "h2", className, ...props }: HeadingProps) {
  return (
    <Tag
      className={cn(
        Tag !== "h6" && "text-slate-900 dark:text-slate-100",
        headingLevels[Tag],
        className,
      )}
      {...props}
    />
  );
}

const textVariants = {
  lead: "text-lg text-slate-600 dark:text-slate-300",
  body: "text-sm text-slate-700 dark:text-slate-300",
  small: "text-xs text-slate-500 dark:text-slate-400",
  muted: "text-sm text-slate-500 dark:text-slate-400",
  /** Uppercase system / UI chrome labels */
  label:
    "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400",
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
