import { femmeJson } from "./femmeClient";
import { withDisplayNames } from "../lib/professionalDisplay";

export type ProfessionalOption = {
  id: number;
  fullName: string;
  displayName?: string | null;
  active: boolean;
};

/**
 * The active professionals for a picker, from the lightweight endpoint (id, names, active flag: no
 * photos, schedules or access data). `fullName` carries the display name (nickname when set).
 * Never rejects: a failed load is an empty list.
 */
export function fetchProfessionalOptions(): Promise<ProfessionalOption[]> {
  return femmeJson<ProfessionalOption[]>("/api/professionals/options")
    .then((list) => withDisplayNames(Array.isArray(list) ? list : []).filter((p) => p.active))
    .catch(() => []);
}
