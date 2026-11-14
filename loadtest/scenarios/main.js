// k6 load test against staging (docs/staging-env.md T7). Run by .github/workflows/loadtest.yml.
//
// Env:
//   BASE_URL        staging API (v2-staging secret LOADTEST_BASE_URL)
//   USERS_JSON      golden-DB users (v2-staging secret LOADTEST_USERS_JSON, refreshed by up.sh):
//                   {"password":"…","tenants":[{"id":1,"sifen":true,"sifenIndex":0,"users":[{"email":"…"}]}]}
//   PROFILE         smoke | ramp | soak (default ramp) — or VUS + DURATION for a flat run
//   VUS, DURATION   flat profile overrides
//   SIFEN_RATE      SIFEN invoices per minute across ALL SIFEN tenants (default 2, 0 = off).
//                   Every SIFEN tenant shares Femme Coiffure's RUC/timbrado on sifen-test: keep it low.
//   REPORT_DIR      where handleSummary writes summary.json / summary.txt (default .)
//
// The prod limits ARE the system under test (1 replica × 0.5 vCPU, SQL Basic 5 DTU): expect the
// DB or the replica to saturate first. That is the finding, not a test failure.
import { sleep } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

import { OK_OR_CONFLICT, addDays, get, isoInstant, json, login, pick, post, put, refresh } from "./lib/api.js";

const USERS = JSON.parse(__ENV.USERS_JSON || '{"tenants":[]}');
const PASSWORD = USERS.password;
const SIFEN_RATE = Number(__ENV.SIFEN_RATE ?? 2);
const PROFILE = __ENV.PROFILE || "ramp";

const sifenIssued = new Counter("sifen_invoices_issued");
const sifenRangeExhausted = new Counter("sifen_range_exhausted");
const nonFiscalIssued = new Counter("non_fiscal_invoices_issued");

const PROFILES = {
  smoke: [{ duration: "1m", target: 2 }],
  ramp: [
    { duration: "2m", target: 10 },
    { duration: "5m", target: 25 },
    { duration: "5m", target: 50 },
    { duration: "5m", target: 100 },
    { duration: "2m", target: 0 },
  ],
  soak: [
    { duration: "5m", target: 30 },
    { duration: "50m", target: 30 },
    { duration: "5m", target: 0 },
  ],
};

const flat = __ENV.VUS && __ENV.DURATION;
const hasSifenTenants = USERS.tenants.some((t) => t.sifen);

export const options = {
  scenarios: {
    salon_day: flat
      ? { executor: "constant-vus", vus: Number(__ENV.VUS), duration: __ENV.DURATION, exec: "salonDay" }
      : { executor: "ramping-vus", startVUs: 0, stages: PROFILES[PROFILE], exec: "salonDay" },
    ...(SIFEN_RATE > 0 && hasSifenTenants
      ? {
          sifen_issuance: {
            executor: "constant-arrival-rate",
            rate: SIFEN_RATE,
            timeUnit: "1m",
            duration: flat ? __ENV.DURATION : sumDuration(PROFILES[PROFILE]),
            preAllocatedVUs: 2,
            maxVUs: 5,
            exec: "sifenIssue",
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{name:auth_login}": ["p(95)<2000"],
    "http_req_duration{name:appointments_list}": ["p(95)<1500"],
    "http_req_duration{name:appointment_create}": ["p(95)<2000"],
    "http_req_duration{name:appointment_update}": ["p(95)<2000"],
    "http_req_duration{name:service_record_create}": ["p(95)<2000"],
    "http_req_duration{name:clients_search}": ["p(95)<1500"],
    "http_req_duration{name:invoices_list}": ["p(95)<1500"],
    "http_req_duration{name:invoices_report_xlsx}": ["p(95)<8000"],
    "http_req_duration{name:invoices_report_pdf}": ["p(95)<8000"],
    "http_req_duration{name:dashboard}": ["p(95)<2500"],
    "http_req_duration{name:invoice_issue_non_fiscal}": ["p(95)<3000"],
    "http_req_duration{name:invoice_issue_sifen}": ["p(95)<5000"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function sumDuration(stages) {
  const seconds = stages.reduce((s, st) => s + parseInt(st.duration, 10) * (st.duration.endsWith("m") ? 60 : 1), 0);
  return `${seconds}s`;
}

// ── setup: per-tenant catalog + an open cash session (invoices need one) ─────────────────────
export function setup() {
  if (!USERS.tenants.length) throw new Error("USERS_JSON has no tenants");
  const tenants = [];
  for (const t of USERS.tenants) {
    const user = t.users[0];
    const token = login(user.email, PASSWORD);
    if (!token) continue;
    const professionals = (json(get(token, "/api/professionals", "setup_professionals")) || []).map((p) => p.id);
    const services = (json(get(token, "/api/services", "setup_services")) || []).map((s) => ({
      id: s.id, name: s.name, price: s.priceMinor ?? s.price ?? 50000,
    }));
    const page = json(get(token, "/api/clients/page?size=100&active=true", "setup_clients")) || {};
    const clients = (page.content || page.items || []).map((c) => c.id);
    const current = get(token, "/api/cash-sessions/current", "setup_cash_current", { responseCallback: OK_OR_CONFLICT });
    if (current.status !== 200) {
      post(token, "/api/cash-sessions/open", { openingCashAmount: 100000 }, "setup_cash_open");
    }
    tenants.push({ id: t.id, sifen: !!t.sifen, email: user.email, professionals, services, clients });
  }
  return { tenants };
}

// ── per-VU state ──────────────────────────────────────────────────────────────────────────
let me = null; // { tenant, token, loggedInAt }
const exhausted = new Set();

function session(data, filter) {
  if (!me) {
    const pool = data.tenants.filter(filter);
    const tenant = pool[(exec.vu.idInTest - 1) % pool.length];
    me = { tenant, token: login(tenant.email, PASSWORD), loggedInAt: Date.now() };
  } else if (Date.now() - me.loggedInAt > 10 * 60 * 1000) {
    me.token = refresh(me.token); // session refresh, as the SPA does
    me.loggedInAt = Date.now();
  }
  return me;
}

function slot(daysAhead) {
  const d = addDays(new Date(), daysAhead);
  d.setUTCHours(12 + Math.floor(Math.random() * 9), Math.random() < 0.5 ? 0 : 30, 0, 0); // 09:00–17:30 Asunción
  return d.toISOString();
}

// ── scenario: a receptionist's day (non-fiscal flows; SIFEN tenants issue only via sifenIssue) ─
export function salonDay(data) {
  const { tenant, token } = session(data, () => true);
  if (!token) return;
  const now = new Date();
  const weekStart = addDays(now, -now.getUTCDay() + 1);

  get(token, `/api/appointments?from=${weekStart.toISOString()}&to=${addDays(weekStart, 7).toISOString()}`, "appointments_list");
  sleep(1 + Math.random() * 2);

  const r = Math.random();
  if (r < 0.25 && tenant.clients.length && tenant.services.length && tenant.professionals.length) {
    const body = {
      clientId: pick(tenant.clients), professionalId: pick(tenant.professionals),
      serviceId: pick(tenant.services).id, startAt: slot(1 + Math.floor(Math.random() * 12)),
    };
    const created = json(post(token, "/api/appointments", body, "appointment_create", { responseCallback: OK_OR_CONFLICT }));
    if (created && created.id && Math.random() < 0.4) {
      put(token, `/api/appointments/${created.id}`, { ...body, startAt: slot(2 + Math.floor(Math.random() * 10)) },
        "appointment_update", { responseCallback: OK_OR_CONFLICT });
    }
  } else if (r < 0.40 && tenant.clients.length && tenant.services.length) {
    const svc = pick(tenant.services);
    post(token, "/api/service-records", {
      clientId: pick(tenant.clients),
      lines: [{ serviceId: svc.id, professionalId: pick(tenant.professionals), quantity: 1 }],
      tips: [],
    }, "service_record_create");
  } else if (r < 0.60) {
    const q = pick(["ana", "mar", "gonz", "lop", "vera", "sof", "ben"]);
    get(token, `/api/clients/page?q=${q}&size=10`, "clients_search");
  } else if (r < 0.75) {
    get(token, `/api/invoices?from=${isoInstant(addDays(now, -30))}&to=${isoInstant(now)}&page=0&size=20`, "invoices_list");
  } else if (r < 0.80) {
    const format = Math.random() < 0.5 ? "xlsx" : "pdf";
    get(token, `/api/invoices/report?from=${isoInstant(addDays(now, -30))}&to=${isoInstant(now)}&format=${format}`,
      `invoices_report_${format}`, { timeout: "120s" });
  } else if (r < 0.92) {
    get(token, "/api/dashboard?days=30", "dashboard");
  } else if (!tenant.sifen && tenant.services.length) {
    issueInvoice(tenant, token, "invoice_issue_non_fiscal", nonFiscalIssued, true);
  }
  sleep(2 + Math.random() * 4);
}

// ── scenario: throttled SIFEN issuance, only on the M SIFEN tenants ────────────────────────
export function sifenIssue(data) {
  const { tenant, token } = session(data, (t) => t.sifen);
  if (!token || exhausted.has(tenant.id)) return;
  issueInvoice(tenant, token, "invoice_issue_sifen", sifenIssued, false);
}

function issueInvoice(tenant, token, name, counter, withPdf) {
  const svc = pick(tenant.services);
  const res = post(token, "/api/invoices", {
    clientId: tenant.clients.length ? pick(tenant.clients) : null,
    lines: [{ serviceId: svc.id, description: svc.name || "Servicio", quantity: 1, unitPrice: svc.price,
      professionalId: tenant.professionals.length ? pick(tenant.professionals) : null }],
    payments: [{ method: "CASH", amount: svc.price }],
  }, name, { responseCallback: OK_OR_CONFLICT }); // FISCAL_STAMP_RANGE_EXHAUSTED is a 409
  const body = json(res);
  if (res.status >= 200 && res.status < 300 && body && body.id) {
    counter.add(1);
    if (withPdf) get(token, `/api/invoices/${body.id}/pdf`, "invoice_pdf_non_fiscal");
  } else if (body && String(body.code || body.error || body.message || "").includes("FISCAL_STAMP_RANGE_EXHAUSTED")) {
    // The tenant's 100-number block is used up: stop issuing for it (expected, not a failure).
    exhausted.add(tenant.id);
    sifenRangeExhausted.add(1);
  }
}

export function handleSummary(data) {
  const dir = __ENV.REPORT_DIR || ".";
  return {
    stdout: textSummary(data, { indent: " ", enableColors: false }),
    [`${dir}/summary.json`]: JSON.stringify(data, null, 2),
    [`${dir}/summary.txt`]: textSummary(data, { indent: " ", enableColors: false }),
  };
}
