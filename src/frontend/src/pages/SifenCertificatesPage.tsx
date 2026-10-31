import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Heading, Modal, PageSizeSelect, Pagination, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";
import { SifenCertificatesPanel } from "../components/SifenCertificatesPanel";
import { SifenCscSection } from "../components/SifenCscSection";
import { useDateLocale } from "../i18n/dateLocale";
import { useMe } from "../hooks/useMe";
import { useFeatureFlagsState } from "../hooks/useFeatureFlags";
import { buildInputStyle, labelStyle } from "../components/sifenFormStyles";

type SifenNumberVoidingStatus =
  | "PENDING"
  | "APPROVED"
  | "APPROVED_WITH_OBSERVATION"
  | "REJECTED"
  | "CANCELLED";

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

type SifenNumberVoidingRow = {
  id: number;
  documentType: string;
  rangeFrom: number;
  rangeTo: number;
  reason: string | null;
  status: SifenNumberVoidingStatus;
  deadlineDate: string;
  message: string | null;
  invoiceId: number | null;
  // Issue #205 AC-4: true when a PENDING/REJECTED event's range is already fully covered by a
  // separate, approved voiding — nothing left to resolve even though its own status looks
  // actionable.
  supersededByApproved: boolean;
};

// Issue #194: the "Numeración inutilizada" tab paginates this list server-side, like the invoice
// history table. `pendingCount` / `soonestPendingDeadline` are tenant-wide (across every page) so
// the summary line stays correct while paging.
type PagedNumberVoiding = {
  content: SifenNumberVoidingRow[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  pendingCount: number;
  soonestPendingDeadline: string | null;
};

type SifenSettingsTab = "certificate" | "csc" | "numberVoiding";

export default function SifenCertificatesPage() {
  const { t } = useTranslation();
  const { me } = useMe();
  const dateLocale = useDateLocale();
  const isTenantAdmin = me?.role === "ADMIN";
  const { flags, loading: flagsLoading } = useFeatureFlagsState();
  const sifenEnabled = flags["SIFEN_ELECTRONIC_INVOICING"] ?? false;

  const [openSections, setOpenSections] = useState<Record<SifenSettingsTab, boolean>>({
    certificate: true,
    csc: false,
    numberVoiding: false,
  });
  const [manualOpen, setManualOpen] = useState(false);



  const [voiding, setVoiding] = useState<PagedNumberVoiding | null>(null);
  const [voidingLoadError, setVoidingLoadError] = useState<string | null>(null);
  const [voidingPageNum, setVoidingPageNum] = useState(0);
  const [voidingPageSize, setVoidingPageSize] = useState(10);
  const [voidingReasons, setVoidingReasons] = useState<Record<number, string>>({});
  const [voidingSubmitting, setVoidingSubmitting] = useState<number | null>(null);
  const [voidingSubmitErrors, setVoidingSubmitErrors] = useState<Record<number, string>>({});

  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualErrors, setManualErrors] = useState<Record<string, string | null>>({});
  const [focusField, setFocusField] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const loadVoiding = useCallback(
    async (page: number, size: number) => {
      if (!isTenantAdmin) return;
      setVoidingLoadError(null);
      try {
        const qs = new URLSearchParams({ page: String(page), size: String(size) });
        const data = await femmeJson<PagedNumberVoiding>(
          `/api/sifen/number-voiding?${qs.toString()}`,
        );
        setVoiding(data);
        // Stranded past the last page (rows shrank, or a stale page number): snap back.
        if (data.totalPages > 0 && page > data.totalPages - 1) {
          setVoidingPageNum(data.totalPages - 1);
        }
      } catch {
        setVoidingLoadError(t("femme.sifenNumberVoiding.loadError"));
      }
    },
    [t, isTenantAdmin],
  );

  useEffect(() => {
    void loadVoiding(voidingPageNum, voidingPageSize);
  }, [loadVoiding, voidingPageNum, voidingPageSize]);

  async function submitVoiding(id: number, fallbackReason: string) {
    // The textarea displays voidingReasons[id] ?? row.reason ?? "" (a pre-filled reason from
    // creation counts as valid input even if the admin never touched the field) — validation here
    // must fall back the same way, or a pre-filled reason wrongly triggers "too short".
    const reason = (voidingReasons[id] ?? fallbackReason ?? "").trim();
    setVoidingSubmitErrors((prev) => ({ ...prev, [id]: "" }));
    if (reason.length < 5) {
      setVoidingSubmitErrors((prev) => ({
        ...prev,
        [id]: t("femme.sifenNumberVoiding.reasonTooShort"),
      }));
      return;
    }
    setVoidingSubmitting(id);
    try {
      await femmePostJson<SifenNumberVoidingRow>(`/api/sifen/number-voiding/${id}/submit`, {
        reason,
      });
      await loadVoiding(voidingPageNum, voidingPageSize);
    } catch (err) {
      setVoidingSubmitErrors((prev) => ({
        ...prev,
        [id]: translateApiError(err, t, "femme.apiErrors.GENERIC"),
      }));
    } finally {
      setVoidingSubmitting(null);
    }
  }

  async function createManualVoiding() {
    setManualError(null);
    setManualSuccess(false);
    const from = parsePositiveInt(manualFrom);
    const to = parsePositiveInt(manualTo);
    const reason = manualReason.trim();
    const errs: Record<string, string | null> = {};
    if (from == null || to == null) {
      errs.range = t("femme.sifenNumberVoiding.manualRangeInvalid");
    } else if (from > to) {
      errs.range = t("femme.sifenNumberVoiding.manualRangeOrder");
    }
    if (reason.length < 5) {
      errs.reason = t("femme.sifenNumberVoiding.reasonTooShort");
    }
    setManualErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setManualSubmitting(true);
    try {
      await femmePostJson<SifenNumberVoidingRow>("/api/sifen/number-voiding", {
        rangeFrom: from,
        rangeTo: to,
        reason,
      });
      setManualFrom("");
      setManualTo("");
      setManualReason("");
      setManualSuccess(true);
      setManualOpen(false);
      // The new row sorts by deadline; jump back to the first page so it is visible.
      if (voidingPageNum === 0) {
        await loadVoiding(0, voidingPageSize);
      } else {
        setVoidingPageNum(0);
      }
    } catch (err) {
      setManualError(translateApiError(err, t, "femme.apiErrors.GENERIC"));
    } finally {
      setManualSubmitting(false);
    }
  }

  function deadlineLabel(deadlineDate: string): { text: string; overdue: boolean } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(`${deadlineDate}T00:00:00`);
    const days = Math.round((deadline.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (days < 0) {
      return { text: t("femme.sifenNumberVoiding.deadlineOverdue"), overdue: true };
    }
    return { text: t("femme.sifenNumberVoiding.deadlineDaysLeft", { count: days }), overdue: false };
  }

  function voidingStatusBadge(status: SifenNumberVoidingStatus) {
    const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold whitespace-nowrap";
    if (status === "APPROVED" || status === "APPROVED_WITH_OBSERVATION") {
      return (
        <span className={`${base} bg-success-lt text-success`}>
          {t(
            status === "APPROVED"
              ? "femme.sifenNumberVoiding.statusApproved"
              : "femme.sifenNumberVoiding.statusApprovedWithObservation",
          )}
        </span>
      );
    }
    if (status === "REJECTED") {
      return <span className={`${base} bg-danger-lt text-danger`}>{t("femme.sifenNumberVoiding.statusRejected")}</span>;
    }
    if (status === "CANCELLED") {
      return <span className={`${base} border border-line text-ink-3`}>{t("femme.sifenNumberVoiding.statusCancelled")}</span>;
    }
    return <span className={`${base} bg-warning-lt text-warning`}>{t("femme.sifenNumberVoiding.statusPending")}</span>;
  }

  function fmtDate(iso: string): string {
    try {
      return new Intl.DateTimeFormat(dateLocale, { dateStyle: "medium" }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  if (!isTenantAdmin) {
    return (
      <div>
        <Heading as="h2" className="text-ink">
          {t("femme.sifenCertificates.title")}
        </Heading>
        <p className="mt-2 text-sm text-ink-2" role="alert">
          {t("femme.sifenCertificates.forbidden")}
        </p>
      </div>
    );
  }

  if (flagsLoading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "40vh",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Spinner size="lg" />
        <Text>{t("femme.sifenCertificates.loading")}</Text>
      </div>
    );
  }

  if (!sifenEnabled) {
    return (
      <div>
        <Heading as="h2" className="text-[var(--color-ink)]">
          {t("femme.sifenCertificates.title")}
        </Heading>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]" role="alert">
          {t("femme.sifenCertificates.featureDisabled")}
        </p>
      </div>
    );
  }

  const voidingRows = voiding?.content ?? null;
  const voidingTotalPages = voiding?.totalPages ?? 0;
  const voidingTotalElements = voiding?.totalElements ?? 0;
  const voidingShowingFrom =
    voidingTotalElements === 0 ? 0 : voidingPageNum * voidingPageSize + 1;
  const voidingShowingTo = Math.min((voidingPageNum + 1) * voidingPageSize, voidingTotalElements);

  const toggle = (k: SifenSettingsTab) => setOpenSections((o) => ({ ...o, [k]: !o[k] }));
  const foldBtn =
    "flex min-h-12 w-full items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left font-heading font-extrabold text-ink";
  const fold = (k: SifenSettingsTab, label: string) => (
    <button
      type="button"
      aria-expanded={openSections[k]}
      aria-controls={`sifen-section-${k}`}
      data-testid={`sifen-fold-${k}`}
      onClick={() => toggle(k)}
      className={foldBtn}
    >
      {label}
      <span aria-hidden className={`text-ink-3 transition-transform ${openSections[k] ? "rotate-180" : ""}`}>
        ⌄
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="px-0.5 text-sm text-ink-3">{t("femme.sifenSettings.intro")}</p>

      {fold("certificate", t("femme.sifenSettings.tab.certificate"))}
      <div id="sifen-section-certificate" hidden={!openSections.certificate}>
        {/* Read-only: the certificate is loaded by the platform's root user, not by the salon. */}
        <SifenCertificatesPanel />
      </div>

      {fold("csc", t("femme.sifenSettings.tab.csc"))}
      <div id="sifen-section-csc" hidden={!openSections.csc}>
        {openSections.csc ? <SifenCscSection /> : null}
      </div>

      {fold("numberVoiding", t("femme.sifenSettings.tab.numberVoiding"))}
      <div id="sifen-section-numberVoiding" hidden={!openSections.numberVoiding}>
        <section data-testid="sifen-number-voiding-section" className="flex flex-col gap-3">
          <Text variant="small" className="text-ink-3">
            {t("femme.sifenNumberVoiding.lead")}
          </Text>

          {voiding && voiding.pendingCount > 0 && voiding.soonestPendingDeadline
            ? (() => {
                const dl = deadlineLabel(voiding.soonestPendingDeadline);
                return (
                  <p
                    data-testid="sifen-number-voiding-summary"
                    className={`text-sm font-semibold ${dl.overdue ? "text-danger" : "text-ink-2"}`}
                  >
                    {t("femme.sifenNumberVoiding.pendingSummary", {
                      count: voiding.pendingCount,
                      deadline: fmtDate(`${voiding.soonestPendingDeadline}T00:00:00`),
                    })}
                  </p>
                );
              })()
            : null}

          {manualSuccess ? (
            <Alert variant="success" data-testid="sifen-number-voiding-manual-success">
              {t("femme.sifenNumberVoiding.manualCreated")}
            </Alert>
          ) : null}

          {voidingLoadError ? (
            <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
              {voidingLoadError}
            </Alert>
          ) : voidingRows == null ? (
            <Text variant="small" className="text-ink-3">
              {t("femme.sifenNumberVoiding.loading")}
            </Text>
          ) : voidingRows.length === 0 ? (
            <div className="flex flex-col gap-3">
              <Text variant="muted">{t("femme.sifenNumberVoiding.empty")}</Text>
              {voidingPageNum > 0 ? (
                <Pagination
                  page={voidingPageNum + 1}
                  pageCount={Math.max(voidingTotalPages, voidingPageNum + 1)}
                  onPageChange={(p) => setVoidingPageNum(p - 1)}
                  previousLabel={t("femme.pagination.previous")}
                  nextLabel={t("femme.pagination.next")}
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-card border border-line bg-surface shadow-sm">
              <ul>
                {voidingRows.map((row) => {
                  // Issue #205 AC-3: once SIFEN has resolved this event (approved, or superseded by a
                  // separately-approved covering range) there's no deadline left to track — same
                  // treatment as CANCELLED.
                  const resolved =
                    row.status === "CANCELLED" ||
                    row.status === "APPROVED" ||
                    row.status === "APPROVED_WITH_OBSERVATION" ||
                    row.supersededByApproved;
                  const deadline = deadlineLabel(row.deadlineDate);
                  const submittable =
                    (row.status === "PENDING" || row.status === "REJECTED") && !row.supersededByApproved;
                  return (
                    <li
                      key={row.id}
                      data-testid="sifen-number-voiding-row"
                      className="flex flex-col gap-2 border-t border-line px-4 py-3 first:border-t-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">
                            {row.documentType} {row.rangeFrom}
                            {row.rangeTo !== row.rangeFrom ? `–${row.rangeTo}` : ""}
                          </div>
                          <div className={`text-sm ${!resolved && deadline.overdue ? "text-danger" : "text-ink-3"}`}>
                            {row.invoiceId != null ? `${t("femme.sifenNumberVoiding.automaticBadge")} · ` : ""}
                            {row.supersededByApproved ? `${t("femme.sifenNumberVoiding.supersededBadge")} · ` : ""}
                            {resolved ? "—" : deadline.text}
                          </div>
                        </div>
                        {voidingStatusBadge(row.status)}
                      </div>
                      {row.message ? (
                        <Text variant="small" className="text-ink-3">
                          {t("femme.sifenNumberVoiding.resultMessage", { message: row.message })}
                        </Text>
                      ) : null}
                      {submittable ? (
                        <div className="flex flex-col gap-2">
                          <label htmlFor={`voiding-reason-${row.id}`} style={labelStyle}>
                            {t("femme.sifenNumberVoiding.reasonLabel")}
                          </label>
                          <textarea
                            id={`voiding-reason-${row.id}`}
                            value={voidingReasons[row.id] ?? row.reason ?? ""}
                            placeholder={t("femme.sifenNumberVoiding.reasonPlaceholder")}
                            onChange={(e) =>
                              setVoidingReasons((prev) => ({ ...prev, [row.id]: e.target.value }))
                            }
                            aria-invalid={!!voidingSubmitErrors[row.id]}
                            aria-describedby={
                              voidingSubmitErrors[row.id] ? `voiding-reason-${row.id}-err` : undefined
                            }
                            style={{
                              ...buildInputStyle(!!voidingSubmitErrors[row.id], false),
                              minHeight: 60,
                            }}
                          />
                          <FieldValidationError id={`voiding-reason-${row.id}-err`}>
                            {voidingSubmitErrors[row.id] || null}
                          </FieldValidationError>
                          <div>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="min-h-11"
                              disabled={voidingSubmitting === row.id}
                              onClick={() => void submitVoiding(row.id, row.reason ?? "")}
                            >
                              {voidingSubmitting === row.id
                                ? t("femme.sifenNumberVoiding.submitting")
                                : t("femme.sifenNumberVoiding.submit")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <PageSizeSelect
                  value={voidingPageSize}
                  onChange={(s) => {
                    setVoidingPageSize(s);
                    setVoidingPageNum(0);
                  }}
                  label={t("femme.pagination.rowsPerPage")}
                />
                <Text variant="small" className="text-ink-3">
                  {t("femme.pagination.showingRange", {
                    from: voidingShowingFrom,
                    to: voidingShowingTo,
                    total: voidingTotalElements,
                  })}
                </Text>
                <Pagination
                  page={voidingPageNum + 1}
                  pageCount={voidingTotalPages}
                  onPageChange={(p) => setVoidingPageNum(p - 1)}
                  previousLabel={t("femme.pagination.previous")}
                  nextLabel={t("femme.pagination.next")}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            data-testid="sifen-number-voiding-manual-open"
            onClick={() => {
              setManualSuccess(false);
              setManualError(null);
              setManualOpen(true);
            }}
            className="min-h-11 self-start px-1 text-sm font-bold text-primary underline underline-offset-4"
          >
            + {t("femme.sifenNumberVoiding.manualTitle")}
          </button>
        </section>
      </div>

      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title={t("femme.sifenNumberVoiding.manualTitle")}
        description={t("femme.sifenNumberVoiding.manualLead")}
        className="max-w-lg"
        footer={
          <>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={() => setManualOpen(false)}>
              {t("femme.fiscalStamp.cancel")}
            </Button>
            <Button
              type="submit"
              form="sifen-number-voiding-manual-form"
              className="min-h-11 w-full sm:w-auto"
              disabled={manualSubmitting}
            >
              {manualSubmitting
                ? t("femme.sifenNumberVoiding.manualSubmitting")
                : t("femme.sifenNumberVoiding.manualSubmit")}
            </Button>
          </>
        }
      >
        <form
          id="sifen-number-voiding-manual-form"
          data-testid="sifen-number-voiding-manual-form"
          onSubmit={(e) => {
            e.preventDefault();
            void createManualVoiding();
          }}
          noValidate
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-range-from" style={labelStyle}>
                {t("femme.sifenNumberVoiding.manualRangeFromLabel")}
              </label>
              <input
                id="manual-range-from"
                inputMode="numeric"
                value={manualFrom}
                onChange={(e) => {
                  setManualFrom(e.target.value);
                  setManualErrors((p) => ({ ...p, range: null }));
                }}
                aria-invalid={!!manualErrors.range}
                aria-describedby={manualErrors.range ? "manual-range-err" : undefined}
                onFocus={() => setFocusField("manual-range-from")}
                onBlur={() => setFocusField(null)}
                style={buildInputStyle(!!manualErrors.range, focusField === "manual-range-from")}
              />
            </div>
            <div>
              <label htmlFor="manual-range-to" style={labelStyle}>
                {t("femme.sifenNumberVoiding.manualRangeToLabel")}
              </label>
              <input
                id="manual-range-to"
                inputMode="numeric"
                value={manualTo}
                onChange={(e) => {
                  setManualTo(e.target.value);
                  setManualErrors((p) => ({ ...p, range: null }));
                }}
                aria-invalid={!!manualErrors.range}
                aria-describedby={manualErrors.range ? "manual-range-err" : undefined}
                onFocus={() => setFocusField("manual-range-to")}
                onBlur={() => setFocusField(null)}
                style={buildInputStyle(!!manualErrors.range, focusField === "manual-range-to")}
              />
            </div>
          </div>
          <FieldValidationError id="manual-range-err">{manualErrors.range || null}</FieldValidationError>
          <div>
            <label htmlFor="manual-reason" style={labelStyle}>
              {t("femme.sifenNumberVoiding.manualReasonLabel")}
            </label>
            <textarea
              id="manual-reason"
              value={manualReason}
              placeholder={t("femme.sifenNumberVoiding.reasonPlaceholder")}
              onChange={(e) => {
                setManualReason(e.target.value);
                setManualErrors((p) => ({ ...p, reason: null }));
              }}
              aria-invalid={!!manualErrors.reason}
              aria-describedby={manualErrors.reason ? "manual-reason-err" : undefined}
              onFocus={() => setFocusField("manual-reason")}
              onBlur={() => setFocusField(null)}
              style={{
                ...buildInputStyle(!!manualErrors.reason, focusField === "manual-reason"),
                minHeight: 60,
              }}
            />
            <FieldValidationError id="manual-reason-err">{manualErrors.reason || null}</FieldValidationError>
          </div>
          {manualError ? (
            <Alert variant="destructive" title={t("femme.sifenCertificates.errorTitle")}>
              {manualError}
            </Alert>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
