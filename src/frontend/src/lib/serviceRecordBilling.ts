import type { NavigateFunction } from "react-router-dom";
import { femmeJson } from "../api/femmeClient";
import type { ServiceRecordDetail } from "../api/serviceRecords";

/**
 * "Cobrar" on a service record: opens Facturación on the new-invoice tab with the record's client,
 * lines and tips prefilled. The record only carries the client's name/RUC, so the profile is loaded
 * to prefill the invoice's recipient email (it is written back to the client if edited there).
 */
export async function billServiceRecord(
  navigate: NavigateFunction,
  record: ServiceRecordDetail,
): Promise<void> {
  let email: string | null = null;
  try {
    const client = await femmeJson<{ email: string | null }>(`/api/clients/${record.clientId}`);
    email = client.email;
  } catch {
    // Best effort: the invoice form still works with a blank email.
  }
  navigate("/app/billing", {
    state: {
      activeTab: "invoice",
      prefillServiceRecord: {
        serviceRecordId: record.id,
        client: {
          id: record.clientId,
          fullName: record.clientFullName,
          phone: null,
          email,
          ruc: record.clientRuc,
        },
        lines: record.lines.map((l) => ({
          serviceId: l.serviceId,
          description: l.description,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          professionalId: l.professionalId,
        })),
        tipsAmount: record.tipsTotal,
        tips: record.tips.map((tp) => ({ professionalId: tp.professionalId, amount: tp.amount })),
      },
    },
  });
}
