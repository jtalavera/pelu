import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";

// Issue #284 · ajuste 6: nombres de los gráficos del tablero.
describe("dashboard chart titles", () => {
  it("Spanish: Facturación / Medios de pago / Servicios más facturados", () => {
    expect(es.femme.dashboard.revenueTrendTitle).toBe("Facturación");
    expect(es.femme.dashboard.paymentMethodMixTitle).toBe("Medios de pago");
    expect(es.femme.dashboard.topServicesTitle).toBe("Servicios más facturados");
  });

  it("English counterparts follow the same renaming", () => {
    expect(en.femme.dashboard.revenueTrendTitle).toBe("Invoicing");
    expect(en.femme.dashboard.paymentMethodMixTitle).toBe("Payment methods");
    expect(en.femme.dashboard.topServicesTitle).toBe("Most invoiced services");
  });
});
