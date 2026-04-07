import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldValidationError, FIELD_VALIDATION_ERROR_CLASS } from "./FieldValidationError";

describe("FieldValidationError", () => {
  it("renders nothing when children is empty", () => {
    const { container } = render(<FieldValidationError>{""}</FieldValidationError>);
    expect(container.firstChild).toBeNull();
  });

  it("renders role=alert with destructive styling class", () => {
    render(<FieldValidationError>Invalid</FieldValidationError>);
    const el = screen.getByRole("alert");
    expect(el.textContent).toBe("Invalid");
    expect(el.className).toContain(FIELD_VALIDATION_ERROR_CLASS.split(" ")[0]);
    expect(el.className).toContain("text-[rgb(var(--color-destructive))]");
  });
});
