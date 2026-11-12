import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiBaseUrl, authHeaders, loginAsDemoApi, loginPlatformAdminApi } from "../fixtures/api";
import { loginAsDemo, loginAsPlatformAdmin } from "../fixtures/auth";

// HU-71 · Skin por tenant (acento de marca según el tipo de salón)
// requirements/multi-tenant/HU-71-skin-por-tenant.md
//
// The tenant-side checks (AC5, AC8) use the shared "demo" tenant, so every test that changes its
// skin puts it back to DURAZNO in a `finally` — the rest of the suite assumes the default look.

type Skin = "DURAZNO" | "CELESTE" | "ROSA";

/** Accent color per skin, as computed by the browser (rgb) and as written in styles/skins.css. */
const ACCENT_RGB: Record<Skin, string> = {
  DURAZNO: "rgb(243, 198, 174)",
  CELESTE: "rgb(201, 217, 230)",
  ROSA: "rgb(241, 175, 194)",
};

test.describe.configure({ mode: "serial" });

async function createTenantViaApi(request: APIRequestContext, platformToken: string, name: string) {
  const tiersRes = await request.get(`${apiBaseUrl()}/api/platform/tenants/tiers`, {
    headers: authHeaders(platformToken),
  });
  const tiers = (await tiersRes.json()) as Array<{ id: number; name: string }>;
  const res = await request.post(`${apiBaseUrl()}/api/platform/tenants`, {
    headers: authHeaders(platformToken),
    data: { name, domain: null, tierId: tiers[0].id },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: number; name: string; skin: string };
}

async function putSkin(
  request: APIRequestContext,
  platformToken: string,
  tenantId: number,
  skin: string,
) {
  return request.put(`${apiBaseUrl()}/api/platform/tenants/${tenantId}/skin`, {
    headers: authHeaders(platformToken),
    data: { skin },
  });
}

async function demoTenantId(request: APIRequestContext): Promise<number> {
  const token = await loginAsDemoApi(request);
  const res = await request.get(`${apiBaseUrl()}/api/me`, { headers: authHeaders(token) });
  return ((await res.json()) as { tenantId: number }).tenantId;
}

async function pickTenant(page: Page, name: string) {
  const search = page.getByRole("combobox", { name: "Business" });
  await search.fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).getByRole("button").click();
  await expect(page.getByTestId("platform-skin-current")).toContainText(name);
}

test.describe("HU-71 · Skin por tenant", () => {
  test("AC1: la navegación de plataforma incluye la opción Skin", async ({ page }) => {
    await loginAsPlatformAdmin(page);
    const nav = page.getByRole("complementary", { name: "Platform navigation" });
    await nav.getByRole("link", { name: "Skin", exact: true }).click();
    await expect(page).toHaveURL(/\/platform\/skin$/);
    await expect(page.getByRole("heading", { name: "Skin", level: 1 })).toBeVisible();
  });

  test("AC2: las tres variaciones se ven antes de elegir tenant y no se puede guardar", async ({
    page,
  }) => {
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/skin");

    const expected: Record<Skin, { name: string; hint: string }> = {
      DURAZNO: { name: "Peach", hint: "Suggested for spas · default" },
      CELESTE: { name: "Sky blue", hint: "Suggested for barbershops" },
      ROSA: { name: "Pink", hint: "Suggested for hair salons" },
    };
    for (const skin of Object.keys(expected) as Skin[]) {
      const card = page.getByTestId(`platform-skin-card-${skin}`);
      await expect(card).toContainText(expected[skin].name);
      await expect(card).toContainText(expected[skin].hint);
      // Live preview: the logo and the accent swatch are painted with that skin's accent.
      const preview = page.getByTestId(`platform-skin-preview-${skin}`);
      await expect(preview.getByTestId("flowbit-logo")).toBeVisible();
      await expect(page.getByTestId(`platform-skin-swatch-${skin}`)).toHaveCSS(
        "background-color",
        ACCENT_RGB[skin],
      );
      await expect(
        preview.getByTestId("flowbit-logo-accent"),
      ).toHaveAttribute("fill", "rgb(var(--fb-accent))");
      await expect(page.getByLabel(expected[skin].name, { exact: false }).first()).toBeDisabled();
    }
    await expect(page.getByTestId("platform-skin-select-first")).toBeVisible();
    await expect(page.getByTestId("platform-skin-save")).toBeDisabled();
  });

  test("AC3 + AC4: tenant nuevo en DURAZNO; el Platform Admin elige otro skin, guarda y persiste", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantViaApi(request, platformToken, `E2E Skin ${Date.now()}`);
    expect(tenant.skin).toBe("DURAZNO");

    await loginAsPlatformAdmin(page);
    await page.goto("/platform/skin");
    await pickTenant(page, tenant.name);
    await expect(page.getByTestId("platform-skin-current")).toContainText("Peach");
    // Nothing changed yet → nothing to save.
    await expect(page.getByTestId("platform-skin-save")).toBeDisabled();

    await page.getByTestId("platform-skin-card-CELESTE").click();
    await expect(page.getByLabel("Sky blue", { exact: false }).first()).toBeChecked();
    await page.getByTestId("platform-skin-save").click();

    await expect(page.getByTestId("platform-skin-saved")).toContainText(tenant.name);
    await expect(page.getByTestId("platform-skin-current")).toContainText("Sky blue");

    // Persisted: a reload and the platform API both report the new skin.
    await page.reload();
    await pickTenant(page, tenant.name);
    await expect(page.getByTestId("platform-skin-current")).toContainText("Sky blue");
    const listed = await request.get(
      `${apiBaseUrl()}/api/platform/tenants?q=${encodeURIComponent(tenant.name)}`,
      { headers: authHeaders(platformToken) },
    );
    const body = (await listed.json()) as { content: Array<{ id: number; skin: string }> };
    expect(body.content.find((t) => t.id === tenant.id)?.skin).toBe("CELESTE");
  });

  test("AC5: el tenant ve su skin en la app (data-skin y peine con el acento)", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const id = await demoTenantId(request);
    try {
      for (const skin of ["ROSA", "CELESTE"] as Skin[]) {
        expect((await putSkin(request, platformToken, id, skin)).ok()).toBeTruthy();
        await loginAsDemo(page);
        await expect(page.locator("html")).toHaveAttribute("data-skin", skin.toLowerCase());
        const accent = page.locator("header").getByTestId("flowbit-logo-accent");
        await expect(accent).toBeVisible();
        // The accent group's fill resolves, through the skin's variable, to the skin's color.
        const fill = await accent.evaluate((el) => getComputedStyle(el).fill);
        expect(fill).toBe(ACCENT_RGB[skin]);
        await page.evaluate(() => sessionStorage.clear());
      }
    } finally {
      await putSkin(request, platformToken, id, "DURAZNO");
    }
  });

  test("AC6: un skin inválido o vacío se rechaza con TENANT_SKIN_INVALID; tenant inexistente con TENANT_NOT_FOUND; solo el Platform Admin", async ({
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const id = await demoTenantId(request);

    for (const bad of ["VERDE", "", "  ", "durazno-x"]) {
      const res = await putSkin(request, platformToken, id, bad);
      expect(res.status(), `skin "${bad}"`).toBe(400);
      expect(await res.text()).toContain("TENANT_SKIN_INVALID");
    }
    const missing = await putSkin(request, platformToken, 999_999_999, "ROSA");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain("TENANT_NOT_FOUND");

    // A tenant ADMIN (the demo user) can't change skins, not even its own.
    const demoToken = await loginAsDemoApi(request);
    const forbidden = await putSkin(request, demoToken, id, "ROSA");
    expect([401, 403]).toContain(forbidden.status());
  });

  test("AC6 (UI): si el guardado falla se muestra un error traducido", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const tenant = await createTenantViaApi(request, platformToken, `E2E Skin Err ${Date.now()}`);
    await loginAsPlatformAdmin(page);
    await page.goto("/platform/skin");
    await pickTenant(page, tenant.name);
    await page.route(`**/api/platform/tenants/${tenant.id}/skin`, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "TENANT_SKIN_INVALID" }),
      }),
    );
    await page.getByTestId("platform-skin-card-ROSA").click();
    await page.getByTestId("platform-skin-save").click();
    await expect(page.getByTestId("platform-skin-error")).toContainText(
      "The selected skin is not valid. Choose Peach, Sky blue or Pink.",
    );
  });

  test("AC8: el acento convive con el tema oscuro y el celular no tiene scroll horizontal", async ({
    page,
    request,
  }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const id = await demoTenantId(request);
    try {
      expect((await putSkin(request, platformToken, id, "ROSA")).ok()).toBeTruthy();
      await page.setViewportSize({ width: 375, height: 800 });
      await page.addInitScript(() => localStorage.setItem("femme-theme", "dark"));
      await loginAsDemo(page);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.locator("html")).toHaveAttribute("data-skin", "rosa");
      const fill = await page
        .locator("header")
        .getByTestId("flowbit-logo-accent")
        .evaluate((el) => getComputedStyle(el).fill);
      expect(fill).toBe(ACCENT_RGB.ROSA);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    } finally {
      await putSkin(request, platformToken, id, "DURAZNO");
    }
  });

  test("AC9: la zona de plataforma y el login no llevan skin", async ({ page, request }) => {
    const platformToken = await loginPlatformAdminApi(request);
    const id = await demoTenantId(request);
    try {
      expect((await putSkin(request, platformToken, id, "ROSA")).ok()).toBeTruthy();
      await page.goto("/login");
      await expect(page.locator("html")).not.toHaveAttribute("data-skin", /.+/);
      await loginAsPlatformAdmin(page);
      await expect(page.locator("html")).not.toHaveAttribute("data-skin", /.+/);
      // The platform topbar logo wears the default (durazno) accent.
      const fill = await page
        .locator("header")
        .getByTestId("flowbit-logo-accent")
        .evaluate((el) => getComputedStyle(el).fill);
      expect(fill).toBe(ACCENT_RGB.DURAZNO);
    } finally {
      await putSkin(request, platformToken, id, "DURAZNO");
    }
  });
});
