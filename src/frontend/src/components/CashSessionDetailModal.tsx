import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Modal, Spinner, Text } from "@design-system";
import { translateApiError } from "../api/parseApiErrorMessage";
import { getSessionDetail, type CashSessionDetail } from "../api/cashSessions";
import { useDateLocale } from "../i18n/dateLocale";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";
import { formatGuaraniesGs } from "../lib/formatMoney";
import { CashSessionSummaryCard } from "./CashSessionSummaryCard";

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</div>
      <div className="text-sm font-medium text-[var(--color-ink)]">{value}</div>
    </div>
  );
}

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
    <Modal
      open
      onClose={onClose}
      title={t("femme.billing.cashHistory.detailTitle")}
      className="max-w-2xl"
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
        {detail && (
          <>
            <div>
              <Badge variant={detail.isOpen ? "success" : "secondary"}>
                {t(
                  detail.isOpen
                    ? "femme.billing.cashHistory.statusOpenBadge"
                    : "femme.billing.cashHistory.statusClosedBadge",
                )}
              </Badge>
            </div>

            <div
              className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-[var(--radius-md)] p-3 text-sm sm:grid-cols-2"
              style={{ background: "var(--color-stone)" }}
            >
              <MetaField
                label={t("femme.billing.session.metricOpenedAt")}
                value={formatParaguayDateTime(detail.openedAt, dateLocale)}
              />
              <MetaField
                label={t("femme.billing.session.metricOpenedBy")}
                value={detail.openedByEmail}
              />
              <MetaField
                label={t("femme.billing.session.metricOpeningAmount")}
                value={formatGuaraniesGs(detail.openingCashAmount)}
              />
              {detail.closedAt && (
                <>
                  <MetaField
                    label={t("femme.billing.close.closedAt")}
                    value={formatParaguayDateTime(detail.closedAt, dateLocale)}
                  />
                  <MetaField
                    label={t("femme.billing.close.closedBy")}
                    value={detail.closedByEmail ?? "—"}
                  />
                </>
              )}
            </div>

            <div
              className="rounded-[var(--radius-md)] p-3"
              style={{ background: "var(--color-white)", border: "var(--border-default)" }}
            >
              <CashSessionSummaryCard detail={detail} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
