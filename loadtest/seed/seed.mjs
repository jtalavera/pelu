#!/usr/bin/env node
// Golden multi-tenant load-test DB generator (docs/staging-env.md, T6).
//
// Normally driven by scripts/staging/seed-golden-db.sh, which brings the target staging DB up,
// prepares the SIFEN issuer file from the dev "Femme Coiffure" tenant, runs this script, applies
// the generated SQL and exports the BACPAC. Direct use:
//
//   node seed.mjs --api=https://<staging api> --tenants=20 --sifen-tenants=2 \
//     [--from-tenants=10 --base-users=<users.json of the smaller BACPAC>] \
//     [--issuer=<issuer.json>] [--anchor=YYYY-MM-DD] [--out=out]
//   node seed.mjs --estimate-only --tenants=100
//
// Environment (never committed): SEED_PLATFORM_ADMIN_EMAIL, SEED_PLATFORM_ADMIN_PASSWORD,
// SEED_USER_PASSWORD (password of every generated tenant admin; up.sh resets all users to
// STAGING_USER_PASSWORD on import anyway).
//
// Phase 1 (API, valid by construction — same pattern as e2e/fixtures/mt/world.ts): tiers, tenants,
// admins (invite + activate), business profile, categories/services, professionals + schedules,
// active fiscal stamp; for the first M tenants SIFEN on (tier flag), Femme Coiffure's issuer data,
// timbrado, CSC and certificate through the real platform endpoints.
// Phase 2 (SQL, for speed): out/history-t<NNN>.sql per tenant (lib/history-sql.mjs).
// Output: out/users.json (tenants, SIFEN index k, admin logins — no passwords) + out/plan.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApi, rows } from "./lib/api.mjs";
import { historySql } from "./lib/history-sql.mjs";
import { estimateBytes, mb, pad3, validateCounts } from "./lib/plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIFEN_FLAG = "SIFEN_ELECTRONIC_INVOICING";
const NON_SIFEN_RUC = "80000005-6"; // same valid RUC the e2e MT world uses
const TIERS = { sifen: "loadtest-sifen", basic: "loadtest-basic" };

const CATEGORY_NAMES = ["Cabello", "Color", "Manos y pies", "Estética", "Barbería"];
const SERVICE_NAMES = [
  "Corte dama", "Corte caballero", "Brushing", "Peinado", "Tintura raíz", "Tintura completa",
  "Mechas", "Balayage", "Tratamiento hidratante", "Alisado", "Manicura", "Pedicura",
  "Esmaltado semipermanente", "Depilación cejas", "Limpieza facial", "Barba",
];
const PROFESSIONAL_NAMES = ["Romina", "Fátima", "Liz", "Mirian", "Noelia", "Belén", "Tamara", "Jazmín"];

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`unknown argument ${a}`);
    args[m[1]] = m[2] ?? true;
  }
  return args;
}

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`environment variable ${name} must be set`);
  return v;
};

function log(msg) {
  process.stderr.write(`[seed ${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const volumes = JSON.parse(readFileSync(path.join(HERE, "volumes.json"), "utf-8"));
  const tenants = Number(args.tenants);
  const sifenTenants = Number(args["sifen-tenants"] ?? 0);
  const fromTenants = Number(args["from-tenants"] ?? 0);

  const errors = validateCounts({ tenants, sifenTenants, fromTenants, blockSize: volumes.blockSize });
  if (errors.length) throw new Error(errors.join("; "));

  const est = estimateBytes(volumes, tenants);
  log(`size estimate for ${tenants} tenants: ${mb(est.totalBytes)} (${mb(est.perTenantBytes)}/tenant; cap ${mb(volumes.sizeEstimate.maxBytes)})`);
  if (est.totalBytes > volumes.sizeEstimate.maxBytes) {
    const fit = Math.floor((volumes.sizeEstimate.maxBytes - volumes.sizeEstimate.baseBytes) / est.perTenantBytes / volumes.blockSize) * volumes.blockSize;
    throw new Error(`--tenants=${tenants} won't fit the Basic 2 GB cap with headroom; at most ${fit} tenants with these volumes`);
  }
  if (args["estimate-only"]) {
    process.stdout.write(JSON.stringify({ tenants, ...est }, null, 2) + "\n");
    return;
  }

  const api = createApi(String(args.api ?? env("SEED_API_URL")));
  const out = path.resolve(String(args.out ?? path.join(HERE, "out")));
  mkdirSync(out, { recursive: true });
  const userPassword = env("SEED_USER_PASSWORD");

  let base = { tenants: [] };
  if (fromTenants > 0) {
    if (!args["base-users"]) throw new Error("--from-tenants needs --base-users=<users.json of the smaller BACPAC>");
    base = JSON.parse(readFileSync(String(args["base-users"]), "utf-8"));
    if (base.tenants.length !== fromTenants) {
      throw new Error(`--base-users has ${base.tenants.length} tenants, --from-tenants says ${fromTenants}`);
    }
    const baseM = base.tenants.filter((t) => t.sifen).length;
    if (sifenTenants < baseM || (sifenTenants > baseM && baseM !== fromTenants)) {
      throw new Error(`growing from s${baseM}: existing tenants keep their SIFEN state, so --sifen-tenants must be ${baseM} (or ≥ ${fromTenants} when every existing tenant has SIFEN)`);
    }
  }
  // Growing keeps the base DB's anchor so the new blocks' dates line up with the existing ones.
  const anchor = String(args.anchor ?? base.anchor ?? new Date().toISOString().slice(0, 10));

  const issuer = sifenTenants > fromTenants
    ? JSON.parse(readFileSync(String(args.issuer ?? env("SEED_ISSUER_FILE")), "utf-8"))
    : null;

  const platformToken = await api.login(env("SEED_PLATFORM_ADMIN_EMAIL"), env("SEED_PLATFORM_ADMIN_PASSWORD"));
  const tierIds = await ensureTiers(api, platformToken);
  const existingTenants = rows(await api.get("/api/platform/tenants", { token: platformToken }));

  const result = [...base.tenants];
  for (let i = fromTenants; i < tenants; i++) {
    const sifen = i < sifenTenants;
    const t = await provisionTenant(api, platformToken, {
      index: i, sifen, tierId: sifen ? tierIds.sifen : tierIds.basic, issuer, userPassword, volumes, existingTenants,
    });
    writeFileSync(path.join(out, `history-t${pad3(i)}.sql`), historySql({ ...t, index: i }, t.professionals, t.services, volumes, anchor));
    result.push({
      id: t.id, index: i, block: Math.floor(i / volumes.blockSize), name: t.name, sifen,
      sifenIndex: sifen ? i : null,
      users: [{ email: t.adminEmail, role: "ADMIN" }],
    });
    log(`tenant ${pad3(i)} (id ${t.id}${sifen ? ", SIFEN" : ""}) provisioned`);
  }

  const summary = {
    generator: { volumesVersion: volumes.version, seed: volumes.seed },
    anchor,
    tenantsCount: tenants,
    sifenTenantsCount: result.filter((t) => t.sifen).length,
    tenants: result,
  };
  writeFileSync(path.join(out, "users.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(out, "plan.json"), JSON.stringify({ tenants, sifenTenants, fromTenants, estimate: est }, null, 2));
  log(`done: ${tenants - fromTenants} tenants provisioned, SQL in ${out}`);
}

async function ensureTiers(api, token) {
  const existing = rows(await api.get("/api/platform/tiers", { token }));
  const ids = {};
  for (const [key, name] of Object.entries(TIERS)) {
    const found = existing.find((t) => t.name === name);
    ids[key] = found ? found.id : (await api.post("/api/platform/tiers", { name, description: "Load-test golden DB (docs/staging-env.md T6)" }, { token })).id;
    await api.put(`/api/platform/tiers/${ids[key]}/feature-flags/${SIFEN_FLAG}`, { enabled: key === "sifen" }, { token });
  }
  return ids;
}

async function provisionTenant(api, platformToken, { index, sifen, tierId, issuer, userPassword, volumes, existingTenants }) {
  const name = `LT ${pad3(index)}${sifen ? " SIFEN" : ""}`;
  if (existingTenants.some((t) => t.name === name)) {
    throw new Error(`tenant "${name}" already exists — seed into a fresh DB (up.sh --data=empty) or grow with --from-tenants`);
  }
  const adminEmail = `lt-t${pad3(index)}-admin@loadtest.invalid`;
  const tenant = await api.post("/api/platform/tenants", { name, domain: null, tierId }, { token: platformToken });
  const invite = await api.post(`/api/platform/tenants/${tenant.id}/admins`, { email: adminEmail }, { token: platformToken });
  await api.post("/api/auth/activate", {
    token: invite.rawToken, password: userPassword, confirmPassword: userPassword, fullName: `Admin LT ${pad3(index)}`,
  });
  const token = await api.login(adminEmail, userPassword);

  // Business profile: SIFEN tenants carry Femme Coiffure's issuer data verbatim (read-only copy).
  const profile = sifen
    ? { ...issuer.business, logoDataUrl: null, kudeFooterMessage: "Load test — documento de prueba" }
    : { businessName: name, ruc: NON_SIFEN_RUC, address: null, phone: null, contactEmail: null, logoDataUrl: null };
  await api.put("/api/business-profile", profile, { token });

  // Catalog.
  const p = volumes.perTenant;
  const categoryIds = [];
  for (let c = 0; c < p.categories; c++) {
    categoryIds.push((await api.post("/api/service-categories", { name: CATEGORY_NAMES[c % CATEGORY_NAMES.length], accentKey: "stone" }, { token })).id);
  }
  const services = [];
  for (let s = 0; s < p.services; s++) {
    const price = 50000 + ((index * 7 + s * 13) % 20) * 10000; // ₲ 50.000 – 240.000
    const duration = [30, 45, 60, 90, 120][(index + s) % 5];
    const svcName = SERVICE_NAMES[s % SERVICE_NAMES.length];
    const svc = await api.post("/api/services", { name: svcName, categoryId: categoryIds[s % categoryIds.length], priceMinor: price, durationMinutes: duration }, { token });
    services.push({ id: svc.id, name: svcName, price, duration });
  }
  const professionals = [];
  for (let k = 0; k < p.professionals; k++) {
    const prof = await api.post("/api/professionals", {
      fullName: `${PROFESSIONAL_NAMES[k % PROFESSIONAL_NAMES.length]} ${pad3(index)}`,
      phone: null, email: null, photoDataUrl: null, pin: String(1000 + k * 1111).slice(0, 4),
    }, { token });
    const schedule = volumes.workingDays.map((d) => ({
      dayOfWeek: d, startTime: `${String(volumes.openingHour).padStart(2, "0")}:00`, endTime: `${String(volumes.closingHour).padStart(2, "0")}:00`,
    }));
    await api.put(`/api/professionals/${prof.id}/schedules`, schedule, { token });
    professionals.push({ id: prof.id });
  }

  // Active fiscal stamp. SIFEN tenants use Femme Coiffure's timbrado; up.sh rebases its range to
  // the run's disjoint block (start(k)…end(k)) on every import.
  const stamp = sifen
    ? { stampNumber: issuer.stamp.stampNumber, validFrom: issuer.stamp.validFrom, validUntil: issuer.stamp.validUntil ?? null,
        rangeFrom: 1, rangeTo: 100, initialEmissionNumber: 1,
        establishment: issuer.stamp.establishment, expeditionPoint: issuer.stamp.expeditionPoint }
    : { stampNumber: `9${String(tenant.id).padStart(7, "0")}`, validFrom: "2024-01-01", validUntil: "2099-12-31",
        rangeFrom: 1, rangeTo: 9_999_999, initialEmissionNumber: 1 };
  const created = await api.post("/api/fiscal-stamps", stamp, { token });
  await api.post(`/api/fiscal-stamps/${created.id}/activate`, {}, { token });

  if (sifen) {
    await api.post(`/api/platform/tenants/${tenant.id}/sifen/csc`, { idCsc: issuer.csc.idCsc, csc: issuer.csc.value }, { token: platformToken });
    await api.post(`/api/platform/tenants/${tenant.id}/sifen/csc/${issuer.csc.idCsc}/activate`, {}, { token: platformToken });
    const fileBase64 = readFileSync(issuer.cert.p12Path).toString("base64");
    const password = readFileSync(issuer.cert.passwordPath, "utf-8");
    await api.post(`/api/platform/tenants/${tenant.id}/sifen/certificates`, { fileBase64, password }, { token: platformToken });
  }

  return { id: tenant.id, name, adminEmail, adminUserId: invite.userId, professionals, services };
}

main().catch((err) => {
  log(`FAILED: ${err.message}`);
  process.exit(1);
});
