import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { SearchInput } from "../components/ui/SearchInput";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  Label,
  Modal,
  Pagination,
  PageSizeSelect,
  Spinner,
  Switch,
  Text,
  TimeCombobox,
} from "@design-system";
import { femmePostJson, femmePutJson } from "../api/femmeClient";
import { listProfessionalsPaged } from "../api/professionals";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { unlockProfessionalPin } from "../api/sharedDevices";
import { FieldValidationError } from "../components/FieldValidationError";
import {
  ProfessionalAccessSection,
  type ProfessionalAccessStatus,
} from "../components/ProfessionalAccessSection";
import {
  formatParaguayPhone,
  isCompleteParaguayPhone,
} from "../lib/paraguayPhone";
import { isValidEmail } from "../lib/validateEmail";
import {
  PROFESSIONAL_PHOTO_ACCEPT,
  type ProfessionalPhotoValidationErrorCode,
  validateAndReadProfessionalPhotoFile,
} from "../utils/professionalPhotoUpload";
import { useFeatureFlag } from "../hooks/useFeatureFlags";
import { useTour } from "../tour/useTour";
import { professionalsSteps } from "../tour/steps/professionals";

function getInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

type Schedule = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  active: boolean;
};
type Professional = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  photoDataUrl: string | null;
  active: boolean;
  schedules: Schedule[];
  hasPinSet: boolean;
  systemAccessAllowed: boolean;
  hasUserAccount: boolean;
  // Issue #38 (4)/(5)
  accessStatus: ProfessionalAccessStatus | null;
  accessLoginEmail: string | null;
  invitationSentAt: string | null;
  invitationExpiresAt: string | null;
  resendAvailableAt: string | null;
  // HU-66: shared devices where her PIN login is locked right now
  pinLocks?: Array<{ deviceId: number; deviceName: string; lockedUntil: string }>;
};

type DetailErrors = {
  fullName?: string;
  phone?: string;
  email?: string;
  photo?: string;
  pin?: string;
} | null;
type ScheduleErrors = { schedules?: string } | null;

const DAYS: Array<{ value: number; key: string }> = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 7, key: "sun" },
];

/** Normalizes API time strings (e.g. "09:00:00") to HH:MM for inputs. */
function formatTimeFromApi(time: unknown): string {
  if (time == null) return "";
  const s = String(time).trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Catalog redesign: a new professional starts with Monday to Saturday, 09:00 to 18:00. */
function defaultSchedules(): Schedule[] {
  return DAYS.map((d) => ({
    dayOfWeek: d.value,
    startTime: d.value <= 6 ? "09:00" : "",
    endTime: d.value <= 6 ? "18:00" : "",
    active: d.value <= 6,
  }));
}

function schedulesFromProfessional(p: Professional | null): Schedule[] {
  if (p === null) return defaultSchedules();
  const byDay = new Map<number, { startTime: string; endTime: string }>();
  if (p?.schedules?.length) {
    for (const s of p.schedules) {
      byDay.set(s.dayOfWeek, {
        startTime: formatTimeFromApi(s.startTime),
        endTime: formatTimeFromApi(s.endTime),
      });
    }
  }
  return DAYS.map((d) => {
    const existing = byDay.get(d.value);
    const start = existing?.startTime ?? "";
    const end = existing?.endTime ?? "";
    return {
      dayOfWeek: d.value,
      startTime: start,
      endTime: end,
      active: Boolean(start && end),
    };
  });
}

function normalizeTime(s: string): string | null {
  const t = s.trim();
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function ProfessionalsPage({ actionsSlot }: { actionsSlot?: HTMLElement | null } = {}) {
  const { t, i18n } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("professionals", professionalsSteps, undefined, guidedTourEnabled);

  const [pageError, setPageError] = useState<string | null>(null);

  // ── Server-side pagination ─────────────────────────────────────────────────
  type ProfPage = { content: Professional[]; page: number; size: number; totalElements: number; totalPages: number };
  const [profPageData, setProfPageData] = useState<ProfPage | null>(null);
  const [profPageLoading, setProfPageLoading] = useState(true);
  const [listQuery, setListQuery] = useState("");
  const [profPage, setProfPage] = useState(0); // 0-based
  const [profPageSize, setProfPageSize] = useState(10);
  const [profReloadTick, setProfReloadTick] = useState(0);
  const profDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ─────────────────────────────────────────────────────────────────────────

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [savedProfessional, setSavedProfessional] = useState<Professional | null>(null);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [pin, setPin] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [systemAccessAllowed, setSystemAccessAllowed] = useState(false);
  const [accessGrantedMessage, setAccessGrantedMessage] = useState<string | null>(null);
  // Issue #38 (2): confirmation before saving an email change of a professional with access.
  const [emailChangeConfirmOpen, setEmailChangeConfirmOpen] = useState(false);
  const [pinUnlockedMessage, setPinUnlockedMessage] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<DetailErrors>(null);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);

  // schedule (summary + "Cambiar")
  const [schedules, setSchedules] = useState<Schedule[]>(() => schedulesFromProfessional(null));
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>(null);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<Professional | null>(null);
  const [activateTarget, setActivateTarget] = useState<Professional | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  /** Saving an edit closes the form and says so here, on the list screen. */
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [statusChangeSuccess, setStatusChangeSuccess] = useState<"activated" | "deactivated" | null>(
    null,
  );

  const photoFileInputRef = useRef<HTMLInputElement>(null);

  const photoValidationMessage = useCallback(
    (code: ProfessionalPhotoValidationErrorCode) => {
      switch (code) {
        case "EXTENSION_INVALID":
          return t("femme.professionals.form.photoErrorExtensionInvalid");
        case "FILE_TOO_LARGE":
          return t("femme.professionals.form.photoErrorFileTooLarge");
        case "DIMENSIONS_TOO_LARGE":
          return t("femme.professionals.form.photoErrorDimensionsTooLarge");
        case "IMAGE_LOAD_FAILED":
          return t("femme.professionals.form.photoErrorImageLoadFailed");
      }
    },
    [t],
  );

  const daysByValue = useMemo(() => new Map(DAYS.map((d) => [d.value, d.key] as const)), []);

  const loadPagedProfessionals = useCallback(
    async (q: string, page: number, size: number) => {
      setProfPageLoading(true);
      setPageError(null);
      try {
        const data = await listProfessionalsPaged<Professional>({
          q: q.trim() || undefined,
          page,
          size,
        });
        setProfPageData(data);
      } catch (err) {
        setPageError(translateApiError(err, t, "femme.professionals.loadError"));
      } finally {
        setProfPageLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (profDebounceRef.current) clearTimeout(profDebounceRef.current);
    profDebounceRef.current = setTimeout(() => {
      void loadPagedProfessionals(listQuery, profPage, profPageSize);
    }, 350);
    return () => {
      if (profDebounceRef.current) clearTimeout(profDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery, profPage, profPageSize, profReloadTick, loadPagedProfessionals]);

  // Errors of fields that live under "Más opciones" must never stay hidden.
  useEffect(() => {
    if (detailErrors?.email || detailErrors?.pin || detailErrors?.photo) setMoreOptionsOpen(true);
  }, [detailErrors]);

  function resetDetailForm(p: Professional | null) {
    setFullName(p?.fullName ?? "");
    setPhone(p?.phone ?? "");
    setEmail(p?.email ?? "");
    setPhotoDataUrl(p?.photoDataUrl ?? "");
    setPin("");
    setPinTouched(false);
    setSystemAccessAllowed(p?.systemAccessAllowed ?? false);
    setAccessGrantedMessage(null);
    setPinUnlockedMessage(null);
    setDetailErrors(null);
    setDetailSaveError(null);
    if (photoFileInputRef.current) {
      photoFileInputRef.current.value = "";
    }
  }

  function resetScheduleForm(p: Professional | null) {
    setSchedules(schedulesFromProfessional(p));
    setScheduleErrors(null);
    setScheduleSaveError(null);
  }

  function dismissProfessionalsPageSuccess() {
    setCreateSuccess(false);
    setUpdateSuccess(false);
    setStatusChangeSuccess(null);
  }

  function openNew() {
    setSavedProfessional(null);
    setMoreOptionsOpen(false);
    setScheduleOpen(false);
    resetDetailForm(null);
    resetScheduleForm(null);
    setEditSuccess(false);
    dismissProfessionalsPageSuccess();
    setModalOpen(true);
  }

  function openEdit(p: Professional) {
    setSavedProfessional(p);
    setMoreOptionsOpen(false);
    setScheduleOpen(false);
    resetDetailForm(p);
    resetScheduleForm(p);
    setEditSuccess(false);
    dismissProfessionalsPageSuccess();
    setModalOpen(true);
  }

  const onRowKeyOpenEdit =
    (p: Professional) => (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEdit(p);
      }
    };

  function closeModal() {
    setModalOpen(false);
    setSavedProfessional(null);
  }

  /**
   * Issue #38 (2): the saved email already backs a system user or a pending invitation, and the
   * form now has a different one — saving moves the access to the new email.
   */
  const savedEmailHasAccess =
    savedProfessional != null &&
    (savedProfessional.hasUserAccount ||
      (savedProfessional.accessStatus != null && savedProfessional.accessStatus !== "NO_ACCESS"));
  const emailChangesAccess =
    savedEmailHasAccess &&
    (savedProfessional?.email ?? "").trim().toLowerCase() !== email.trim().toLowerCase();

  /** Validates the schedule draft; returns the payload or null (and shows the error). */
  function buildScheduleOrError(): Array<{ dayOfWeek: number; startTime: string; endTime: string }> | null {
    setScheduleErrors(null);
    setScheduleSaveError(null);
    const normalized: Array<{ dayOfWeek: number; startTime: string; endTime: string }> = [];
    for (const d of DAYS) {
      const row = schedules.find((s) => s.dayOfWeek === d.value);
      if (!row?.active) continue;
      const rawStart = row.startTime.trim();
      const rawEnd = row.endTime.trim();
      const fail = (msg: string) => {
        setScheduleErrors({ schedules: msg });
        setScheduleOpen(true);
        return null;
      };
      if (!rawStart || !rawEnd) return fail(t("femme.professionals.form.scheduleDayIncomplete"));
      const start = normalizeTime(rawStart);
      const end = normalizeTime(rawEnd);
      if (!start || !end) return fail(t("femme.professionals.form.scheduleInvalid"));
      if (start >= end) return fail(t("femme.professionals.form.scheduleRangeInvalid"));
      normalized.push({ dayOfWeek: d.value, startTime: start, endTime: end });
    }
    return normalized;
  }

  async function saveDetails(emailChangeConfirmed = false) {
    setDetailSaveError(null);
    setAccessGrantedMessage(null);
    const nameTrim = fullName.trim();
    const phoneTrim = phone.trim();
    const emailTrim = email.trim();
    const errs: NonNullable<DetailErrors> = {};
    if (!nameTrim) {
      errs.fullName = t("femme.professionals.form.fullNameRequired");
    }
    if (phoneTrim && !isCompleteParaguayPhone(phoneTrim)) {
      errs.phone = t("femme.professionals.form.phoneInvalid");
    }
    if (emailTrim && !isValidEmail(emailTrim)) {
      errs.email = t("femme.professionals.form.emailInvalid");
    } else if (systemAccessAllowed && !emailTrim) {
      // Issue #38 (1): access always needs a valid email — whatever the sequence of steps.
      errs.email = t("femme.professionals.form.systemAccessNoEmail");
    }
    if (errs.fullName || errs.phone || errs.email) {
      if (errs.email) setMoreOptionsOpen(true);
      setDetailErrors((prev) => ({
        ...errs,
        ...(prev?.photo ? { photo: prev.photo } : {}),
      }));
      return;
    }
    const pinTrim = pin.trim();
    if (pinTouched && pinTrim && !/^\d{4,7}$/.test(pinTrim)) {
      setMoreOptionsOpen(true);
      setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.professionals.form.pinErrorFormat") }));
      return;
    }
    if (detailErrors?.photo) {
      setMoreOptionsOpen(true);
      return;
    }
    const scheduleBody = buildScheduleOrError();
    if (scheduleBody === null) return;
    if (emailChangesAccess && !emailChangeConfirmed) {
      setEmailChangeConfirmOpen(true);
      return;
    }
    setDetailSaving(true);
    try {
      const previousStatus = savedProfessional?.accessStatus ?? "NO_ACCESS";
      const previousEmail = (savedProfessional?.email ?? "").trim().toLowerCase();
      const payload = {
        fullName: nameTrim,
        phone: phone.trim() || null,
        email: email.trim() || null,
        photoDataUrl: photoDataUrl.trim(),
        pin: pinTouched ? (pinTrim || null) : undefined,
        systemAccessAllowed,
      };
      const isNew = savedProfessional === null;
      let saved: Professional;
      if (savedProfessional) {
        saved = await femmePutJson<Professional>(`/api/professionals/${savedProfessional.id}`, payload);
      } else {
        saved = await femmePostJson<Professional>("/api/professionals", payload);
      }
      // Catalog redesign: details and schedule are one form — the schedule is saved right after.
      const accessInfo = saved;
      saved = await femmePutJson<Professional>(
        `/api/professionals/${saved.id}/schedules`,
        scheduleBody,
      );
      saved = { ...accessInfo, ...saved };

      // Issue #38: the backend grants / revokes / re-invites atomically with the save.
      const newInvitation =
        saved.accessStatus === "INVITATION_SENT" &&
        (previousStatus === "NO_ACCESS" ||
          previousEmail !== (saved.email ?? "").trim().toLowerCase());
      if (newInvitation) {
        setAccessGrantedMessage(
          t("femme.professionals.form.systemAccessGranted", { email: saved.accessLoginEmail ?? saved.email }),
        );
      }

      setSavedProfessional(saved);
      setDetailErrors(null);
      setPin("");
      setPinTouched(false);
      setProfReloadTick((n) => n + 1);
      if (isNew) {
        closeModal();
        setCreateSuccess(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        closeModal();
        setUpdateSuccess(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "PIN_ALREADY_IN_USE") {
        setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.professionals.form.pinErrorDuplicate") }));
      } else if (rawCode === "PROFESSIONAL_EMAIL_DUPLICATE") {
        setDetailErrors((prev) => ({
          ...(prev ?? {}),
          email: t("femme.apiErrors.PROFESSIONAL_EMAIL_DUPLICATE"),
        }));
      } else if (
        rawCode === "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS" ||
        rawCode === "PROFESSIONAL_EMAIL_INVALID_FOR_ACCESS" ||
        rawCode === "PROFESSIONAL_EMAIL_USED_BY_ANOTHER_USER"
      ) {
        setDetailErrors((prev) => ({ ...(prev ?? {}), email: t(`femme.apiErrors.${rawCode}`) }));
      } else if (rawCode === "INVALID_PIN_FORMAT") {
        setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.apiErrors.INVALID_PIN_FORMAT") }));
      } else {
        setDetailSaveError(translateApiError(e, t, "femme.professionals.saveError"));
      }
    } finally {
      setDetailSaving(false);
    }
  }

  /** HU-66: "Desbloquear PIN" — lifts her PIN lock on every shared device. */
  async function unlockPin() {
    if (!savedProfessional) return;
    try {
      const updated = await unlockProfessionalPin<Professional>(savedProfessional.id);
      setSavedProfessional(updated);
      setPinUnlockedMessage(t("femme.professionals.form.pinUnlocked"));
      setProfReloadTick((n) => n + 1);
    } catch (e) {
      setDetailSaveError(translateApiError(e, t, "femme.apiErrors.GENERIC"));
    }
  }

  function setScheduleTime(
    dow: number,
    patch: Partial<Pick<Schedule, "startTime" | "endTime">>,
  ) {
    setSchedules((prev) => prev.map((s) => (s.dayOfWeek === dow ? { ...s, ...patch } : s)));
  }

  function toggleScheduleDay(dow: number, active: boolean) {
    setSchedules((prev) =>
      prev.map((s) => {
        if (s.dayOfWeek !== dow) return s;
        if (active) {
          return {
            ...s,
            active: true,
            startTime: s.startTime || "09:00",
            endTime: s.endTime || "19:00",
          };
        }
        return { ...s, active: false };
      }),
    );
  }

  const onPhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setDetailErrors((prev) => {
      if (!prev?.photo) return prev;
      return prev.fullName ? { fullName: prev.fullName } : null;
    });
    if (!file) return;
    const res = await validateAndReadProfessionalPhotoFile(file);
    if (!res.ok) {
      setDetailErrors((prev) => ({
        fullName: prev?.fullName,
        photo: photoValidationMessage(res.code),
      }));
      e.target.value = "";
      return;
    }
    setPhotoDataUrl(res.dataUrl);
  };

  const clearProfessionalPhoto = () => {
    setPhotoDataUrl("");
    if (photoFileInputRef.current) {
      photoFileInputRef.current.value = "";
    }
    setDetailErrors((prev) => (prev?.fullName ? { fullName: prev.fullName } : null));
  };

  function requestDeactivate(p: Professional) {
    setDeactivateTarget(p);
  }

  async function confirmDeactivate() {
    const p = deactivateTarget;
    if (!p) return;
    setDeactivateTarget(null);
    setCreateSuccess(false);
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/deactivate`, {});
      setProfReloadTick((n) => n + 1);
      setStatusChangeSuccess("deactivated");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setPageError(translateApiError(e, t, "femme.professionals.saveError"));
    }
  }

  function requestActivate(p: Professional) {
    setActivateTarget(p);
  }

  async function confirmActivate() {
    const p = activateTarget;
    if (!p) return;
    setActivateTarget(null);
    setCreateSuccess(false);
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/activate`, {});
      setProfReloadTick((n) => n + 1);
      setStatusChangeSuccess("activated");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setPageError(translateApiError(e, t, "femme.professionals.saveError"));
    }
  }

  const profContent = profPageData?.content ?? [];
  const profTotalElements = profPageData?.totalElements ?? 0;
  const profTotalPages = profPageData?.totalPages ?? 1;
  const profShowingFrom = profTotalElements === 0 ? 0 : profPage * profPageSize + 1;
  const profShowingTo = Math.min((profPage + 1) * profPageSize, profTotalElements);

  if (profPageLoading && !profPageData) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.professionals.loading")}</Text>
      </div>
    );
  }

  // Matches the search input's text size (SearchInput.tsx) so the page-header message
  // boxes read as a smaller, secondary element instead of competing with the list.
  const pageAlertStyle: React.CSSProperties = { fontSize: 12, padding: "8px 12px" };

  const actionsNode = (
    <Button
      type="button"
      variant="primary"
      className="min-h-11"
      data-tour="professionals-new"
      data-testid="catalog-new-button"
      onClick={openNew}
    >
      {t("femme.professionals.addNew")}
    </Button>
  );

  /** "Lunes a sábado · de 09:00 a 18:00" — or a generic label when the days differ. */
  const activeScheduleRows = schedules.filter((r) => r.active);
  const scheduleSummary = (() => {
    if (activeScheduleRows.length === 0) return t("femme.professionals.dayOff");
    const sameHours = activeScheduleRows.every(
      (r) => r.startTime === activeScheduleRows[0].startTime && r.endTime === activeScheduleRows[0].endTime,
    );
    const monToSat =
      activeScheduleRows.length === 6 && activeScheduleRows.every((r) => r.dayOfWeek >= 1 && r.dayOfWeek <= 6);
    if (!sameHours || !monToSat) return t("femme.catalog.scheduleCustom");
    return t("femme.catalog.scheduleSummary", {
      days: t("femme.catalog.scheduleDefault"),
      start: activeScheduleRows[0].startTime,
      end: activeScheduleRows[0].endTime,
    });
  })();

  return (
    <div className="flex min-w-0 flex-col">
      {actionsSlot === undefined ? (
        <div className="mb-3 flex justify-end">{actionsNode}</div>
      ) : actionsSlot ? (
        createPortal(actionsNode, actionsSlot)
      ) : null}

      {/* ── Success / Error ── */}
      {(createSuccess || updateSuccess || statusChangeSuccess || pageError) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {createSuccess && (
            <Alert variant="success" style={pageAlertStyle}>
              {t("femme.professionals.createSuccess")}
            </Alert>
          )}
          {updateSuccess && (
            <Alert variant="success" style={pageAlertStyle} data-testid="catalog-update-success">
              {t("femme.professionals.editSuccess")}
            </Alert>
          )}
          {statusChangeSuccess && (
            <Alert variant="success" style={pageAlertStyle}>
              {statusChangeSuccess === "activated"
                ? t("femme.professionals.activateSuccess")
                : t("femme.professionals.deactivateSuccess")}
            </Alert>
          )}
          {pageError && (
            <Alert variant="destructive" title={t("femme.professionals.errorTitle")} style={pageAlertStyle}>
              {pageError}
            </Alert>
          )}
        </div>
      )}
      <div data-tour="professionals-search" style={{ marginBottom: 12 }}>
        <SearchInput
          id="professionals-inline-search"
          value={listQuery}
          onChange={(q) => { setListQuery(q); setProfPage(0); }}
          placeholder={t("femme.professionals.searchInlinePlaceholder")}
          resultCount={profTotalElements}
          totalCount={profTotalElements}
        />
      </div>

      {/* ── List ── */}
      <div
        data-tour="professionals-list"
        data-testid="catalog-professionals-list"
        className="overflow-hidden rounded-card border border-line bg-surface"
      >
        {profTotalElements === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-ink-3">
            {listQuery ? t("femme.listFilter.noMatches") : t("femme.professionals.emptyBody")}
          </div>
        ) : (
          <ul className="flex flex-col px-1 sm:px-2">
            {profContent.map((p) => (
              <li
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={t("femme.professionals.openEdit", { name: p.fullName })}
                data-testid={`prof-row-${p.id}`}
                data-active={p.active ? "true" : "false"}
                onClick={() => openEdit(p)}
                onKeyDown={onRowKeyOpenEdit(p)}
                className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0 hover:bg-bg"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-lt font-heading font-extrabold text-primary ${
                    p.active ? "" : "opacity-60"
                  }`}
                >
                  {getInitials(p.fullName)}
                </span>
                <div className={`min-w-0 flex-1 ${p.active ? "" : "opacity-60"}`}>
                  <div className="break-words font-semibold text-ink">{p.fullName}</div>
                  <div className="break-words text-sm text-ink-3">
                    {[p.phone || t("femme.catalog.noPhone"), p.active ? null : t("femme.status.INACTIVE")]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Switch
                    className="min-h-11 min-w-11 justify-center"
                    checked={p.active}
                    aria-label={t("femme.catalog.toggleAria", { name: p.fullName })}
                    data-testid={`prof-switch-${p.id}`}
                    onChange={() => (p.active ? requestDeactivate(p) : requestActivate(p))}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* ── Pagination footer ── */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderTop: "var(--border-default)" }}
        >
          <PageSizeSelect
            value={profPageSize}
            onChange={(s) => { setProfPageSize(s); setProfPage(0); }}
            label={t("femme.pagination.rowsPerPage")}
          />
          <Text variant="small" className="text-[var(--color-ink-3)]">
            {t("femme.pagination.showingRange", { from: profShowingFrom, to: profShowingTo, total: profTotalElements })}
          </Text>
          <Pagination
            page={profPage + 1}
            pageCount={Math.max(1, profTotalPages)}
            onPageChange={(p) => setProfPage(p - 1)}
            previousLabel={t("femme.pagination.previous")}
            nextLabel={t("femme.pagination.next")}
          />
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          savedProfessional
            ? t("femme.professionals.editTitle")
            : t("femme.professionals.addTitle")
        }
      >
        <div className="flex flex-col gap-4">
          {editSuccess ? <Alert variant="success">{t("femme.professionals.editSuccess")}</Alert> : null}
          {detailSaveError ? (
            <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
              {detailSaveError}
            </Alert>
          ) : null}
          {scheduleSaveError ? (
            <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
              {scheduleSaveError}
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="prof-name">{t("femme.professionals.form.fullName")}</Label>
            <Input
              id="prof-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("femme.professionals.form.fullNamePlaceholder")}
              aria-invalid={detailErrors?.fullName ? "true" : "false"}
              aria-describedby={detailErrors?.fullName ? "prof-name-err" : undefined}
            />
            <FieldValidationError id="prof-name-err">
              {detailErrors?.fullName}
            </FieldValidationError>
          </div>


          <div>
            <Label htmlFor="prof-phone">{t("femme.professionals.form.phone")}</Label>
            <Input
              id="prof-phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(formatParaguayPhone(e.target.value));
                setDetailErrors((prev) => (prev ? { ...prev, phone: undefined } : prev));
              }}
              onBlur={() => {
                const trimmed = phone.trim();
                if (trimmed && !isCompleteParaguayPhone(trimmed)) {
                  setDetailErrors((prev) => ({
                    ...(prev ?? {}),
                    phone: t("femme.professionals.form.phoneInvalid"),
                  }));
                }
              }}
              placeholder={t("femme.professionals.form.phonePlaceholder")}
              aria-invalid={detailErrors?.phone ? "true" : "false"}
              aria-describedby={detailErrors?.phone ? "prof-phone-err" : undefined}
            />
            <FieldValidationError id="prof-phone-err">{detailErrors?.phone}</FieldValidationError>
          </div>

          {/* ── Schedule: summary + "Cambiar" (new professionals start Monday to Saturday, 09:00 to 18:00) ── */}
          <div data-testid="prof-schedule-block">
            <Label>{t("femme.catalog.scheduleLabel")}</Label>
            <div className="mt-1 flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm font-semibold text-ink" data-testid="prof-schedule-summary">
                  {scheduleSummary}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-primary"
                  data-testid="prof-schedule-toggle"
                  aria-expanded={scheduleOpen}
                  onClick={() => setScheduleOpen((o) => !o)}
                >
                  {scheduleOpen ? t("femme.catalog.scheduleDone") : t("femme.catalog.scheduleChange")}
                </Button>
              </div>
              {scheduleOpen ? (
                <div className="flex flex-col gap-3">
                  <Text variant="muted">{t("femme.professionals.form.scheduleLead")}</Text>
                  <div className="flex flex-col gap-1.5">
                    {DAYS.map((d) => {
                      const row = schedules.find((s) => s.dayOfWeek === d.value) ?? {
                        dayOfWeek: d.value,
                        startTime: "",
                        endTime: "",
                        active: false,
                      };
                      const dayLabel = t(`femme.professionals.days.${daysByValue.get(d.value)}`);
                      const checkboxId = `prof-${d.value}-active`;
                      return (
                        <div
                          key={d.value}
                          className="flex flex-wrap items-center gap-3"
                          data-testid={`prof-day-${d.key}-row`}
                          style={{
                            padding: "6px 12px",
                            border: "var(--border-default)",
                            borderRadius: "var(--radius-md)",
                            background: "var(--color-white)",
                          }}
                        >
                          <label
                            htmlFor={checkboxId}
                            className="flex w-24 shrink-0 cursor-pointer items-center gap-2"
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={row.active}
                              onChange={(e) => toggleScheduleDay(d.value, e.target.checked)}
                              aria-label={`${dayLabel} — ${t("femme.professionals.form.scheduleDayActive")}`}
                              data-testid={`prof-day-${d.key}-active`}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                            <span className="text-sm font-medium">{dayLabel}</span>
                          </label>
                          {row.active ? (
                            <div className="flex flex-1 min-w-[180px] items-center gap-2">
                              <TimeCombobox
                                id={`prof-${d.value}-start`}
                                value={row.startTime}
                                onChange={(next) => setScheduleTime(d.value, { startTime: next })}
                                placeholder={t("femme.professionals.form.timePlaceholderStart")}
                                invalid={!!scheduleErrors?.schedules}
                                aria-invalid={!!scheduleErrors?.schedules}
                                aria-label={`${dayLabel} — ${t("femme.professionals.form.start")}`}
                                data-testid={`prof-day-${d.key}-start`}
                                className="w-24 sm:w-28"
                              />
                              <Text
                                variant="muted"
                                aria-hidden="true"
                                className="shrink-0 text-sm"
                              >
                                –
                              </Text>
                              <TimeCombobox
                                id={`prof-${d.value}-end`}
                                value={row.endTime}
                                onChange={(next) => setScheduleTime(d.value, { endTime: next })}
                                placeholder={t("femme.professionals.form.timePlaceholderEnd")}
                                invalid={!!scheduleErrors?.schedules}
                                aria-invalid={!!scheduleErrors?.schedules}
                                aria-label={`${dayLabel} — ${t("femme.professionals.form.end")}`}
                                data-testid={`prof-day-${d.key}-end`}
                                className="w-24 sm:w-28"
                              />
                            </div>
                          ) : (
                            <Text variant="muted" className="flex-1 text-xs">
                              {t("femme.professionals.dayOff")}
                            </Text>
                          )}
                        </div>
                      );
                    })}
                  </div>


                  <FieldValidationError id="prof-sched-err">
                    {scheduleErrors?.schedules}
                  </FieldValidationError>
                </div>
              ) : (
                <FieldValidationError id="prof-sched-err">
                  {scheduleErrors?.schedules}
                </FieldValidationError>
              )}
            </div>
          </div>

          {/* ── Más opciones: email, PIN, system access and photo ── */}
          <div className="border-t border-line">
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between text-left font-bold text-ink"
              aria-expanded={moreOptionsOpen}
              aria-controls="prof-more-options"
              data-testid="prof-more-options-toggle"
              onClick={() => setMoreOptionsOpen((o) => !o)}
            >
              {t("femme.catalog.moreOptions")}
              <span aria-hidden className={`text-ink-3 transition-transform ${moreOptionsOpen ? "rotate-180" : ""}`}>
                ⌄
              </span>
            </button>
            {moreOptionsOpen ? (
              <div id="prof-more-options" className="flex flex-col gap-4 pb-2">
                <div>
                  <Label htmlFor="prof-email">{t("femme.professionals.form.email")}</Label>
                  <Input
                    id="prof-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setDetailErrors((prev) => (prev ? { ...prev, email: undefined } : prev));
                    }}
                    onBlur={() => {
                      const trimmed = email.trim();
                      if (trimmed && !isValidEmail(trimmed)) {
                        setDetailErrors((prev) => ({
                          ...(prev ?? {}),
                          email: t("femme.professionals.form.emailInvalid"),
                        }));
                      }
                    }}
                    placeholder={t("femme.professionals.form.emailPlaceholder")}
                    aria-invalid={detailErrors?.email ? "true" : "false"}
                    aria-describedby={detailErrors?.email ? "prof-email-err" : undefined}
                  />
                  <FieldValidationError id="prof-email-err">{detailErrors?.email}</FieldValidationError>
                  {emailChangesAccess ? (
                    <Alert variant="warning" className="mt-2" data-testid="prof-email-change-warning">
                      {systemAccessAllowed
                        ? t("femme.professionals.form.emailChangeWarningAccessOn", {
                            oldEmail: savedProfessional?.email ?? "",
                            newEmail: email.trim() || "—",
                          })
                        : t("femme.professionals.form.emailChangeWarningAccessOff", {
                            oldEmail: savedProfessional?.email ?? "",
                          })}
                    </Alert>
                  ) : null}
                </div>

              {/* ── PIN (hash updated only if the user types here; leave blank to keep / omit) ── */}
              <div>
                <Label htmlFor="prof-pin">{t("femme.professionals.form.pin")}</Label>
                <Input
                  id="prof-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setPinTouched(true);
                    setDetailErrors((prev) => (prev ? { ...prev, pin: undefined } : prev));
                  }}
                  placeholder={
                    savedProfessional?.hasPinSet && !pinTouched
                      ? t("femme.professionals.form.pinMaskPlaceholder")
                      : t("femme.professionals.form.pinPlaceholder")
                  }
                  aria-describedby="prof-pin-help prof-pin-err"
                />
                <FieldValidationError id="prof-pin-err">{detailErrors?.pin}</FieldValidationError>
                <Text variant="muted" className="mt-1 text-xs" id="prof-pin-help">
                  {t("femme.professionals.form.pinHelp")}
                </Text>
                {/* HU-66: PIN locked on shared devices → the administrator can lift it now. */}
                {savedProfessional?.pinLocks && savedProfessional.pinLocks.length > 0 ? (
                  <Alert variant="warning" className="mt-2" data-testid="prof-pin-locked">
                    <div className="flex flex-col gap-2">
                      <span>
                        {t("femme.professionals.form.pinLocked", {
                          devices: savedProfessional.pinLocks
                            .map((l) =>
                              t("femme.professionals.form.pinLockedDevice", {
                                name: l.deviceName,
                                time: new Date(l.lockedUntil).toLocaleTimeString(
                                  i18n.resolvedLanguage ?? "es",
                                  { hour: "2-digit", minute: "2-digit" },
                                ),
                              }),
                            )
                            .join(", "),
                        })}
                      </span>
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-11"
                          data-testid="prof-pin-unlock"
                          onClick={() => void unlockPin()}
                        >
                          {t("femme.professionals.form.pinUnlock")}
                        </Button>
                      </div>
                    </div>
                  </Alert>
                ) : null}
                {pinUnlockedMessage ? (
                  <Text className="mt-2 text-xs" style={{ color: "var(--color-success)" }} data-testid="prof-pin-unlocked">
                    {pinUnlockedMessage}
                  </Text>
                ) : null}
              </div>


              {/* ── System access (HU-23 + issue #38) ── */}
              <ProfessionalAccessSection<Professional>
                checked={systemAccessAllowed}
                onCheckedChange={(checked) => {
                  setSystemAccessAllowed(checked);
                  if (checked) {
                    setDetailErrors((prev) => (prev ? { ...prev, email: undefined } : prev));
                  }
                }}
                email={email}
                emailValid={email.trim() !== "" && isValidEmail(email.trim())}
                saved={savedProfessional}
                onResent={(updated) => {
                  setSavedProfessional(updated);
                  setProfReloadTick((n) => n + 1);
                }}
                message={accessGrantedMessage}
              />


              <div>
                <Label htmlFor="prof-photo-file">{t("femme.professionals.form.photoDataUrl")}</Label>
                <input
                  ref={photoFileInputRef}
                  id="prof-photo-file"
                  type="file"
                  accept={PROFESSIONAL_PHOTO_ACCEPT}
                  className="sr-only"
                  aria-invalid={detailErrors?.photo ? true : undefined}
                  aria-describedby={
                    [detailErrors?.photo && "prof-photo-err", "prof-photo-help"].filter(Boolean).join(" ") ||
                    "prof-photo-help"
                  }
                  aria-label={t("femme.professionals.form.photoChooseFile")}
                  onChange={(e) => void onPhotoFileChange(e)}
                />
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => photoFileInputRef.current?.click()}
                  >
                    {photoDataUrl
                      ? t("femme.professionals.form.photoChangeFile")
                      : t("femme.professionals.form.photoChooseFile")}
                  </Button>
                  {photoDataUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={clearProfessionalPhoto}
                    >
                      {t("femme.professionals.form.photoRemove")}
                    </Button>
                  ) : null}
                </div>
                {photoDataUrl ? (
                  <div className="mt-3">
                    <img
                      src={photoDataUrl}
                      alt={t("femme.professionals.form.photoPreviewAlt")}
                      className="h-24 w-24 max-h-32 max-w-32 rounded-md border border-line object-cover object-center"
                    />
                  </div>
                ) : null}
                <FieldValidationError id="prof-photo-err">{detailErrors?.photo}</FieldValidationError>
                <Text variant="muted" className="mt-1 text-xs" id="prof-photo-help">
                  {t("femme.professionals.form.photoHelp")}
                </Text>
              </div>

              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={closeModal} className="min-h-11">
              {t("femme.professionals.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void saveDetails()}
              disabled={detailSaving}
              className="min-h-11"
              data-testid="prof-save"
            >
              {detailSaving ? t("femme.professionals.saving") : t("femme.catalog.save")}
            </Button>
          </div>
        </div>
      </Modal>

      {emailChangeConfirmOpen ? (
        <ConfirmDialog
          open
          title={t("femme.professionals.form.emailChangeConfirmTitle")}
          description={
            systemAccessAllowed
              ? t("femme.professionals.form.emailChangeWarningAccessOn", {
                  oldEmail: savedProfessional?.email ?? "",
                  newEmail: email.trim() || "—",
                })
              : t("femme.professionals.form.emailChangeWarningAccessOff", {
                  oldEmail: savedProfessional?.email ?? "",
                })
          }
          cancelLabel={t("femme.professionals.cancel")}
          confirmLabel={t("femme.professionals.form.emailChangeConfirm")}
          confirmVariant="primary"
          onCancel={() => setEmailChangeConfirmOpen(false)}
          onConfirm={() => {
            setEmailChangeConfirmOpen(false);
            void saveDetails(true);
          }}
        />
      ) : null}

      {deactivateTarget ? (
        <ConfirmDialog
          open
          title={t("femme.professionals.deactivateDialogTitle")}
          description={t("femme.professionals.deactivateDialogDescription", {
            name: deactivateTarget.fullName,
          })}
          cancelLabel={t("femme.professionals.cancel")}
          confirmLabel={t("femme.professionals.deactivate")}
          onCancel={() => setDeactivateTarget(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}

      {activateTarget ? (
        <ConfirmDialog
          open
          title={t("femme.professionals.activateDialogTitle")}
          description={t("femme.professionals.activateDialogDescription", {
            name: activateTarget.fullName,
          })}
          cancelLabel={t("femme.professionals.cancel")}
          confirmLabel={t("femme.professionals.activate")}
          confirmVariant="primary"
          onCancel={() => setActivateTarget(null)}
          onConfirm={() => void confirmActivate()}
        />
      ) : null}
    </div>
  );
}
