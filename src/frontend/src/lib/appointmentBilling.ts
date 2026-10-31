import { femmeJson } from "../api/femmeClient";
import { listServicesPaged } from "../api/services";
import type { Appointment } from "../api/appointments";
import type { PrefillServiceRecord } from "../pages/billing/NewInvoiceFlow";

/**
 * "Cobrar" on a turno: the state Facturación opens its "Nueva factura" with, so the client and the
 * booked service arrive already loaded (same prefill channel the fichas use, with no ficha).
 * Shared by Inicio and Agenda.
 */
export async function billingStateForAppointment(
  appt: Pick<Appointment, "clientId" | "clientName" | "serviceId" | "serviceName" | "professionalId">,
): Promise<{ activeTab: "invoice"; prefillServiceRecord: PrefillServiceRecord }> {
  let client: Record<string, unknown> | null = null;
  if (appt.clientId != null) {
    client = await femmeJson<Record<string, unknown>>(`/api/clients/${appt.clientId}`);
  }
  let unitPrice = "0";
  try {
    const page = await listServicesPaged<{ id: number; priceMinor: string | number }>({
      q: appt.serviceName,
      size: 50,
    });
    const found = page.content.find((svc) => svc.id === appt.serviceId);
    if (found) unitPrice = String(found.priceMinor);
  } catch {
    // Best effort: the invoice still opens with the service and a price to confirm.
  }
  return {
    activeTab: "invoice",
    prefillServiceRecord: {
      serviceRecordId: null,
      client: client
        ? {
            id: appt.clientId as number,
            fullName: String(client.fullName ?? appt.clientName ?? ""),
            phone: (client.phone as string | null) ?? null,
            email: (client.email as string | null) ?? null,
            ruc: (client.ruc as string | null) ?? null,
            identityDocumentNumber: (client.identityDocumentNumber as string | null) ?? null,
            identityDocumentType: (client.identityDocumentType as string | null) ?? null,
            taxpayerType: (client.taxpayerType as string | null) ?? null,
          }
        : null,
      lines: [
        {
          serviceId: appt.serviceId,
          description: appt.serviceName,
          unitPrice,
          professionalId: appt.professionalId,
        },
      ],
      tipsAmount: 0,
    },
  };
}
