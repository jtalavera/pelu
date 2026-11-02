import { useTranslation } from "react-i18next";
import { Heading, Text } from "@design-system";
import { TodayServiceRecords } from "../components/TodayServiceRecords";

/**
 * Inicio of a professional (regular session or shared-device PIN session): the open fichas of the
 * day as cards, the first screen she sees. The server only returns open fichas of today and no
 * money; from a card she adds, changes or removes services and quantities.
 */
export default function ProfessionalHomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4" data-testid="professional-home">
      <div>
        <Heading as="h1" className="text-2xl">
          {t("femme.nav.dashboard")}
        </Heading>
        <Text variant="muted">{t("femme.serviceRecords.today.proHint")}</Text>
      </div>
      <TodayServiceRecords professionalMode />
    </div>
  );
}
