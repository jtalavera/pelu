import { describe, expect, it } from "vitest";
import { render, screen } from "../test/renderWithTour";
import { FieldValidationError } from "./FieldValidationError";

describe("FieldValidationError", () => {
  it("renders nothing when children is empty", () => {
    const { container } = render(<FieldValidationError>{""}</FieldValidationError>);
    expect(container.firstChild).toBeNull();
  });

  it("renders role=alert with the danger (red) token class", () => {
    render(<FieldValidationError>Invalid</FieldValidationError>);
    const el = screen.getByRole("alert");
    expect(el.textContent).toBe("Invalid");
    expect(el.className).toContain("text-danger");
  });
});
