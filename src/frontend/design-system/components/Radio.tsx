import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

type RadioGroupContextValue = {
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export type RadioGroupProps = {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function RadioGroup({
  name: nameProp,
  value,
  onChange,
  disabled,
  className,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: RadioGroupProps) {
  const autoName = useId();
  const name = nameProp ?? autoName.replace(/:/g, "");
  return (
    <RadioGroupContext.Provider value={{ name, value, onChange, disabled }}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn("flex flex-col gap-2", className)}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  value: string;
};

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ className, value, disabled: disabledProp, onChange: _onChange, ...props }, ref) => {
    const ctx = useContext(RadioGroupContext);
    if (!ctx) {
      throw new Error("Radio must be used within RadioGroup");
    }
    const disabled = disabledProp ?? ctx.disabled;
    const checked = ctx.value === value;
    return (
      <input
        ref={ref}
        type="radio"
        name={ctx.name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => ctx.onChange(value)}
        className={cn(
          "size-4 shrink-0 border border-slate-300 text-indigo-600 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-indigo-400",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-indigo-400 dark:focus-visible:ring-offset-slate-950",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

Radio.displayName = "Radio";
