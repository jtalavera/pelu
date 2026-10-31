import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getSessionDetail, type CashSessionDetail } from "../api/cashSessions";
import { CashSessionSummaryCard } from "./CashSessionSummaryCard";

export function CashSessionDetailModal({
  sessionId,
  onClose,
}: {
  sessionId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t("femme.billing.cashHistory.detailTitle")}
          {detail && (
            <Badge variant={detail.isOpen ? "success" : "secondary"}>
              {t(detail.isOpen ? "femme.billing.cashHistory.statusOpenBadge" : "femme.billing.cashHistory.statusClosedBadge")}
            </Badge>
          )}
        </span>
      }
      className="max-w-lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("femme.billing.movements.form.closeButton")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <Text>{t("femme.billing.cashHistory.loading")}</Text>
          </div>
        )}
        {loadError && (
          <Alert variant="destructive" title={t("femme.billing.errorTitle")}>
            {loadError}
          </Alert>
        )}
        {detail && <CashSessionSummaryCard detail={detail} />}
      </div>
    </Modal>
  );
}
