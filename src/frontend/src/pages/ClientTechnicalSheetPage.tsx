import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, Heading } from "@design-system";
import { ClientTechnicalSheetForm } from "../components/ClientTechnicalSheetForm";

/** HU-68 AC9: `/app/clients/:id/technical-sheet` — the professional's view of a client. */
export default function ClientTechnicalSheetPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const clientId = Number(id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate("/app/clients")}
        className="self-start"
      >
        ← {t("femme.clients.backToList")}
      </Button>
      <Heading as="h1">{t("femme.clients.technicalSheet.title")}</Heading>
      <Card className="p-4 sm:p-6">
        {Number.isFinite(clientId) ? (
          <ClientTechnicalSheetForm clientId={clientId} showClientName />
        ) : null}
      </Card>
    </div>
  );
}
