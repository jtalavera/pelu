import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  PLATFORM_ADMIN_EMAIL,
  PLATFORM_ADMIN_PASSWORD,
} from "./fixtures/auth";

/**
 * HU-58 · Ajustar el entorno e2e para no depender del seed hardcodeado.
 *
 * Runs once, before the whole Playwright suite, and provisions the "demo" tenant + admin user
 * that most existing specs log in as (`loginAsDemo`/`loginAsDemoApi`, `DEMO_EMAIL`/`DEMO_PASSWORD`)
 * — dynamically, via the real Platform Admin API (the same `POST /api/platform/tenants` +
 * `POST /api/platform/tenants/{id}/admins` + `POST /api/auth/activate` flow HU-37/HU-41 exercise
 * through the UI), instead of a hardcoded backend boot seed. `FemmeDataInitializer` no longer
 * creates any tenant or user — see its javadoc — so without this, no tenant would exist at all
 * for the ~80 specs that only ever interact with "the demo tenant" via these fixtures.
 *
 * The demo tenant ends up as id=1 simply by being the first tenant created against a fresh,
 * empty `e2e`-profile H2 database (see application-e2e.properties) — several existing specs
 * (HU-40/41/42/43/44) already reference tenant id 1 directly for this reason, and
 * `AuthService.resolveTenant` falls back to the oldest tenant (by id) when a login request's
 * Origin doesn't match any tenant's custom domain (e.g. the local Vite dev server) — so this
 * tenant is also what a plain `loginAsDemo`/`loginAsDemoApi` browser/API login resolves to.
 *
 * Idempotent: if the backend is reused across local Playwright runs (`reuseExistingServer`, the
 * default outside CI) the demo admin may already exist from a previous run — in that case this
 * exits immediately after confirming the existing login still works, rather than re-provisioning
 * (which would 409 on the duplicate email) or leaving stale credentials silently unusable.
 */
const API_BASE = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:8080";

async function postJson<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function demoLoginAlreadyWorks(): Promise<boolean> {
  const res = await postJson<{ accessToken: string }>("/api/auth/login", {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  return res.ok && !!res.json?.accessToken;
}

export default async function globalSetup(): Promise<void> {
  if (await demoLoginAlreadyWorks()) {
    // eslint-disable-next-line no-console
    console.log(
      `[e2e/global-setup] demo tenant admin (${DEMO_EMAIL}) already provisioned — reusing it.`,
    );
    return;
  }

  const loginRes = await postJson<{ accessToken: string }>("/api/auth/login", {
    email: PLATFORM_ADMIN_EMAIL,
    password: PLATFORM_ADMIN_PASSWORD,
  });
  if (!loginRes.ok || !loginRes.json?.accessToken) {
    throw new Error(
      `[e2e/global-setup] platform admin login failed (${loginRes.status}): ${loginRes.text}`,
    );
  }
  const platformToken = loginRes.json.accessToken;

  const tiers = await getJson<Array<{ id: number; name: string }>>(
    "/api/platform/tenants/tiers",
    platformToken,
  );
  if (tiers.length === 0) {
    throw new Error("[e2e/global-setup] no tiers available to create the demo tenant with.");
  }

  const tenantRes = await postJson<{ id: number; name: string }>(
    "/api/platform/tenants",
    { name: "Demo salon", domain: null, tierId: tiers[0].id },
    platformToken,
  );
  if (!tenantRes.ok || !tenantRes.json) {
    throw new Error(
      `[e2e/global-setup] tenant creation failed (${tenantRes.status}): ${tenantRes.text}`,
    );
  }
  const tenant = tenantRes.json;

  const adminRes = await postJson<{ userId: number; email: string; rawToken: string }>(
    `/api/platform/tenants/${tenant.id}/admins`,
    { email: DEMO_EMAIL },
    platformToken,
  );
  if (!adminRes.ok || !adminRes.json) {
    throw new Error(
      `[e2e/global-setup] tenant admin invite failed (${adminRes.status}): ${adminRes.text}`,
    );
  }
  const rawToken = adminRes.json.rawToken;

  const activateRes = await postJson<void>("/api/auth/activate", {
    token: rawToken,
    password: DEMO_PASSWORD,
    confirmPassword: DEMO_PASSWORD,
  });
  if (!activateRes.ok) {
    throw new Error(
      `[e2e/global-setup] demo admin activation failed (${activateRes.status}): ${activateRes.text}`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[e2e/global-setup] provisioned demo tenant id=${tenant.id} with admin ${DEMO_EMAIL}.`,
  );
}
