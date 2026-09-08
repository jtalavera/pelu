import { writeFileSync } from "node:fs";

import { MT_WORLD_FILE, provisionMtWorld } from "./fixtures/mt/world";

/**
 * Runs once, before the mt-isolation suite. Provisions (or re-derives, if the reused mt backend is
 * already seeded) the three-tenant fixture world via the real Platform Admin API, and writes the
 * `e2e/.mt-world.json` handle that `getMtWorld()` reads synchronously from every spec.
 */
export default async function globalSetupMt(): Promise<void> {
  const world = await provisionMtWorld();
  writeFileSync(MT_WORLD_FILE, JSON.stringify(world, null, 2), "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `[global-setup.mt] world ready — A=${world.tenantA.id} B=${world.tenantB.id} C=${world.tenantC.id}`,
  );
}
