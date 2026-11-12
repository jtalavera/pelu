import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@design-system";

/** Same styling as the calendar appointment form (`CalendarPage`) for consistent time picking in light/dark themes. */
export const FEMME_NATIVE_TIME_INPUT_CLASSNAME =
  "flex min-h-[44px] w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow-sm transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

export type FemmeNativeTimeInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  invalid?: boolean;
};

/**
 * Native `type="time"` input used in the calendar and professional schedule forms (HU-20).
 */
export const FemmeNativeTimeInput = forwardRef<HTMLInputElement, FemmeNativeTimeInputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      type="time"
      className={cn(
        FEMME_NATIVE_TIME_INPUT_CLASSNAME,
        invalid &&
          "border-danger focus-visible:border-danger focus-visible:ring-danger/20",
        className,
      )}
      {...props}
    />
  ),
);

FemmeNativeTimeInput.displayName = "FemmeNativeTimeInput";
