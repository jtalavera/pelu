import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "../test/renderWithTour";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { ServiceRecordDetailModal } from "./ServiceRecordDetailModal";

const femmeJson = vi.fn();
vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJson(...args),
  femmePostJson: vi.fn(),
  femmePutJson: vi.fn(),
}));

describe("ServiceRecordDetailModal loading", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    femmeJson.mockReset();
  });
  afterEach(cleanup);

  it("asks for the ficha and the light professionals list at once", async () => {
    // The ficha never answers: if the other two still go out, nothing waits for the editor.
    femmeJson.mockImplementation((url: string) => {
      if (url.startsWith("/api/service-records/7")) return new Promise(() => undefined);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ServiceRecordDetailModal serviceRecordId={7} onClose={() => undefined} />
          </ThemeProvider>
        </I18nextProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      const urls = femmeJson.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain("/api/service-records/7");
      expect(urls).toContain("/api/professionals/options");
      // The frequent services are gone: nothing asks for them.
      expect(urls.some((u) => u.includes("frequent-services"))).toBe(false);
    });
    // The heavy list (photos + schedules) is not used for the ficha any more.
    expect(femmeJson.mock.calls.map((c) => String(c[0]))).not.toContain("/api/professionals");
  });
});
