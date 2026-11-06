import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getServiceRecord, type ServiceRecordDetail } from "../api/serviceRecords";
import { fetchProfessionalOptions } from "../api/professionalOptions";
import { InvoiceDetailModal } from "./InvoiceDetailModal";
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
  // The professionals do not depend on the ficha: ask for them right now, in parallel with it,
  // instead of after the editor mounts (two requests one after another).
  const [preload] = useState<ServiceRecordEditorPreload>(() => ({
    professionals: fetchProfessionalOptions(),
  }));
  const [loading, setLoading] = useState(true);
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
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
  }, [serviceRecordId, t, reloadTick]);

  return (
    <>
    <Modal
      open
      onClose={() => {
        if (viewInvoiceId === null) onClose();
      }}
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
            key={reloadTick}
            initial={record}
            allowClientCreateNew={false}
            professionalMode={professionalMode}
            preload={preload}
            onViewInvoice={setViewInvoiceId}
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

    {viewInvoiceId !== null ? (
      <InvoiceDetailModal
        invoiceId={viewInvoiceId}
        onClose={() => setViewInvoiceId(null)}
        onVoided={() => {
          // The comprobante was anulado: the ficha may have changed, so load it again.
          setViewInvoiceId(null);
          setReloadTick((n) => n + 1);
          onChanged?.("updated");
        }}
      />
    ) : null}
    </>
  );
}
