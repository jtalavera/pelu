import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getSessionDetail, type CashSessionDetail } from "../api/cashSessions";
import { useDateLocale } from "../i18n/dateLocale";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { CashSessionSummaryCard } from "./CashSessionSummaryCard";

export function CashSessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [detail, setDetail] = useState<CashSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getSessionDetail(sessionId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(translateApiError(err, t, "femme.billing.cashHistory.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, t]);

  return (
    <Modal open onClose={onClose} title={t("femme.billing.cashHistory.detailTitle")} className="max-w-2xl">
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.billing.cashHistory.loading")}</Text>
          </div>
        )}
        {loadError && (
          <>
            <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
              {loadError}
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t("femme.serviceRecords.close")}
              </Button>
            </div>
          </>
        )}
        {detail && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="font-medium">{t("femme.billing.session.metricOpenedAt")}: </span>
                {formatParaguayDateTime(detail.openedAt, dateLocale)}
              </span>
              <span>
                <span className="font-medium">{t("femme.billing.session.metricOpenedBy")}: </span>
                {detail.openedByEmail}
              </span>
              {detail.closedAt && (
                <>
                  <span>
                    <span className="font-medium">{t("femme.billing.close.closedAt")}: </span>
                    {formatParaguayDateTime(detail.closedAt, dateLocale)}
                  </span>
                  <span>
                    <span className="font-medium">{t("femme.billing.close.closedBy")}: </span>
                    {detail.closedByEmail}
                  </span>
                </>
              )}
            </div>
            <CashSessionSummaryCard detail={detail} />
          </>
        )}
      </div>
    </Modal>
  );
}
