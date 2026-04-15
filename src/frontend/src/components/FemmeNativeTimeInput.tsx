import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@design-system";

/** Same styling as the calendar appointment form (`CalendarPage`) for consistent time picking in light/dark themes. */
export const FEMME_NATIVE_TIME_INPUT_CLASSNAME =
  "flex min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-indigo-400";

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
          "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20 dark:border-red-500 dark:focus-visible:ring-red-500/30",
        className,
      )}
      {...props}
    />
  ),
);

FemmeNativeTimeInput.displayName = "FemmeNativeTimeInput";
