import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ReceiptDownloadButton } from "./ReceiptDownloadButton";

function setup(onDownload = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ReceiptDownloadButton testId="dl" onDownload={onDownload} />
      </ThemeProvider>
    </I18nextProvider>,
  );
  return onDownload;
}

describe("ReceiptDownloadButton", () => {
  it("offers A4 and ticket when downloading, and downloads the one picked", async () => {
    await i18n.changeLanguage("en");
    const onDownload = setup();
    const user = userEvent.setup();
    expect(screen.queryByTestId("dl-formats")).toBeNull();
    await user.click(screen.getByTestId("dl"));
    expect(screen.getByTestId("dl-a4").textContent).toContain("A4 sheet");
    expect(screen.getByTestId("dl-ticket").textContent).toContain("80 mm ticket");
    await user.click(screen.getByTestId("dl-ticket"));
    expect(onDownload).toHaveBeenCalledWith("TICKET");
    // The options fold back after picking.
    expect(screen.queryByTestId("dl-formats")).toBeNull();
  });

  it("downloads A4 and closes with Escape without downloading", async () => {
    await i18n.changeLanguage("en");
    const onDownload = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("dl"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("dl-formats")).toBeNull();
    expect(onDownload).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("dl"));
    await user.click(screen.getByTestId("dl-a4"));
    expect(onDownload).toHaveBeenCalledWith("A4");
  });
});
