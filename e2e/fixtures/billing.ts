import { expect, type Page } from "@playwright/test";

/**
 * Billing redesign: Facturación is one home screen (status chip, today's total, "New invoice")
 * plus two screens reached from it — the new-invoice flow and the history.
 *
 * Returns to the home screen from whichever billing screen is showing. A no-op when already home.
 */
export async function goToBillingHome(page: Page) {
  const back = page
    .getByTestId("billing-history-back")
    .or(page.getByTestId("billing-invoice-back"))
    .or(page.getByTestId("billing-success-back"))
    .filter({ visible: true });
  if ((await back.count()) > 0) await back.first().click();
  await expect(page.getByTestId("billing-cash-chip")).toBeVisible({ timeout: 30_000 });
}

/**
 * Opens the history (invoices view). From the home it expands "Today's invoices" when needed and
 * follows "View full history"; from any other billing screen it goes through the home first.
 */
export async function goToInvoiceHistory(page: Page) {
  if (!(await page.getByTestId("billing-history-back").isVisible())) {
    await goToBillingHome(page);
    const toggle = page.getByTestId("billing-today-toggle");
    if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) === "false") {
      await toggle.click();
    }
    await page.getByTestId("billing-view-history").click();
  }
  const view = page.getByTestId("billing-history-view-invoices");
  if ((await view.getAttribute("aria-pressed")) !== "true") await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
}

/** Opens the cash-session history view (the "Cash sessions" side of the history screen). */
export async function goToCashHistory(page: Page) {
  if (!(await page.getByTestId("billing-history-back").isVisible())) {
    await goToBillingHome(page);
    await page.getByTestId("billing-cash-chip").click();
    await page.getByTestId("billing-view-cash-history").click();
  }
  const view = page.getByTestId("billing-history-view-cash");
  if ((await view.getAttribute("aria-pressed")) !== "true") await view.click();
  await expect(view).toHaveAttribute("aria-pressed", "true");
}

/** Applies a text search in the invoice history (typing + Enter, like the app's other searches). */
export async function searchInvoiceHistory(page: Page, query: string) {
  const input = page.locator("#invoice-history-text-filter");
  await input.fill(query);
  await input.press("Enter");
}

/** Opens the cash-register panel behind the status chip (movements, closing, cash history). */
export async function openCashPanel(page: Page) {
  await goToBillingHome(page);
  await page.getByTestId("billing-cash-chip").click();
  await expect(page.getByTestId("billing-cash-panel")).toBeVisible();
}

/**
 * Chooses the payment method of a payment row. A single payment uses the method buttons; once the
 * payment is split (rows with a select) the select of that row is used instead.
 */
export async function choosePaymentMethod(page: Page, method: string, idx = 0) {
  const select = page.locator(`select#pay-method-${idx}`);
  if (await select.count()) {
    await select.selectOption(method);
    return;
  }
  await page.locator(`#pay-method-${method}`).click();
}

/**
 * Makes the amount of the payment rows visible. A single payment pays the whole total and has no
 * amount input; the inputs appear once the payment is split ("Split payment").
 */
export async function showPaymentAmounts(page: Page) {
  if ((await page.locator("#pay-amount-0").count()) === 0) {
    await page.getByTestId("billing-split-payment").click();
  }
  await expect(page.locator("#pay-amount-0")).toBeVisible();
}

/** Types an amount in the first payment row (partial payments, amounts differing from the total). */
export async function fillPaymentAmount(page: Page, amount: string) {
  await showPaymentAmounts(page);
  await page.locator("#pay-amount-0").fill(amount);
}

/** Splits the payment (if it is not yet) and adds one more payment row. */
export async function addPaymentMethodRow(page: Page) {
  const add = page.getByRole("button", { name: "Add payment method" });
  if (!(await add.isVisible())) await page.getByTestId("billing-split-payment").click();
  await add.click();
}

/** Opens the "More options" section of the new-invoice screen (discount, tips, date…). */
export async function openMoreOptions(page: Page) {
  const more = page.getByTestId("billing-more-options");
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  await expect(more).toHaveAttribute("open", "");
}

/**
 * Makes sure a cash register is open: opens one with 50.000 when none is. Leaves the page on the
 * billing home.
 */
export async function ensureCashSessionOpen(page: Page) {
  await page.goto("/app/billing");
  await goToBillingHome(page).catch(() => undefined);
  const openBtn = page.getByRole("button", { name: "Open cash register" });
  if (await openBtn.isVisible()) {
    await page.getByLabel("Initial cash amount").fill("50000");
    await openBtn.click();
    await expect(page.getByTestId("billing-cash-chip")).toHaveText(/Cash register is open/, {
      timeout: 30_000,
    });
  }
  await expect(page.getByTestId("billing-cash-chip")).toBeVisible();
}

/**
 * Billing redesign: the invoice detail is one view. Its secondary actions live behind the "⋯" menu
 * (void, cancel in SIFEN, revalidate, identify client, assign professionals, sample KuDE,
 * technical detail) and "Share" is its own button.
 *
 * Opens the "⋯" menu of the open invoice detail and picks the item with this test id.
 */
export async function clickInvoiceMenuItem(page: Page, testId: string) {
  const dialog = page.getByRole("dialog").last();
  await dialog.getByTestId("invoice-more-actions-button").click();
  await dialog.getByTestId(testId).click();
}

/**
 * Opens (when the invoice offers it) every panel that used to live in the "SIFEN" tab: the share
 * panel (KuDE by email / WhatsApp), the technical detail (status, control number, history), and
 * the revalidate / cancel / identify-client panels. Several panels can be open at once, so this
 * leaves the detail looking like the old tab: every SIFEN control visible.
 */
export async function openInvoiceSifenTab(page: Page) {
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByTestId("invoice-detail-view")).toBeVisible();
  const share = dialog.getByTestId("invoice-share-button");
  if ((await share.count()) > 0 && (await share.getAttribute("aria-expanded")) !== "true") {
    await share.click();
  }
  const more = dialog.getByTestId("invoice-more-actions-button");
  for (const id of [
    "invoice-menu-technical-detail",
    "invoice-menu-revalidate",
    "invoice-menu-cancel-sifen",
    "invoice-menu-identify",
  ]) {
    await more.click();
    const item = dialog.getByTestId(id);
    if ((await item.count()) > 0 && (await item.getAttribute("aria-pressed")) !== "true") {
      await item.click();
    } else {
      await more.click(); // nothing to open here: close the menu again
    }
  }
  await expect(dialog.getByTestId("invoice-detail-technical")).toBeVisible();
  await expect(dialog.getByTestId("sifen-tab-status")).toBeVisible();
}

/** The invoice detail has a single view now: this only checks it is the one showing. */
export async function openInvoiceMainTab(page: Page) {
  await expect(page.getByTestId("invoice-detail-view")).toBeVisible();
}
