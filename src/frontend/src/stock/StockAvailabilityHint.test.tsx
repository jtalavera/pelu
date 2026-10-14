import { describe, expect, it } from "vitest";
import { render, screen } from "../test/renderWithTour";
import { StockAvailabilityHint } from "./StockAvailabilityHint";

const item = {
  serviceId: 5,
  mapped: true,
  available: 3,
  onHand: 3,
  uom: "H87",
  belowMinimum: false,
};

describe("StockAvailabilityHint", () => {
  it("shows the available quantity when the request fits", () => {
    render(<StockAvailabilityHint item={item} requested={2} testId="hint" />);
    expect(screen.getByTestId("hint").textContent).toMatch(/3/);
    expect(screen.queryByTestId("hint-warning")).toBeNull();
  });

  it("shows an amber, non-blocking warning when the request exceeds it", () => {
    render(<StockAvailabilityHint item={item} requested={5} testId="hint" />);
    const warning = screen.getByTestId("hint-warning");
    expect(warning.className).toContain("amber");
    expect(warning.textContent).toMatch(/3/);
  });

  it("renders nothing for unmapped products or without data", () => {
    const { container } = render(
      <StockAvailabilityHint item={{ ...item, mapped: false }} requested={1} testId="hint" />,
    );
    expect(container.textContent).toBe("");
    const { container: empty } = render(
      <StockAvailabilityHint item={undefined} requested={1} testId="hint2" />,
    );
    expect(empty.textContent).toBe("");
  });

  it("formats thousands the es-PY way", () => {
    render(<StockAvailabilityHint item={{ ...item, available: 1500 }} requested={1} testId="hint" />);
    expect(screen.getByTestId("hint").textContent).toContain("1.500");
  });
});
