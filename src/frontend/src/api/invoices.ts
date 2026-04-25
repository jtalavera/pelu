import { femmeJson } from "./femmeClient";

export type InvoiceListItem = {
  id: number;
  invoiceNumber: number;
  invoiceNumberFormatted: string;
  clientDisplayName: string;
  status: string;
  total: string;
  issuedAt: string;
  servicesSummary?: string | null;
  paymentMethodsSummary?: string | null;
};

/** Invoices for one client: issued and voided, no date filter. */
export function listInvoicesByClientId(clientId: number): Promise<InvoiceListItem[]> {
  const params = new URLSearchParams();
  params.set("clientId", String(clientId));
  return femmeJson<InvoiceListItem[]>(`/api/invoices?${params.toString()}`);
}
