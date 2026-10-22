import { useTranslation } from "react-i18next";
import { Modal } from "@design-system";
import { ClientTechnicalSheetForm } from "./ClientTechnicalSheetForm";

/**
 * HU-68 AC6–8: the technical sheet opened on top of the calendar's appointment detail or form.
 * Render it after those modals so it stacks above them; while it is open, the modal below must
 * ignore its own close requests (Escape reaches every open modal).
 */
export function ClientTechnicalSheetModal({
  clientId,
  onClose,
}: {
  clientId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={clientId !== null}
      onClose={onClose}
      title={t("femme.clients.technicalSheet.title")}
      className="sm:max-w-xl"
    >
      {clientId !== null ? (
        <ClientTechnicalSheetForm clientId={clientId} showClientName onCancel={onClose} />
      ) : null}
    </Modal>
  );
}
