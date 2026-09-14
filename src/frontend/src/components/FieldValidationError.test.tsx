import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../test/renderWithTour";
import { FieldValidationError } from "./FieldValidationError";

// Explicit cleanup between tests — `vite.config.ts` doesn't set `globals: true`/RTL's automatic
// afterEach hook, so a still-mounted component from an earlier test can otherwise leak into
// `document.body` and pollute later `getByRole`/`getByText` assertions in this file.
afterEach(() => {
  cleanup();
});

describe("FieldValidationError", () => {
  it("renders nothing when children is empty", () => {
    const { container } = render(<FieldValidationError>{""}</FieldValidationError>);
    expect(container.firstChild).toBeNull();
  });

  it("renders role=alert with red Tailwind classes", () => {
    render(<FieldValidationError>Invalid</FieldValidationError>);
    const el = screen.getByRole("alert");
    expect(el.textContent).toBe("Invalid");
    expect(el.className).toContain("text-red-600");
    expect(el.className).toContain("dark:text-red-400");
  });
});
