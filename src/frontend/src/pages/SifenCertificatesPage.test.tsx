import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
});
