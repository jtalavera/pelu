import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Heading, Text } from "@design-system";
import { ProfessionalTodayAppointments } from "../components/ProfessionalTodayAppointments";
import { ServiceRecordDetailModal } from "../components/ServiceRecordDetailModal";
import { TodayServiceRecords } from "../components/TodayServiceRecords";

/**
 * Inicio of a professional (regular session or shared-device PIN session): her turnos of the day
 * (create or assign / open the turno's ficha) and the open fichas of the day as cards. The server
 * only returns open fichas of today and no money; from a card she adds, changes or removes
 * services and quantities.
 */
export default function ProfessionalHomePage() {
  const { t } = useTranslation();
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
  const [fichasKey, setFichasKey] = useState(0);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" data-testid="professional-home">
      <div>
        <Heading as="h1" className="text-2xl">
          {t("femme.nav.dashboard")}
        </Heading>
        <Text variant="muted">{t("femme.serviceRecords.today.proHint")}</Text>
      </div>
      <ProfessionalTodayAppointments
        onOpenRecord={setOpenRecordId}
        onChanged={() => setFichasKey((k) => k + 1)}
      />
      <TodayServiceRecords professionalMode refreshKey={fichasKey} />
      {openRecordId !== null ? (
        <ServiceRecordDetailModal
          professionalMode
          serviceRecordId={openRecordId}
          onClose={() => setOpenRecordId(null)}
          onChanged={() => setFichasKey((k) => k + 1)}
        />
      ) : null}
    </div>
  );
}
