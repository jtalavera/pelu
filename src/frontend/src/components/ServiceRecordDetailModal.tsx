import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getServiceRecord, type ServiceRecordDetail } from "../api/serviceRecords";
import { fetchProfessionalOptions } from "../api/professionalOptions";
import { getFrequentServices } from "../api/serviceRecords";
import { ServiceRecordEditor, type ServiceRecordEditorPreload } from "./ServiceRecordEditor";
import { ServiceRecordStatusPill } from "./ServiceRecordStatusPill";

export function ServiceRecordDetailModal({
  serviceRecordId,
  onClose,
  onChanged,
  professionalMode = false,
}: {
  /** A professional edits services and quantities only (no money, tips, void or "Cobrar"). */
  professionalMode?: boolean;
  serviceRecordId: number;
  onClose: () => void;
  /** Called after the record was saved or voided; the dialog closes itself right after. */
  onChanged?: (kind: "updated" | "voided") => void;
}) {
  const { t } = useTranslation();
  const [record, setRecord] = useState<ServiceRecordDetail | null>(null);
  // The professionals and the frequent services do not depend on the ficha: ask for them right now,
  // in parallel with it, instead of after the editor mounts (three requests one after another).
  const [preload] = useState<ServiceRecordEditorPreload>(() => ({
    professionals: fetchProfessionalOptions(),
    frequentServices: professionalMode
      ? Promise.resolve([])
      : getFrequentServices(3)
          .then((items) => (Array.isArray(items) ? items : []))
          .catch(() => []),
  }));
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
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {t("femme.serviceRecords.detailTitle")}
          {record ? <ServiceRecordStatusPill status={record.status} /> : null}
        </span>
      }
      className="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.serviceRecords.loading")}</Text>
          </div>
        )}
        {loadError && (
          <>
            <Alert variant="destructive" title={t("femme.serviceRecords.errorTitle")}>
              {loadError}
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t("femme.serviceRecords.close")}
              </Button>
            </div>
          </>
        )}
        {record && (
          <ServiceRecordEditor
            initial={record}
            allowClientCreateNew={false}
            professionalMode={professionalMode}
            preload={preload}
            onSaved={() => {
              onChanged?.("updated");
              onClose();
            }}
            onVoided={() => {
              onChanged?.("voided");
              onClose();
            }}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
