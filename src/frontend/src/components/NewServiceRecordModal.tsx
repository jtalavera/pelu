import { useTranslation } from "react-i18next";
import { Modal } from "@design-system";
import { ServiceRecordEditor } from "./ServiceRecordEditor";

/** "Nueva ficha" dialog: pick a client (or "Cliente ocasional"), services and professionals. */
export function NewServiceRecordModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t("femme.serviceRecords.newTitle")} className="max-w-xl">
      {open ? (
        <ServiceRecordEditor
          initial={null}
          allowClientCreateNew
          onSaved={() => {
            onClose();
            onSaved();
          }}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}
