import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  secondary:
    "bg-primary-lt text-primary-dk hover:bg-primary-md/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  outline:
    "border border-primary-md bg-transparent text-ink hover:bg-primary-lt focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  ghost:
    "text-ink-2 hover:bg-primary-lt hover:text-ink",
  /** Same visual weight as ghost; use when naming matches design-system “tertiary” */
  tertiary:
    "text-ink-2 hover:bg-primary-lt hover:text-ink",
  danger:
    "bg-danger text-white hover:bg-danger/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger",
  success:
    "bg-success text-white hover:bg-success/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success",
} as const;

const sizes = {
  sm: "min-h-[44px] rounded-full px-3.5 text-xs sm:h-8 sm:min-h-0",
  md: "min-h-[44px] rounded-full px-5 text-sm sm:h-9 sm:min-h-0",
  lg: "min-h-[44px] rounded-full px-6 text-sm sm:h-10 sm:min-h-0",
  icon:
    "min-h-[44px] min-w-[44px] rounded-full p-0 sm:h-9 sm:min-h-0 sm:min-w-0 sm:w-9",
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
