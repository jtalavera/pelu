import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { SearchableSelect } from "./SearchableSelect";

describe("SearchableSelect", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("highlights the sole filtered option and selects it on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <SearchableSelect<number>
            id="test-sel"
            label="Pick one"
            value=""
            onChange={onChange}
            emptyOption={{ value: "", label: "Choose…" }}
            options={[
              { value: 1, label: "Alpha" },
              { value: 2, label: "Beta" },
            ]}
            filterPlaceholder="Filter…"
            noResultsText="None"
          />
        </ThemeProvider>
      </I18nextProvider>,
    );

    const input = screen.getByRole("combobox", { name: /pick one/i });
    await user.click(input);
    await user.keyboard("alp");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^alpha$/i })).toBeTruthy();
    });

    const alphaBtn = screen.getByRole("button", { name: /^alpha$/i });
    expect(alphaBtn.className).toMatch(/bg-slate-100/);

    const combo = screen.getByRole("combobox", { name: /pick one/i });
    expect(combo.getAttribute("aria-activedescendant")).toBe("test-sel-option-0");

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(1);
  });
});
