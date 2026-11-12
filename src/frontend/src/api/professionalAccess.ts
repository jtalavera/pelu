import { femmePostJson } from "./femmeClient";

/**
 * Granting / revoking access is part of the professional save itself (issue #38 — the backend
 * applies it atomically with the details), so only the explicit resend action lives here.
 */

/** Issue #38 (5): resend a pending invitation (409/429 when not pending or within the cooldown). */
export async function resendProfessionalAccess<T>(professionalId: number): Promise<T> {
  return femmePostJson<T>(`/api/professionals/${professionalId}/resend-access`, {});
}
