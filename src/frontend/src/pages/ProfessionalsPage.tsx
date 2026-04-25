import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchInput } from "../components/ui/SearchInput";
import { InlineEditActions } from "../components/ui/InlineEditActions";
import { useFilteredList } from "../hooks/useFilteredList";
import { useInlineEdit } from "../hooks/useInlineEdit";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Input,
  Label,
  Modal,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { grantProfessionalAccess, revokeProfessionalAccess } from "../api/professionalAccess";
import { translateApiError, parseApiErrorMessage } from "../api/parseApiErrorMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FieldValidationError } from "../components/FieldValidationError";
import { FemmeNativeTimeInput } from "../components/FemmeNativeTimeInput";
import { StatusBadge } from "../components/StatusBadge";
import {
  PROFESSIONAL_PHOTO_ACCEPT,
  type ProfessionalPhotoValidationErrorCode,
  validateAndReadProfessionalPhotoFile,
} from "../utils/professionalPhotoUpload";

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

type Schedule = { dayOfWeek: number; startTime: string; endTime: string };
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
  const byDay = new Map<number, Schedule>();
  if (p?.schedules?.length) {
    for (const s of p.schedules) {
      byDay.set(s.dayOfWeek, {
        dayOfWeek: s.dayOfWeek,
        startTime: formatTimeFromApi(s.startTime),
        endTime: formatTimeFromApi(s.endTime),
      });
    }
  }
  return DAYS.map((d) => {
    const existing = byDay.get(d.value);
    return {
      dayOfWeek: d.value,
      startTime: existing?.startTime ?? "",
      endTime: existing?.endTime ?? "",
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

  function closeModal() {
    setModalOpen(false);
    setSavedProfessional(null);
  }

  async function saveDetails() {
    setDetailSaveError(null);
    setAccessGrantedMessage(null);
    const nameTrim = fullName.trim();
    if (!nameTrim) {
      setDetailErrors((prev) => ({
        fullName: t("femme.professionals.form.fullNameRequired"),
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

    const normalized: Schedule[] = [];
    for (const d of DAYS) {
      const row = schedules.find((s) => s.dayOfWeek === d.value);
      const rawStart = row?.startTime?.trim() ?? "";
      const rawEnd = row?.endTime?.trim() ?? "";
      if (!rawStart && !rawEnd) {
        continue;
      }
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

  const handleInlineSave = useCallback(
    async (p: Professional) => {
      const nameTrim = p.fullName.trim();
      if (!nameTrim) {
        throw new Error("NAME_REQUIRED");
      }
      await femmePutJson<Professional>(`/api/professionals/${p.id}`, {
        fullName: nameTrim,
        phone: p.phone?.trim() || null,
        email: p.email?.trim() || null,
        photoDataUrl: p.photoDataUrl?.trim() || null,
      });
      await load();
    },
    [load],
  );

  const {
    editingData,
    saving: inlineSaving,
    saveError: inlineSaveError,
    startEdit,
    cancelEdit,
    updateField,
    saveEdit,
    isEditing,
  } = useInlineEdit<Professional>({
    onSave: handleInlineSave,
    saveErrorMessage: t("femme.inlineEdit.saveError"),
    formatSaveError: (e) => translateApiError(e, t, t("femme.inlineEdit.saveError")),
  });

  const inputEditStyle: React.CSSProperties = {
    padding: "6px 9px",
    border: "1px solid var(--color-rose-md)",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    color: "var(--color-ink)",
    background: "var(--color-white)",
    outline: "none",
    width: "100%",
    minWidth: 80,
  };

  const keySaveCancel = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

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
        <button type="button" style={primaryBtn} onClick={openNew}>
          {t("femme.professionals.addNew")}
        </button>
      </div>

      {/* ── Error ── */}
      {pageError && (
        <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
          {pageError}
        </Alert>
      )}

      <div style={{ marginBottom: 12 }}>
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
                  const rowEditing = isEditing(p.id);
                  const ed = rowEditing ? ({ ...p, ...editingData } as Professional) : p;

                  if (rowEditing) {
                    return (
                      <tr
                        key={p.id}
                        style={{
                          background: "var(--color-rose-lt)",
                          outline: "1.5px solid var(--color-rose-md)",
                          outlineOffset: -1,
                        }}
                      >
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            value={ed.fullName ?? ""}
                            onChange={(e) => updateField("fullName", e.target.value)}
                            onKeyDown={keySaveCancel}
                            placeholder={t("femme.professionals.form.fullName")}
                            style={inputEditStyle}
                            aria-label={t("femme.professionals.form.fullName")}
                          />
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            value={ed.phone ?? ""}
                            onChange={(e) => updateField("phone", e.target.value || null)}
                            onKeyDown={keySaveCancel}
                            placeholder={t("femme.professionals.form.phone")}
                            style={inputEditStyle}
                            aria-label={t("femme.professionals.form.phone")}
                          />
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <input
                            type="email"
                            value={ed.email ?? ""}
                            onChange={(e) => updateField("email", e.target.value || null)}
                            onKeyDown={keySaveCancel}
                            placeholder={t("femme.professionals.form.email")}
                            style={inputEditStyle}
                            aria-label={t("femme.professionals.form.email")}
                          />
                        </td>
                        <td style={tdStyle}>
                          <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} />
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <InlineEditActions
                            isEditing
                            saving={inlineSaving}
                            saveError={inlineSaveError}
                            onEdit={() => {}}
                            onSave={() => void saveEdit()}
                            onCancel={cancelEdit}
                          />
                        </td>
                      </tr>
                    );
                  }

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
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: 11,
                              border: "0.5px solid var(--color-stone-md)",
                              background: "transparent",
                              color: "var(--color-ink-2)",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t("femme.professionals.manageDetails")}
                          </button>
                          <InlineEditActions
                            isEditing={false}
                            saving={false}
                            saveError={null}
                            onEdit={() => startEdit(p)}
                            onSave={() => void saveEdit()}
                            onCancel={cancelEdit}
                            onDeactivate={() => requestDeactivate(p)}
                            onActivate={() => requestActivate(p)}
                            isActive={p.active}
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
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t("femme.professionals.form.phonePlaceholder")}
                  />
                </div>
                <div>
                  <Label htmlFor="prof-email">{t("femme.professionals.form.email")}</Label>
                  <Input
                    id="prof-email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setDetailErrors((prev) => (prev ? { ...prev, email: undefined } : prev));
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
                  };
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
                        <Text className="w-28 shrink-0 font-medium">
                          {t(`femme.professionals.days.${daysByValue.get(d.value)}`)}
                        </Text>
                        <div className="grid flex-1 grid-cols-2 gap-3">
                          <div>
                            <Label
                              htmlFor={`prof-${d.value}-start`}
                              className="text-xs"
                            >
                              {t("femme.professionals.form.start")}
                            </Label>
                            <FemmeNativeTimeInput
                              id={`prof-${d.value}-start`}
                              value={row.startTime}
                              onChange={(e) =>
                                setScheduleTime(d.value, { startTime: e.target.value })
                              }
                              invalid={!!scheduleErrors?.schedules}
                              aria-invalid={!!scheduleErrors?.schedules}
                              aria-label={`${t(`femme.professionals.days.${d.key}`)} — ${t("femme.professionals.form.start")}`}
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor={`prof-${d.value}-end`}
                              className="text-xs"
                            >
                              {t("femme.professionals.form.end")}
                            </Label>
                            <FemmeNativeTimeInput
                              id={`prof-${d.value}-end`}
                              value={row.endTime}
                              onChange={(e) =>
                                setScheduleTime(d.value, { endTime: e.target.value })
                              }
                              invalid={!!scheduleErrors?.schedules}
                              aria-invalid={!!scheduleErrors?.schedules}
                              aria-label={`${t(`femme.professionals.days.${d.key}`)} — ${t("femme.professionals.form.end")}`}
                            />
                          </div>
                        </div>
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
