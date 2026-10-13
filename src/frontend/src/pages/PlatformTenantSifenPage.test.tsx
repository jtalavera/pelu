import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import PlatformTenantSifenPage from "./PlatformTenantSifenPage";

const femmeJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <Routes>
            <Route path="/platform/tenants/:tenantId/sifen" element={<PlatformTenantSifenPage />} />
          </Routes>
        </ThemeProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe("PlatformTenantSifenPage (root user loads a salon's certificate + CSC)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmeJsonMock.mockImplementation((url: string) => {
      if (url === "/api/platform/tenants/9/sifen")
        return Promise.resolve({ tenantId: 9, tenantName: "Salón Aurora", environment: "TEST" });
      if (url === "/api/sifen/environment") return Promise.resolve({ environment: "TEST" });
      return Promise.resolve([]);
    });
  });
  afterEach(() => cleanup());

  it("shows the tenant's name with the certificate upload and the CSC form", async () => {
    renderAt("/platform/tenants/9/sifen");

    expect(await screen.findByText("SIFEN credentials — Salón Aurora")).toBeTruthy();
    expect(await screen.findByTestId("sifen-certificate-upload-section")).toBeTruthy();
    expect(await screen.findByTestId("sifen-csc-form-card")).toBeTruthy();
    expect(femmeJsonMock).toHaveBeenCalledWith("/api/platform/tenants/9/sifen/certificates");
    expect(femmeJsonMock).toHaveBeenCalledWith("/api/platform/tenants/9/sifen/csc");
    expect(screen.getByTestId("platform-tenant-sifen-back").getAttribute("href")).toBe(
      "/platform/tenants",
    );
  });

  it("shows a summary card and the Timbrado-style forms with a hint under each field", async () => {
    renderAt("/platform/tenants/9/sifen");

    expect((await screen.findByTestId("platform-tenant-sifen-name")).textContent).toBe(
      "Salón Aurora",
    );
    expect(screen.getByTestId("platform-tenant-sifen-environment").textContent).toBe(
      "Test (TEST)",
    );
    await screen.findByTestId("sifen-csc-form-card");
    // Every credential field explains its rule/format below it (same as "Agregar timbrado").
    for (const id of [
      "sifen-cert-file-hint",
      "sifen-cert-password-hint",
      "sifen-csc-id-hint",
      "sifen-csc-value-hint",
    ]) {
      expect(document.getElementById(id)?.textContent?.length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("sifen-csc-list-card")).toBeTruthy();
  });

  it("an invalid tenant id shows an error and loads nothing", () => {
    renderAt("/platform/tenants/abc/sifen");

    expect(screen.getByText("That business does not exist.")).toBeTruthy();
    expect(femmeJsonMock).not.toHaveBeenCalled();
  });
});
