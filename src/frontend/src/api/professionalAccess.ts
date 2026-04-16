import { femmePostJson } from "./femmeClient";
import { apiBaseUrl } from "./baseUrl";
import { authHeaders } from "./authHeaders";

export type GrantAccessResponse = {
  emailSent: boolean;
  rawToken: string;
};

export async function grantProfessionalAccess(professionalId: number): Promise<GrantAccessResponse> {
  return femmePostJson<GrantAccessResponse>(`/api/professionals/${professionalId}/grant-access`, {});
}

export async function revokeProfessionalAccess(professionalId: number): Promise<void> {
  await fetch(`${apiBaseUrl()}/api/professionals/${professionalId}/revoke-access`, {
    method: "POST",
    headers: authHeaders({ json: true }),
  });
}
