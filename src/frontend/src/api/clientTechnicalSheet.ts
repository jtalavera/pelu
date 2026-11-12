import { femmeJson, femmePutJson } from "./femmeClient";

/** HU-68: `ClientTechnicalSheetResponse` — the only client data a professional may read. */
export type ClientTechnicalSheet = {
  clientId: number;
  clientName: string;
  active: boolean;
  notes: string | null;
  notesUpdatedAt: string | null;
  notesUpdatedBy: string | null;
  colorFormula: string | null;
  colorFormulaUpdatedAt: string | null;
  colorFormulaUpdatedBy: string | null;
};

/** Same limit the backend enforces (`ClientTechnicalSheetService.MAX_LENGTH`). */
export const TECHNICAL_SHEET_MAX_LENGTH = 2000;

export function getClientTechnicalSheet(clientId: number): Promise<ClientTechnicalSheet> {
  return femmeJson<ClientTechnicalSheet>(`/api/clients/${clientId}/technical-sheet`);
}

export function updateClientTechnicalSheet(
  clientId: number,
  body: { notes: string | null; colorFormula: string | null },
): Promise<ClientTechnicalSheet> {
  return femmePutJson<ClientTechnicalSheet>(`/api/clients/${clientId}/technical-sheet`, body);
}
