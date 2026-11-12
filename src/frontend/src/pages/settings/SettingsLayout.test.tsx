import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import SettingsLayout from "./SettingsLayout";

let meRole: "ADMIN" | "PROFESSIONAL" = "ADMIN";
vi.mock("../../hooks/useMe", () => ({
  useMe: () => ({
    me: {
      userId: 1,
      tenantId: 1,
      email: "isabelzymanscki@gmail.com",
      role: meRole,
      professionalId: null,
    },
    loading: false,
  }),
}));

let sifenFlagEnabled = true;
vi.mock("../../hooks/useFeatureFlags", () => ({
  useFeatureFlag: (key: string) =>
    key === "SIFEN_ELECTRONIC_INVOICING" ? sifenFlagEnabled : false,
}));

function renderLayout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/app/settings/business"]}>
        <SettingsLayout />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("SettingsLayout", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
    meRole = "ADMIN";
    sifenFlagEnabled = true;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the SIFEN tab for a tenant admin when the SIFEN feature flag is enabled", () => {
    renderLayout();
    expect(screen.getByRole("link", { name: "SIFEN" })).toBeTruthy();
  });

  it("hides the SIFEN tab when the SIFEN feature flag is disabled for the tenant", () => {
    sifenFlagEnabled = false;
    renderLayout();
    expect(screen.queryByRole("link", { name: "SIFEN" })).toBeNull();
    // other tabs are unaffected
    expect(screen.getByRole("link", { name: "Negocio" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Timbrado" })).toBeTruthy();
  });

  it("lists Impuestos, Auditoría and Dispositivos compartidos under the more menu for an admin", async () => {
    renderLayout();
    expect(screen.queryByRole("link", { name: "Impuestos" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(screen.getByRole("menuitem", { name: "Impuestos" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Auditoría" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dispositivos compartidos" })).toBeTruthy();
  });

  it("a non-admin only gets Impuestos in the more menu", async () => {
    meRole = "PROFESSIONAL";
    renderLayout();
    await userEvent.click(screen.getByRole("button", { name: "Más" }));
    expect(screen.getByRole("menuitem", { name: "Impuestos" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Auditoría" })).toBeNull();
  });

  it("hides the SIFEN tab for a non-admin even when the flag is enabled", () => {
    meRole = "PROFESSIONAL";
    sifenFlagEnabled = true;
    renderLayout();
    expect(screen.queryByRole("link", { name: "SIFEN" })).toBeNull();
  });
});
