import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchInput } from "../components/ui/SearchInput";
import { useFilteredList } from "../hooks/useFilteredList";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  KebabMenu,
  Label,
  Modal,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  TimeCombobox,
} from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { grantProfessionalAccess, revokeProfessionalAccess } from "../api/professionalAccess";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { StatusBadge } from "../components/StatusBadge";
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

// ── Avatar palette ─────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: "var(--color-rose-lt)",  color: "var(--color-rose-dk)"  },
  { bg: "var(--color-mauve-lt)", color: "var(--color-mauve-dk)" },
];

function profAvatar(idx: number): { bg: string; color: string } {
  if (idx < AVATAR_PALETTE.length) return AVATAR_PALETTE[idx];
  return { bg: "var(--color-stone-md)", color: "var(--color-ink-2)" };
}

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

function schedulesFromProfessional(p: Professional | null): Schedule[] {
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

export default function ProfessionalsPage() {
  const { t } = useTranslation();
  const guidedTourEnabled = useFeatureFlag("GUIDED_TOUR");
  useTour("professionals", professionalsSteps, undefined, guidedTourEnabled);

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [savedProfessional, setSavedProfessional] = useState<Professional | null>(null);
  const [tab, setTab] = useState<"details" | "schedule">("details");

  // details tab
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [pin, setPin] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [systemAccessAllowed, setSystemAccessAllowed] = useState(false);
  const [accessGrantedMessage, setAccessGrantedMessage] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<DetailErrors>(null);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);

  // schedule tab
  const [schedules, setSchedules] = useState<Schedule[]>(() => schedulesFromProfessional(null));
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>(null);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Professional | null>(null);
  const [activateTarget, setActivateTarget] = useState<Professional | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

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

  const { query: listQuery, setQuery: setListQuery, filtered: visibleProfessionals, highlight } =
    useFilteredList<Professional>({
      items: professionals,
      fields: ["fullName", "phone", "email"],
    });

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const res = await femmeJson<Professional[]>("/api/professionals");
      setProfessionals(Array.isArray(res) ? res : []);
    } catch {
      setPageError(t("femme.professionals.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetDetailForm(p: Professional | null) {
    setFullName(p?.fullName ?? "");
    setPhone(p?.phone ?? "");
    setEmail(p?.email ?? "");
    setPhotoDataUrl(p?.photoDataUrl ?? "");
    setPin("");
    setPinTouched(false);
    setSystemAccessAllowed(p?.systemAccessAllowed ?? false);
    setAccessGrantedMessage(null);
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

  function openNew() {
    setSavedProfessional(null);
    setTab("details");
    resetDetailForm(null);
    resetScheduleForm(null);
    setModalOpen(true);
  }

  function openEdit(p: Professional) {
    setSavedProfessional(p);
    setTab("details");
    resetDetailForm(p);
    resetScheduleForm(p);
    setModalOpen(true);
  }

  function openEditSchedule(p: Professional) {
    setSavedProfessional(p);
    resetDetailForm(p);
    resetScheduleForm(p);
    setTab("schedule");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSavedProfessional(null);
  }

  async function saveDetails() {
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
    }
    if (errs.fullName || errs.phone || errs.email) {
      setDetailErrors((prev) => ({
        ...errs,
        ...(prev?.photo ? { photo: prev.photo } : {}),
      }));
      return;
    }
    const pinTrim = pin.trim();
    if (pinTouched && pinTrim && !/^\d{4,7}$/.test(pinTrim)) {
      setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.professionals.form.pinErrorFormat") }));
      return;
    }
    if (detailErrors?.photo) {
      return;
    }
    setDetailSaving(true);
    try {
      const wasAllowed = savedProfessional?.systemAccessAllowed ?? false;
      const payload = {
        fullName: nameTrim,
        phone: phone.trim() || null,
        email: email.trim() || null,
        photoDataUrl: photoDataUrl.trim(),
        pin: pinTouched ? (pinTrim || null) : undefined,
        systemAccessAllowed,
      };
      let saved: Professional;
      if (savedProfessional) {
        saved = await femmePutJson<Professional>(`/api/professionals/${savedProfessional.id}`, payload);
      } else {
        saved = await femmePostJson<Professional>("/api/professionals", payload);
      }

      // Handle system access changes
      if (systemAccessAllowed && !wasAllowed) {
        if (!email.trim()) {
          setDetailSaveError(t("femme.professionals.form.systemAccessNoEmail"));
          setSavedProfessional(saved);
          await load();
          setDetailSaving(false);
          return;
        }
        try {
          await grantProfessionalAccess(saved.id);
          setAccessGrantedMessage(t("femme.professionals.form.systemAccessGranted"));
        } catch (e) {
          setDetailSaveError(translateApiError(e, t, "femme.professionals.saveError"));
        }
      } else if (!systemAccessAllowed && wasAllowed) {
        try {
          await revokeProfessionalAccess(saved.id);
        } catch {
          // non-fatal
        }
      }

      setSavedProfessional(saved);
      setDetailErrors(null);
      setPin("");
      setPinTouched(false);
      await load();
      setTab("schedule");
    } catch (e) {
      const rawCode = parseApiErrorMessage(e);
      if (rawCode === "PIN_ALREADY_IN_USE") {
        setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.professionals.form.pinErrorDuplicate") }));
      } else if (rawCode === "PROFESSIONAL_EMAIL_DUPLICATE") {
        setDetailErrors((prev) => ({
          ...(prev ?? {}),
          email: t("femme.apiErrors.PROFESSIONAL_EMAIL_DUPLICATE"),
        }));
      } else if (rawCode === "INVALID_PIN_FORMAT") {
        setDetailErrors((prev) => ({ ...(prev ?? {}), pin: t("femme.apiErrors.INVALID_PIN_FORMAT") }));
      } else {
        setDetailSaveError(translateApiError(e, t, "femme.professionals.saveError"));
      }
    } finally {
      setDetailSaving(false);
    }
  }

  async function saveSchedules() {
    setScheduleErrors(null);
    setScheduleSaveError(null);
    if (!savedProfessional) return;

    const activeDays = schedules.filter((s) => s.active);
    if (activeDays.length === 0) {
      setScheduleErrors({ schedules: t("femme.professionals.form.scheduleNoDaysSelected") });
      return;
    }

    const normalized: Array<{ dayOfWeek: number; startTime: string; endTime: string }> = [];
    for (const d of DAYS) {
      const row = schedules.find((s) => s.dayOfWeek === d.value);
      if (!row?.active) continue;
      const rawStart = row.startTime.trim();
      const rawEnd = row.endTime.trim();
      if (!rawStart || !rawEnd) {
        setScheduleErrors({ schedules: t("femme.professionals.form.scheduleDayIncomplete") });
        return;
      }
      const start = normalizeTime(rawStart);
      const end = normalizeTime(rawEnd);
      if (!start || !end) {
        setScheduleErrors({ schedules: t("femme.professionals.form.scheduleInvalid") });
        return;
      }
      if (start >= end) {
        setScheduleErrors({ schedules: t("femme.professionals.form.scheduleRangeInvalid") });
        return;
      }
      normalized.push({ dayOfWeek: d.value, startTime: start, endTime: end });
    }

    setScheduleSaving(true);
    try {
      const saved = await femmePutJson<Professional>(
        `/api/professionals/${savedProfessional.id}/schedules`,
        normalized,
      );
      setSavedProfessional(saved);
      await load();
      closeModal();
    } catch (e) {
      setScheduleSaveError(translateApiError(e, t, "femme.professionals.saveError"));
    } finally {
      setScheduleSaving(false);
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
            endTime: s.endTime || "17:00",
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
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/deactivate`, {});
      await load();
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
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/activate`, {});
      await load();
    } catch (e) {
      setPageError(translateApiError(e, t, "femme.professionals.saveError"));
    }
  }

  const scheduleDisabled = !savedProfessional;

  if (loading) {
    return (
      <div style={{ display: "flex", minHeight: "40vh", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Spinner size="lg" />
        <Text>{t("femme.professionals.loading")}</Text>
      </div>
    );
  }

  const primaryBtn: React.CSSProperties = {
    background: "var(--color-rose)",
    color: "var(--color-on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  const thStyle: React.CSSProperties = {
    padding: "9px 12px",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    textAlign: "left",
    background: "var(--color-stone)",
    whiteSpace: "nowrap",
  };

  return (
    <div>
      {/* ── Page header ── */}
      <div
        data-tour="professionals-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: "var(--color-ink)",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {t("femme.professionals.title")}
          </h1>
          <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
            {t("femme.professionals.lead")}
          </div>
        </div>
        <button data-tour="professionals-new" type="button" style={primaryBtn} onClick={openNew}>
          {t("femme.professionals.addNew")}
        </button>
      </div>

      {/* ── Error ── */}
      {pageError && (
        <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
          {pageError}
        </Alert>
      )}

      <div data-tour="professionals-search" style={{ marginBottom: 12 }}>
        <SearchInput
          id="professionals-inline-search"
          value={listQuery}
          onChange={setListQuery}
          placeholder={t("femme.professionals.searchInlinePlaceholder")}
          resultCount={visibleProfessionals.length}
          totalCount={professionals.length}
        />
      </div>

      {/* ── Table ── */}
      <div
        data-tour="professionals-list"
        style={{
          background: "var(--color-white)",
          borderRadius: "var(--radius-xl)",
          border: "var(--border-default)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ tableLayout: "fixed", width: "100%", borderCollapse: "collapse" }}>
            <colgroup>
              <col style={{ width: "32%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>{t("femme.professionals.colProfessional")}</th>
                <th style={thStyle}>{t("femme.professionals.colPhone")}</th>
                <th style={thStyle}>{t("femme.professionals.colEmail")}</th>
                <th style={thStyle}>{t("femme.professionals.colStatus")}</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {professionals.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: "24px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--color-ink-3)",
                    }}
                  >
                    {t("femme.professionals.emptyBody")}
                  </td>
                </tr>
              ) : visibleProfessionals.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: "24px 12px",
                      textAlign: "center",
                      fontSize: 12,
                      color: "var(--color-ink-3)",
                    }}
                  >
                    {t("femme.listFilter.noMatches")}
                  </td>
                </tr>
              ) : (
                visibleProfessionals.map((p, idx) => {
                  const av = profAvatar(idx);
                  const isHov = hoveredId === p.id;
                  const tdBg = isHov ? "var(--color-rose-lt)" : undefined;
                  const tdStyle: React.CSSProperties = {
                    padding: "10px 12px",
                    fontSize: 12,
                    color: "var(--color-ink)",
                    verticalAlign: "middle",
                    borderBottom: "0.5px solid var(--color-stone)",
                    background: tdBg,
                  };

                  return (
                    <tr
                      key={p.id}
                      onMouseEnter={() => setHoveredId(p.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "var(--radius-pill)",
                              background: av.bg,
                              color: av.color,
                              fontSize: 10,
                              fontWeight: 500,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {getInitials(p.fullName)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {highlight(p.fullName) as ReactNode}
                            </div>
                            {p.schedules.filter((s) => s.startTime && s.endTime).length > 0 ? (
                              <div style={{ fontSize: 10, color: "var(--color-ink-3)" }}>
                                {p.schedules.filter((s) => s.startTime && s.endTime).length}
                                {" "}
                                {t(`femme.professionals.days.${
                                  daysByValue.get(
                                    p.schedules.filter((s) => s.startTime && s.endTime)[0]
                                      .dayOfWeek,
                                  ) ?? "mon"
                                }`)}
                                {p.schedules.filter((s) => s.startTime && s.endTime).length > 1 ? "…" : ""}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td style={{ ...tdStyle, color: p.phone ? "var(--color-ink)" : "var(--color-ink-3)" }}>
                        {p.phone ? (highlight(p.phone) as ReactNode) : "—"}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          color: p.email ? "var(--color-ink)" : "var(--color-ink-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.email ? (highlight(p.email) as ReactNode) : "—"}
                      </td>

                      <td style={tdStyle}>
                        <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} />
                      </td>

                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            justifyContent: "flex-end",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <KebabMenu
                            id={`professionals-row-${p.id}`}
                            triggerAriaLabel={t("femme.rowActions.trigger")}
                            items={
                              p.active
                                ? [
                                    {
                                      id: "edit-details",
                                      label: t("femme.rowActions.professionals.editDetails"),
                                      onSelect: () => openEdit(p),
                                    },
                                    {
                                      id: "edit-schedule",
                                      label: t("femme.rowActions.professionals.editSchedule"),
                                      onSelect: () => openEditSchedule(p),
                                    },
                                    {
                                      id: "deactivate",
                                      label: t("femme.rowActions.professionals.deactivate"),
                                      destructive: true,
                                      onSelect: () => requestDeactivate(p),
                                    },
                                  ]
                                : [
                                    {
                                      id: "edit-details",
                                      label: t("femme.rowActions.professionals.editDetails"),
                                      onSelect: () => openEdit(p),
                                    },
                                    {
                                      id: "edit-schedule",
                                      label: t("femme.rowActions.professionals.editSchedule"),
                                      onSelect: () => openEditSchedule(p),
                                    },
                                    {
                                      id: "activate",
                                      label: t("femme.rowActions.professionals.activate"),
                                      onSelect: () => requestActivate(p),
                                    },
                                  ]
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="details">{t("femme.professionals.tabs.details")}</TabsTrigger>
            <TabsTrigger value="schedule" disabled={scheduleDisabled}>
              {t("femme.professionals.tabs.schedule")}
            </TabsTrigger>
          </TabsList>

          {/* ── Details tab ─────────────────────────────────────── */}
          <TabsContent value="details">
            <div className="flex flex-col gap-4">
              {!savedProfessional ? (
                <Alert variant="default">
                  {t("femme.professionals.tabs.detailsHint")}
                </Alert>
              ) : null}

              {detailSaveError ? (
                <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
                  {detailSaveError}
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

              <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
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
              </div>

              {/* ── System access ── */}
              <div
                style={{
                  padding: 12,
                  border: "var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-stone)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink)" }}>
                      {t("femme.professionals.form.systemAccess")}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 2 }}>
                      {t("femme.professionals.form.systemAccessHint")}
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}>
                    <input
                      id="prof-system-access"
                      type="checkbox"
                      checked={systemAccessAllowed}
                      onChange={(e) => setSystemAccessAllowed(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                      aria-label={t("femme.professionals.form.systemAccessAllow")}
                    />
                    <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>
                      {t("femme.professionals.form.systemAccessAllow")}
                    </span>
                  </label>
                </div>
                {accessGrantedMessage ? (
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-success)", fontWeight: 500 }}>
                    {accessGrantedMessage}
                  </div>
                ) : null}
              </div>

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
                      className="h-24 w-24 max-h-32 max-w-32 rounded-md border border-slate-200 object-cover object-center dark:border-slate-600"
                    />
                  </div>
                ) : null}
                <FieldValidationError id="prof-photo-err">{detailErrors?.photo}</FieldValidationError>
                <Text variant="muted" className="mt-1 text-xs" id="prof-photo-help">
                  {t("femme.professionals.form.photoHelp")}
                </Text>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closeModal}
                  className="min-h-11"
                >
                  {t("femme.professionals.cancel")}
                </Button>
                <Button
                  type="button"
                  onClick={saveDetails}
                  disabled={detailSaving}
                  className="min-h-11"
                >
                  {detailSaving
                    ? t("femme.professionals.saving")
                    : t("femme.professionals.saveAndNext")}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Schedule tab ─────────────────────────────────────── */}
          <TabsContent value="schedule">
            <div className="flex flex-col gap-4">
              {scheduleSaveError ? (
                <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
                  {scheduleSaveError}
                </Alert>
              ) : null}

              <Text variant="muted">{t("femme.professionals.form.scheduleLead")}</Text>

              <div className="flex flex-col gap-3">
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
                      style={{
                        padding: 12,
                        border: "var(--border-default)",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-white)",
                      }}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <label
                          htmlFor={checkboxId}
                          className="flex w-28 shrink-0 cursor-pointer items-center gap-2"
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
                          <span className="font-medium">{dayLabel}</span>
                        </label>
                        {row.active ? (
                          <div className="grid flex-1 grid-cols-2 gap-3">
                            <div>
                              <Label
                                htmlFor={`prof-${d.value}-start`}
                                className="text-xs"
                              >
                                {t("femme.professionals.form.start")}
                              </Label>
                              <TimeCombobox
                                id={`prof-${d.value}-start`}
                                value={row.startTime}
                                onChange={(next) =>
                                  setScheduleTime(d.value, { startTime: next })
                                }
                                placeholder={t("femme.professionals.form.timePlaceholderStart")}
                                invalid={!!scheduleErrors?.schedules}
                                aria-invalid={!!scheduleErrors?.schedules}
                                aria-label={`${dayLabel} — ${t("femme.professionals.form.start")}`}
                                data-testid={`prof-day-${d.key}-start`}
                              />
                            </div>
                            <div>
                              <Label
                                htmlFor={`prof-${d.value}-end`}
                                className="text-xs"
                              >
                                {t("femme.professionals.form.end")}
                              </Label>
                              <TimeCombobox
                                id={`prof-${d.value}-end`}
                                value={row.endTime}
                                onChange={(next) =>
                                  setScheduleTime(d.value, { endTime: next })
                                }
                                placeholder={t("femme.professionals.form.timePlaceholderEnd")}
                                invalid={!!scheduleErrors?.schedules}
                                aria-invalid={!!scheduleErrors?.schedules}
                                aria-label={`${dayLabel} — ${t("femme.professionals.form.end")}`}
                                data-testid={`prof-day-${d.key}-end`}
                              />
                            </div>
                          </div>
                        ) : (
                          <Text variant="muted" className="flex-1 text-xs">
                            {t("femme.professionals.dayOff")}
                          </Text>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <FieldValidationError id="prof-sched-err">
                {scheduleErrors?.schedules}
              </FieldValidationError>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setTab("details")}
                  className="min-h-11"
                >
                  {t("femme.professionals.back")}
                </Button>
                <Button
                  type="button"
                  onClick={saveSchedules}
                  disabled={scheduleSaving}
                  className="min-h-11"
                >
                  {scheduleSaving
                    ? t("femme.professionals.saving")
                    : t("femme.professionals.save")}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </Modal>

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
