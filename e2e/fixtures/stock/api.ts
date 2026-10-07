import { createHmac } from "node:crypto";

import { expect } from "@playwright/test";

import { PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } from "../auth";
import {
  HANDOFF_ISSUER,
  HANDOFF_SECRET,
  PELU_API_BASE,
  STOCK_API_BASE,
  STOCK_CLIENT_ID,
  STOCK_CLIENT_SECRET,
  STOCK_PROXY_BASE,
} from "./env";

/** Plain-fetch helpers for the Stock cross-system suite (usable from global setup and specs). */
export type HttpResult<T = any> = { status: number; ok: boolean; body: T; text: string };

export async function http<T = any>(
  base: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body: body as T, text };
}

export async function pelu<T = any>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<HttpResult<T>> {
  return http<T>(PELU_API_BASE, path, init);
}

export async function peluOk<T = any>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const r = await pelu<T>(path, init);
  if (!r.ok) throw new Error(`[stock-e2e] ${init.method ?? "GET"} ${path} -> ${r.status}: ${r.text}`);
  return r.body;
}

export async function peluLogin(email: string, password: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await pelu<{ accessToken: string }>("/api/auth/login", { body: { email, password } });
      if (r.ok) return r.body.accessToken;
    } catch {
      // backend still booting
    }
    await sleep(1000);
  }
  throw new Error(`[stock-e2e] login failed for ${email}`);
}

export function platformToken(): Promise<string> {
  return peluLogin(PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
}

export async function setGlobalFlag(token: string, key: string, enabled: boolean): Promise<void> {
  await peluOk(`/api/admin/feature-flags/${key}`, { method: "PUT", token, body: { enabled } });
}

export async function setTenantFlag(
  token: string,
  tenantId: number,
  key: string,
  enabled: boolean,
): Promise<void> {
  await peluOk(`/api/admin/feature-flags/tenants/${tenantId}/${key}`, {
    method: "PUT",
    token,
    body: { enabled },
  });
}

export async function clearTenantFlag(token: string, tenantId: number, key: string): Promise<void> {
  await peluOk(`/api/admin/feature-flags/tenants/${tenantId}/${key}`, { method: "DELETE", token });
}

export type OutboxRow = {
  id: number;
  tenantId: number;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  idempotencyKey: string;
};

export async function outbox(token: string, tenantId: number, status?: string): Promise<OutboxRow[]> {
  const qs = new URLSearchParams({ tenantId: String(tenantId), size: "100" });
  if (status) qs.set("status", status);
  const page = await peluOk<{ content: OutboxRow[] }>(`/api/platform/stock/outbox?${qs}`, { token });
  return page.content;
}

/** Waits until every outbox event of the tenant was delivered (or the timeout hits). */
export async function waitForOutboxDrained(token: string, tenantId: number, timeoutMs = 60_000) {
  await expect
    .poll(async () => (await outbox(token, tenantId)).length, {
      timeout: timeoutMs,
      intervals: [500, 1000, 2000],
    })
    .toBe(0);
}

export async function createProduct(
  token: string,
  categoryId: number,
  name: string,
  sku: string | null = null,
): Promise<number> {
  const svc = await peluOk<{ id: number }>("/api/services", {
    token,
    body: { name, categoryId, priceMinor: 50000, durationMinutes: 1, kind: "PRODUCT", sku },
  });
  return svc.id;
}

/** Catalog split: a category holds only SERVICE or only PRODUCT items (default: product category). */
export async function createCategory(
  token: string,
  name: string,
  kind: "SERVICE" | "PRODUCT" = "PRODUCT",
): Promise<number> {
  return (
    await peluOk<{ id: number }>("/api/service-categories", { token, body: { name, accentKey: "stone", kind } })
  ).id;
}

// ── control-stock ──────────────────────────────────────────────────────────────────────────────

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** A handoff token like pelu's /api/sso/stock — used only for API-level reads of Stock state. */
export function handoffToken(tenantId: number, role = "ADMIN"): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: HANDOFF_ISSUER,
      aud: "control-stock",
      sub: `e2e-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@stock-e2e.test`,
      role,
      tid: String(tenantId),
      iat: now,
      exp: now + 300,
    }),
  );
  const sig = createHmac("sha256", HANDOFF_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function stock<T = any>(
  path: string,
  init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<HttpResult<T>> {
  return http<T>(STOCK_API_BASE, path, init);
}

/** Stock user session for a pelu tenant (fails while the tenant has no STOCK_MODULE in Stock). */
export async function stockSession(tenantId: number, role = "ADMIN"): Promise<string> {
  const r = await stock<{ accessToken: string }>("/api/v1/auth/exchange", {
    body: { token: handoffToken(tenantId, role), sourceSystem: "PELU" },
  });
  if (r.status !== 200) throw new Error(`[stock-e2e] exchange ${r.status}: ${r.text}`);
  return r.body.accessToken;
}

export async function waitForStockSession(tenantId: number, timeoutMs = 60_000): Promise<string> {
  let token = "";
  await expect
    .poll(
      async () => {
        try {
          token = await stockSession(tenantId);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: timeoutMs, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return token;
}

export type StockItem = { id: number; sku: string | null; name: string; active: boolean; onHand: number | string };

export async function stockItems(token: string, q = ""): Promise<StockItem[]> {
  const qs = new URLSearchParams({ size: "200" });
  if (q) qs.set("q", q);
  const r = await stock<{ content: StockItem[] }>(`/api/v1/items?${qs}`, { token });
  return r.body?.content ?? [];
}

export async function stockItemByName(token: string, name: string): Promise<StockItem | undefined> {
  return (await stockItems(token, name)).find((i) => i.name === name);
}

export async function stockLocationId(token: string, code: string): Promise<number> {
  const r = await stock<{ id: number; code: string }[]>("/api/v1/locations", { token });
  return r.body.find((l) => l.code === code)!.id;
}

/** Initial balance in "Vitrina (venta)": a confirmed purchase receipt. */
export async function stockReceive(token: string, itemId: number, qty: string): Promise<void> {
  const created = await stock<{ id: number }>("/api/v1/documents", {
    token,
    body: {
      type: "RECEIPT",
      reasonCode: "PURCHASE",
      locationId: await stockLocationId(token, "VENTA"),
      lines: [{ itemId, quantity: qty, unitCost: "1000" }],
    },
  });
  if (created.status !== 201) throw new Error(`[stock-e2e] receipt ${created.status}: ${created.text}`);
  const confirmed = await stock(`/api/v1/documents/${created.body.id}/confirm`, { token, body: {} });
  if (confirmed.status !== 200) throw new Error(`[stock-e2e] confirm ${confirmed.status}: ${confirmed.text}`);
}

export type KardexRow = {
  documentNumber: string;
  documentType: string;
  reasonCode: string;
  sourceLabel: string | null;
  quantityIn: number | string | null;
  quantityOut: number | string | null;
  balanceAfter: number | string;
};

export async function kardex(token: string, itemId: number): Promise<KardexRow[]> {
  const r = await stock<{ content: KardexRow[] }>(`/api/v1/items/${itemId}/kardex?size=200`, { token });
  return r.body?.content ?? [];
}

export async function onHand(token: string, itemId: number): Promise<number> {
  const loc = await stockLocationId(token, "VENTA");
  const r = await stock<{ locationId: number; onHand: string }[]>(`/api/v1/items/${itemId}/stock`, { token });
  return Number(r.body.find((s) => s.locationId === loc)?.onHand ?? 0);
}

export async function stockAlerts(token: string, type?: string) {
  const r = await stock<{ items: { type: string; itemId: number; itemName: string }[] }>(
    `/api/v1/alerts${type ? `?type=${type}` : ""}`,
    { token },
  );
  return r.body?.items ?? [];
}

export async function stockFlags(token: string) {
  return (await stock<{ flags: Record<string, boolean>; version: number | null }>("/api/v1/feature-flags", { token })).body;
}

/** pelu's own M2M client toward Stock — used to replay exactly what the outbox sent. */
export async function stockClientToken(): Promise<string> {
  const res = await fetch(`${STOCK_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: STOCK_CLIENT_ID,
      client_secret: STOCK_CLIENT_SECRET,
    }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

// ── proxy ──────────────────────────────────────────────────────────────────────────────────────

export async function proxyMode(mode: "up" | "down" | "fail400", count = 0): Promise<void> {
  await http(STOCK_PROXY_BASE, "/__proxy", { body: { mode, count } });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Builds a servicios .xlsx (HU-50 template + HU-59 tipo/sku) in memory for the platform upload. */
export async function serviciosXlsx(
  rows: Array<{ categoria: string; nombre: string; precio: number; tipo?: string; sku?: string }>,
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Servicios");
  ws.addRow(["categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo", "tipo", "sku"]);
  for (const r of rows) {
    ws.addRow([r.categoria, r.nombre, r.precio, 1, "", "SI", r.tipo ?? "", r.sku ?? ""]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
