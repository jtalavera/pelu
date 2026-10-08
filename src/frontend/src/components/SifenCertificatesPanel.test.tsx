import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "@design-system";
import i18n from "../i18n";
import { SifenCertificatesPanel } from "./SifenCertificatesPanel";

const femmeJsonMock = vi.fn();
const femmePostJsonMock = vi.fn();

vi.mock("../api/femmeClient", () => ({
  femmeJson: (...args: unknown[]) => femmeJsonMock(...args),
  femmePostJson: (...args: unknown[]) => femmePostJsonMock(...args),
}));

const CERT = {
  id: 1,
  uploadedAt: "2026-10-01T10:00:00Z",
  notBefore: "2026-01-01",
  notAfter: "2027-01-01",
  status: "VALID",
};

function renderPanel(tenantId?: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <SifenCertificatesPanel tenantId={tenantId} />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe("SifenCertificatesPanel (certificate loaded by the root user)", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
    femmeJsonMock.mockReset();
    femmePostJsonMock.mockReset();
  });
  afterEach(() => cleanup());

  it("salon administrator: read-only — lists certificates, no upload form", async () => {
    femmeJsonMock.mockResolvedValue([CERT]);
    renderPanel();

    expect(await screen.findAllByTestId("sifen-certificate-row")).toHaveLength(1);
    expect(femmeJsonMock).toHaveBeenCalledWith("/api/sifen/certificates");
    expect(screen.getByTestId("sifen-certificate-readonly-note")).toBeTruthy();
    expect(screen.queryByTestId("sifen-certificate-upload-section")).toBeNull();
    expect(document.getElementById("sifen-cert-file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload certificate" })).toBeNull();
  });

  it("salon administrator with no certificate is told to contact support (no upload CTA)", async () => {
    femmeJsonMock.mockResolvedValue([]);
    renderPanel();

    expect((await screen.findByTestId("sifen-certificate-empty-state")).textContent).toContain(
      "Contact support",
    );
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
  });

  it("root user: reads and uploads against the tenant's platform URL", async () => {
    femmeJsonMock.mockResolvedValue([]);
    femmePostJsonMock.mockResolvedValue(CERT);
    renderPanel(9);

    expect(await screen.findByTestId("sifen-certificate-upload-section")).toBeTruthy();
    expect(femmeJsonMock).toHaveBeenCalledWith("/api/platform/tenants/9/sifen/certificates");
    expect(screen.queryByTestId("sifen-certificate-readonly-note")).toBeNull();

    const file = new File([new Uint8Array([1, 2, 3])], "cert.p12", {
      type: "application/x-pkcs12",
    });
    await userEvent.upload(document.getElementById("sifen-cert-file") as HTMLInputElement, file);
    const password = document.getElementById("sifen-cert-password") as HTMLInputElement;
    expect(password.type).toBe("password");
    await userEvent.type(password, "TestPass123!");
    await userEvent.click(screen.getByRole("button", { name: "Upload certificate" }));

    await waitFor(() => {
      expect(femmePostJsonMock).toHaveBeenCalledWith("/api/platform/tenants/9/sifen/certificates", {
        fileBase64: "AQID",
        password: "TestPass123!",
      });
    });
    expect(await screen.findByText("The certificate was uploaded and stored securely.")).toBeTruthy();
    // Write-only: the password is gone from the form after the upload.
    expect(password.value).toBe("");
  });

  it("root user: requires the file and the password before calling the API", async () => {
    femmeJsonMock.mockResolvedValue([]);
    renderPanel(9);
    await screen.findByTestId("sifen-certificate-upload-section");

    await userEvent.click(screen.getByRole("button", { name: "Upload certificate" }));

    expect(await screen.findByText("Choose a .p12 file.")).toBeTruthy();
    expect(screen.getByText("Enter the file password.")).toBeTruthy();
    expect(femmePostJsonMock).not.toHaveBeenCalled();
  });
});
