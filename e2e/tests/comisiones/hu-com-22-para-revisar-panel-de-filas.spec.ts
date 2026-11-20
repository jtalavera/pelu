import { expect, test, type Page } from "@playwright/test";
import {
  applyChanges,
  assignToGroup,
  createCatalogItem,
  createGroup,
  enableCommissionsGlobally,
  entriesOfInvoice,
  generateSettlements,
  issueInvoice,
  loginAdminUi,
  openCommissions,
  provisionCommissionWorld,
  restoreCommissionsGlobal,
  type CommissionWorld,
} from "../../fixtures/commissions";

/**
 * HU-COM-22 · «Para revisar» como un solo panel de filas
 * (requirements/user_stories/HU-COM-22-para-revisar-panel-de-filas.md).
 */
let w: CommissionWorld;

test.beforeAll(async ({ request }) => {
  await enableCommissionsGlobally(request);
});

test.afterAll(async ({ request }) => {
  await restoreCommissionsGlobal(request);
});

test.beforeEach(async ({ request }) => {
  w = await provisionCommissionWorld(request, "HU-COM-22");
  await applyChanges(request, w.adminToken, [
    { scope: "BASE", value: "TAX_INCLUDED" },
    { scope: "DEFAULT_SERVICE", value: "12" },
  ]);
});

type Req = Parameters<typeof issueInvoice>[0];

/** The design-system primary button (filled); the outline one is bg-transparent. */
const FILLED = /(^|\s)bg-primary(\s|$)/;

/** A sale of `service` by `professionalId` (null: nobody, so it shows in «lines without a professional»). */
async function sale(request: Req, professionalId: number | null) {
  const inv = await issueInvoice(request, w.adminToken, [{ serviceId: w.service.id, name: w.service.name, professionalId }]);
  if (professionalId !== null) await entriesOfInvoice(request, w.adminToken, inv.id, 1);
  return inv;
}

/** «Peluquería» with its %, plus `withoutPercent` more groups that have none (each with a service of its own). */
async function groups(request: Req, withoutPercent: number) {
  const g = await createGroup(request, w.adminToken, "Peluquería");
  await assignToGroup(request, w.adminToken, g.id, [w.service.id]);
  await applyChanges(request, w.adminToken, [{ scope: "GROUP_RULE", groupId: g.id, value: "40" }]);
  for (let i = 1; i <= withoutPercent; i++) {
    const extra = await createGroup(request, w.adminToken, `Sin porcentaje ${i}`);
    await assignToGroup(request, w.adminToken, extra.id, [(await createCatalogItem(request, w.adminToken, w, `Servicio extra ${i}`)).id]);
  }
}

const row = (page: Page, key: "lines" | "noPercent" | "drafts") => page.getByTestId(`home-review-${key}`);

// ── AC1 · AC2 · AC3 · un panel, una fila por aviso ───────────────────────────────────────────────

test("AC1 · AC2 · AC3 · «Para revisar» es un solo panel con una fila por aviso (ícono, número una vez, consecuencia, botón) y solo la primera con botón relleno", async ({
  page,
  request,
}) => {
  await groups(request, 1);
  await sale(request, null); // a sale without professional
  await sale(request, w.ana.id);
  await generateSettlements(request, w.adminToken, [w.ana.id]); // one draft
  await loginAdminUi(page, w);
  await openCommissions(page);

  // One panel, three rows from what loses the most money to what loses the least; no counter text above it.
  const rows = page.getByTestId("home-review").locator("li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-testid", "home-review-lines");
  await expect(rows.nth(1)).toHaveAttribute("data-testid", "home-review-noPercent");
  await expect(rows.nth(2)).toHaveAttribute("data-testid", "home-review-drafts");
  await expect(rows.nth(0)).toHaveAttribute("data-tone", "money");
  await expect(rows.nth(1)).toHaveAttribute("data-tone", "setup"); // the general % is 12 %, not 0
  await expect(rows.nth(2)).toHaveAttribute("data-tone", "paperwork");
  await expect(page.getByTestId("home-review")).not.toContainText("things, from what affects");
  await expect(page.getByTestId("home-review-tag")).toHaveCount(0);

  // Lines without professional.
  await expect(row(page, "lines").getByTestId("home-review-count")).toHaveText("1");
  await expect(row(page, "lines").getByTestId("home-review-title")).toHaveText("1 sale line without a professional");
  await expect(row(page, "lines").getByTestId("home-review-help")).toHaveText("They earn no commission until you assign them a professional.");
  await expect(page.getByTestId("home-review-lines-action")).toHaveText("Assign professional");

  // Groups without their own %: with the real general % (12 %).
  await expect(row(page, "noPercent").getByTestId("home-review-title")).toHaveText("1 group without its own %");
  await expect(row(page, "noPercent").getByTestId("home-review-help")).toHaveText(/Today they are paid the general % for services: 12\s%\./);
  await expect(page.getByTestId("home-review-noPercent-action")).toHaveText("Set the %");

  // Settlements in draft: singular copy.
  await expect(row(page, "drafts").getByTestId("home-review-title")).toHaveText("1 settlement in draft");
  await expect(row(page, "drafts").getByTestId("home-review-help")).toHaveText("It must be approved before it can be paid.");
  await expect(page.getByTestId("home-review-drafts-action")).toHaveText("Review drafts");

  // Only the first row carries the filled button (the one to do first); the others are outlined.
  await expect(page.getByTestId("home-review-lines-action")).toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-noPercent-action")).not.toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-drafts-action")).not.toHaveClass(FILLED);

  // The rows fill the panel (no gap on the right) and the button is at the far end of each row.
  const panel = await page.getByTestId("home-review").locator("ul").boundingBox();
  const first = await rows.nth(0).boundingBox();
  const button = await page.getByTestId("home-review-lines-action").boundingBox();
  expect(Math.abs(first!.width - panel!.width)).toBeLessThanOrEqual(2);
  expect(button!.x + button!.width).toBeGreaterThan(panel!.x + panel!.width - 40);
  expect(button!.height).toBeGreaterThanOrEqual(44);

  // Every button still leads where it did.
  await page.getByTestId("home-review-noPercent-action").click();
  await expect(page).toHaveURL(/\/configurar\/comisiones$/);
  await expect(page.getByTestId("commission-rates")).toBeVisible();
  await page.goBack();
  await page.getByTestId("home-review-drafts-action").click();
  await expect(page).toHaveURL(/\/liquidar\?state=DRAFT$/);
});

// ── AC4 · el % general en 0 % ────────────────────────────────────────────────────────────────────

test("AC4 · si el % general de servicios es 0 % lo dice sin rodeos («Hoy no pagan comisión…», en ámbar) y el «0 %» no se parte", async ({
  page,
  request,
}) => {
  await applyChanges(request, w.adminToken, [{ scope: "DEFAULT_SERVICE", value: "0" }]);
  await groups(request, 2);
  await sale(request, w.ana.id);
  await loginAdminUi(page, w);
  await openCommissions(page);

  await expect(row(page, "noPercent")).toHaveAttribute("data-tone", "money");
  const help = row(page, "noPercent").getByTestId("home-review-help");
  await expect(help).toHaveText(/Today they are not paid a commission: the general % for services is 0\s%\./);
  await expect(help).toHaveClass(/text-warning/);
  // The «0 %» does not break between the number and the sign (a non-breaking space joins them).
  expect(await help.evaluate((el) => el.textContent)).toContain("0 %");

  // It is the only row, so it is the one with the filled button.
  await expect(page.getByTestId("home-review").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("home-review-noPercent-action")).toHaveClass(FILLED);
});

// ── AC5 · plurales y orden ───────────────────────────────────────────────────────────────────────

test("AC5 · plurales («2 groups…», «2 settlements in draft») y, sin líneas sin profesional, la primera fila es la que tiene el botón relleno", async ({
  page,
  request,
}) => {
  await groups(request, 2);
  await sale(request, w.ana.id);
  await sale(request, w.bea.id);
  await generateSettlements(request, w.adminToken, [w.ana.id, w.bea.id]);
  await loginAdminUi(page, w);
  await openCommissions(page);

  await expect(row(page, "lines")).toHaveCount(0);
  await expect(page.getByTestId("home-review").locator("li")).toHaveCount(2);
  await expect(row(page, "noPercent").getByTestId("home-review-title")).toHaveText("2 groups without their own %");
  await expect(row(page, "drafts").getByTestId("home-review-title")).toHaveText("2 settlements in draft");
  await expect(row(page, "drafts").getByTestId("home-review-help")).toHaveText("They must be approved before they can be paid.");
  await expect(page.getByTestId("home-review-noPercent-action")).toHaveClass(FILLED);
  await expect(page.getByTestId("home-review-drafts-action")).not.toHaveClass(FILLED);
});

// ── AC6 · celular (el «todo en orden» sin avisos lo cubre hu-com-15 AC2) ──────────────────────────────────────────────────────────────

test("AC6 · en el celular la fila se apila sin desbordar y el botón tiene al menos 44 px", async ({
  page,
  request,
}) => {
  await groups(request, 1);
  await sale(request, null);
  await loginAdminUi(page, w);
  await openCommissions(page);
  await page.setViewportSize({ width: 390, height: 844 }); // the same page, now as on a phone

  await expect(row(page, "lines")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const button = await page.getByTestId("home-review-lines-action").boundingBox();
  const rowBox = await row(page, "lines").boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  expect(button!.x + button!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
});
