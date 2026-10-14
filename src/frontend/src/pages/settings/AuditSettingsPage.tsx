import { useTranslation } from "react-i18next";
import { Text } from "@design-system";
import { AuditLogPanel } from "../../components/AuditLogPanel";

/** Issue #284: Configuración → Auditoría — who did what in this salon (administrator only). */
export default function AuditSettingsPage() {
  const { t } = useTranslation();
  return (
    <div data-testid="audit-settings-page">
      <Text variant="muted" className="mb-4">
        {t("femme.audit.lead")}
      </Text>
      <AuditLogPanel />
    </div>
  );
}
