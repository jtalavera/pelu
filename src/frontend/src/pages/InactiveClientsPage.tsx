import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Alert, Button, DataTable, PageSizeSelect, Pagination, Spinner, Text } from "@design-system";
import { femmeJson } from "../api/femmeClient";
import type { PageResponse } from "../api/pagination";
import { translateApiError } from "../api/parseApiErrorMessage";
import { useDateLocale } from "../i18n/dateLocale";
import { formatParaguayDateTime } from "../lib/paraguayDateTime";

type InactiveClient = {
  clientId: number;
  fullName: string;
  phone: string | null;
  daysSinceLastVisit: number;
  lastVisitAt: string;
};

/** Issue #216 follow-up: "Ver todas" — the full, paginated inactive-clients list. */
export default function InactiveClientsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dateLocale = useDateLocale();

  const [pageNum, setPageNum] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<PageResponse<InactiveClient> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (page: number, size: number) => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await femmeJson<PageResponse<InactiveClient>>(
          `/api/dashboard/inactive-clients?page=${page}&size=${size}`,
        );
        setData(result);
      } catch (err) {
        setLoadError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(pageNum, pageSize);
  }, [load, pageNum, pageSize]);

  const clients = data?.content ?? [];
  const totalElements = data?.totalElements ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const showingFrom = totalElements === 0 ? 0 : pageNum * pageSize + 1;
  const showingTo = Math.min((pageNum + 1) * pageSize, totalElements);

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate("/app")}
        className="self-start"
      >
        ← {t("femme.inactiveClients.backToDashboard")}
      </Button>

      <div>
        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-ink)" }}>
          {t("femme.inactiveClients.pageTitle")}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
          {t("femme.inactiveClients.pageSubtitle")}
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive" title={t("femme.inactiveClients.errorTitle")}>
          {loadError}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Text>{t("femme.inactiveClients.loading")}</Text>
        </div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col gap-3">
          <Text variant="muted">{t("femme.inactiveClients.empty")}</Text>
          {pageNum > 0 && (
            <Pagination
              page={pageNum + 1}
              pageCount={Math.max(totalPages, pageNum + 1)}
              onPageChange={(p) => setPageNum(p - 1)}
              previousLabel={t("femme.pagination.previous")}
              nextLabel={t("femme.pagination.next")}
            />
          )}
        </div>
      ) : (
        <div
          style={{
            background: "var(--color-white)",
            borderRadius: "var(--radius-xl)",
            border: "var(--border-default)",
            overflow: "hidden",
          }}
        >
          <DataTable<InactiveClient>
            className="px-2"
            minWidthClassName="min-w-[32rem]"
            rows={clients}
            getRowId={(c) => c.clientId}
            rowTestId={() => "inactive-clients-row"}
            onRowClick={(c) => navigate(`/app/clients/${c.clientId}`)}
            rowLabel={(c) => c.fullName}
            columns={[
              { id: "client", header: t("femme.inactiveClients.colClient"), cell: (c) => c.fullName },
              { id: "phone", header: t("femme.inactiveClients.colPhone"), cell: (c) => c.phone ?? "—" },
              {
                id: "lastVisit",
                header: t("femme.inactiveClients.colLastVisit"),
                cell: (c) => formatParaguayDateTime(c.lastVisitAt, dateLocale),
              },
              {
                id: "inactivity",
                header: t("femme.inactiveClients.colInactivity"),
                align: "right",
                cell: (c) => t("femme.inactiveClients.daysValue", { days: c.daysSinceLastVisit }),
              },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-default)]">
            <PageSizeSelect
              value={pageSize}
              onChange={(s) => {
                setPageSize(s);
                setPageNum(0);
              }}
              label={t("femme.pagination.rowsPerPage")}
            />
            <Text variant="small" className="text-[var(--color-ink-3)]">
              {t("femme.pagination.showingRange", {
                from: showingFrom,
                to: showingTo,
                total: totalElements,
              })}
            </Text>
            <Pagination
              page={pageNum + 1}
              pageCount={totalPages}
              onPageChange={(p) => setPageNum(p - 1)}
              previousLabel={t("femme.pagination.previous")}
              nextLabel={t("femme.pagination.next")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
