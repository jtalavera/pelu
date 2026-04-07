import type { ReactNode } from "react";

/** Use for every field-level validation message so it stays visibly red in light and dark themes. */
export const FIELD_VALIDATION_ERROR_CLASS =
  "mt-1 text-sm font-medium text-[rgb(var(--color-destructive))]";

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
