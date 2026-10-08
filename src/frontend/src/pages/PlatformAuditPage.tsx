import { useTranslation } from "react-i18next";
import { Heading, Text } from "@design-system";
import { AuditLogPanel } from "../components/AuditLogPanel";

/** Issue #284: root user's "Auditoría" — who did what in every salon and on the platform. */
export default function PlatformAuditPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4" data-testid="platform-audit">
      <div>
        <Heading as="h1">{t("femme.audit.platformTitle")}</Heading>
        <Text variant="muted">{t("femme.audit.platformLead")}</Text>
      </div>
      <AuditLogPanel platform />
    </div>
  );
}
