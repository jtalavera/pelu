import { expect, test } from "@playwright/test";

test("mt-isolation harness boots its own backend on :8081", async ({ request }) => {
  const res = await request.get(`${process.env.MT_API_BASE}/health`);
  expect(res.ok()).toBeTruthy();
});
