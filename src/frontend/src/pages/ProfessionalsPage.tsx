import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Heading,
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
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

type Schedule = { dayOfWeek: number; startTime: string; endTime: string };
type Professional = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  photoDataUrl: string | null;
  active: boolean;
  schedules: Schedule[];
};

type DetailErrors = { fullName?: string } | null;
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

function defaultWeekSchedules(): Schedule[] {
  return DAYS.map((d) => ({ dayOfWeek: d.value, startTime: "09:00", endTime: "17:00" }));
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
  const [detailErrors, setDetailErrors] = useState<DetailErrors>(null);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);

  // schedule tab
  const [schedules, setSchedules] = useState<Schedule[]>(defaultWeekSchedules);
  const [scheduleErrors, setScheduleErrors] = useState<ScheduleErrors>(null);
  const [scheduleSaveError, setScheduleSaveError] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const daysByValue = useMemo(() => new Map(DAYS.map((d) => [d.value, d.key] as const)), []);

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
    setDetailErrors(null);
    setDetailSaveError(null);
  }

  function resetScheduleForm(p: Professional | null) {
    setSchedules(
      Array.isArray(p?.schedules) && (p?.schedules.length ?? 0) > 0
        ? p!.schedules.map((s) => ({ ...s }))
        : defaultWeekSchedules(),
    );
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
    setDetailErrors(null);
    setDetailSaveError(null);
    const nameTrim = fullName.trim();
    if (!nameTrim) {
      setDetailErrors({ fullName: t("femme.professionals.form.fullNameRequired") });
      return;
    }
    setDetailSaving(true);
    try {
      const payload = {
        fullName: nameTrim,
        phone: phone.trim() || null,
        email: email.trim() || null,
        photoDataUrl: photoDataUrl.trim() || null,
      };
      let saved: Professional;
      if (savedProfessional) {
        saved = await femmePutJson<Professional>(`/api/professionals/${savedProfessional.id}`, payload);
      } else {
        saved = await femmePostJson<Professional>("/api/professionals", payload);
      }
      setSavedProfessional(saved);
      await load();
      setTab("schedule");
    } catch (e) {
      setDetailSaveError(translateApiError(e, t, "femme.professionals.saveError"));
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
      const start = normalizeTime(row?.startTime ?? "");
      const end = normalizeTime(row?.endTime ?? "");
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

  async function deactivate(p: Professional) {
    if (!window.confirm(t("femme.professionals.deactivateConfirm", { name: p.fullName }))) return;
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/deactivate`, {});
      await load();
    } catch (e) {
      setPageError(translateApiError(e, t, "femme.professionals.saveError"));
    }
  }

  const scheduleDisabled = !savedProfessional;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.professionals.loading")}</Text>
      </div>
    );
  }

  if (pageError) {
    return (
      <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
        {pageError}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Heading as="h1">{t("femme.professionals.title")}</Heading>
          <Text variant="muted" className="mt-1">
            {t("femme.professionals.lead")}
          </Text>
        </div>
        <Button type="button" onClick={openNew} className="w-full sm:w-auto">
          {t("femme.professionals.add")}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {professionals.length === 0 ? (
          <Alert variant="default" title={t("femme.professionals.emptyTitle")}>
            {t("femme.professionals.emptyBody")}
          </Alert>
        ) : null}
        {professionals.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Heading as="h2" className="text-lg">
                  {p.fullName}{" "}
                  {!p.active ? (
                    <span className="text-sm font-medium text-[rgb(var(--color-muted-foreground))]">
                      {t("femme.professionals.inactive")}
                    </span>
                  ) : null}
                </Heading>
                <Text variant="muted" className="mt-1">
                  {t("femme.professionals.meta", {
                    phone: p.phone ?? t("femme.professionals.metaEmpty"),
                    email: p.email ?? t("femme.professionals.metaEmpty"),
                  })}
                </Text>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openEdit(p)}
                  className="min-h-11"
                >
                  {t("femme.professionals.edit")}
                </Button>
                {p.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => deactivate(p)}
                    className="min-h-11"
                  >
                    {t("femme.professionals.deactivate")}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
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
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("femme.professionals.form.emailPlaceholder")}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="prof-photo">{t("femme.professionals.form.photoDataUrl")}</Label>
                <Input
                  id="prof-photo"
                  value={photoDataUrl}
                  onChange={(e) => setPhotoDataUrl(e.target.value)}
                  placeholder={t("femme.professionals.form.photoPlaceholder")}
                />
                <Text variant="muted" className="mt-1 text-xs">
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
                    startTime: "09:00",
                    endTime: "17:00",
                  };
                  return (
                    <Card key={d.value} className="p-3">
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
                            <Input
                              id={`prof-${d.value}-start`}
                              value={row.startTime}
                              onChange={(e) =>
                                setScheduleTime(d.value, { startTime: e.target.value })
                              }
                              placeholder={t("femme.professionals.form.timePlaceholderStart")}
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor={`prof-${d.value}-end`}
                              className="text-xs"
                            >
                              {t("femme.professionals.form.end")}
                            </Label>
                            <Input
                              id={`prof-${d.value}-end`}
                              value={row.endTime}
                              onChange={(e) =>
                                setScheduleTime(d.value, { endTime: e.target.value })
                              }
                              placeholder={t("femme.professionals.form.timePlaceholderEnd")}
                              inputMode="numeric"
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
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
    </div>
  );
}
