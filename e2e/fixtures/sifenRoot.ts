import { expect, type Page } from "@playwright/test";
import { loginAsPlatformAdmin } from "./auth";

/**
 * The SIFEN certificate and the CSC of a tenant are loaded ONLY by the platform's root user
 * (Plataforma → Salones → SIFEN), never by the salon's own administrator, who gets a read-only
 * view in Configuración → SIFEN. Logs in as the root user and opens that tenant's SIFEN page.
 * Tenant 1 is the shared demo salon.
 */
export async function openTenantSifenAsRoot(page: Page, tenantId = 1) {
  await loginAsPlatformAdmin(page);
  await page.goto(`/platform/tenants/${tenantId}/sifen`);
  await expect(page.getByTestId("platform-tenant-sifen")).toBeVisible();
  // The certificate panel renders its form once its first load finished.
  await expect(page.getByTestId("sifen-certificate-upload-section")).toBeVisible();
}
