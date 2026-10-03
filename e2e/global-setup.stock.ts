import { writeFileSync } from "node:fs";

import { provisionStockWorld, STOCK_WORLD_FILE } from "./fixtures/stock/world";

/** Provisions (or reuses) the Stock cross-system world and writes `e2e/.stock-world.json`. */
export default async function globalSetupStock(): Promise<void> {
  const world = await provisionStockWorld();
  writeFileSync(STOCK_WORLD_FILE, JSON.stringify(world, null, 2), "utf-8");
  // eslint-disable-next-line no-console
  console.log(`[global-setup.stock] world ready — S1=${world.s1.id} S2=${world.s2.id} S3=${world.s3.id}`);
}
