import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getServiceRecord, type ServiceRecordDetail } from "../api/serviceRecords";
import { ServiceRecordEditor } from "./ServiceRecordEditor";

export function ServiceRecordDetailModal({
  serviceRecordId,
  onClose,
  onChanged,
}: {
  serviceRecordId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [record, setRecord] = useState<ServiceRecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getServiceRecord(serviceRecordId)
      .then((data) => {
        if (!cancelled) setRecord(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(translateApiError(err, t, "femme.serviceRecords.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceRecordId, t]);

  return (
    <Modal open onClose={onClose} title={t("femme.serviceRecords.detailTitle")}>
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.serviceRecords.loading")}</Text>
          </div>
        )}
        {loadError && (
          <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
            {loadError}
          </Alert>
        )}
        {record && (
          <ServiceRecordEditor
            initial={record}
            allowClientCreateNew={false}
            onSaved={() => onChanged?.()}
            onVoided={() => onChanged?.()}
          />
        )}
        <div className="flex justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("femme.serviceRecords.close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
