import type { ReactNode } from "react";

/** Use for every field-level validation message (Tailwind reds; design tokens --color-* are not defined globally). */
export const FIELD_VALIDATION_ERROR_CLASS =
  "mt-1 text-sm font-medium text-red-600 dark:text-red-400";

type Props = {
  id?: string;
  children: ReactNode;
};

/**
 * Inline validation error under a form control. Always destructive (red); include required format in copy (i18n).
 */
export function FieldValidationError({ id, children }: Props) {
  if (children == null || children === false || children === "") {
    return null;
  }
  return (
    <p id={id} role="alert" className={FIELD_VALIDATION_ERROR_CLASS}>
      {children}
    </p>
  );
}
