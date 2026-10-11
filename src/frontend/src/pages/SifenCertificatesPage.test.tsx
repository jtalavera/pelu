import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import SifenCertificatesPage from "./SifenCertificatesPage";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
}));

vi.mock("../hooks/useMe", () => ({
  useMe: () => ({
    me: {
      userId: 1,
      tenantId: 1,
      email: "isabelzymanscki@gmail.com",
      role: "ADMIN",
      professionalId: null,
    },
    loading: false,
  }),
}));

let sifenFlagEnabled = false;
let flagsLoading = false;
vi.mock("../hooks/useFeatureFlags", () => ({
  useFeatureFlagsState: () => ({
    flags: { SIFEN_ELECTRONIC_INVOICING: sifenFlagEnabled },
    loading: flagsLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <SifenCertificatesPage />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("SifenCertificatesPage", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
    sifenFlagEnabled = false;
    flagsLoading = false;
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
    femmeJsonMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a 'feature not enabled' message and no upload form when the SIFEN flag is off", async () => {
    renderPage();
    expect(
      await screen.findByText(
        "La facturación electrónica (SIFEN) no está habilitada para tu negocio.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Cargar nuevo certificado y clave")).toBeNull();
  });

  // The certificate and the CSC are loaded by the platform's root user, never by the salon's admin.
  it("a tenant admin with SIFEN enabled sees the certificate and CSC tabs read-only (no upload, no CSC form)", async () => {
    sifenFlagEnabled = true;
    renderPage();

    expect(await screen.findByTestId("sifen-certificate-readonly-note")).toBeTruthy();
    expect(screen.queryByTestId("sifen-certificate-upload-section")).toBeNull();
    expect(screen.queryByText("Cargar nuevo certificado y clave")).toBeNull();
    expect(femmePostJsonMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: "Código de seguridad (CSC)" }));
    expect(await screen.findByTestId("sifen-csc-readonly-note")).toBeTruthy();
    expect(screen.queryByTestId("sifen-csc-form-card")).toBeNull();
  });
});
