import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Heading, Input, Label, Modal, Spinner, Text } from "@design-system";
import { femmeJson, femmePostJson, femmePutJson } from "../api/femmeClient";
import { translateApiError } from "../api/parseApiErrorMessage";
import { FieldValidationError } from "../components/FieldValidationError";

type ProfessionalSchedule = { dayOfWeek: number; startTime: string; endTime: string };
type Professional = {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  photoDataUrl: string | null;
  active: boolean;
  schedules: ProfessionalSchedule[];
};

type FieldErrors = { fullName?: string; schedules?: string } | null;

const days: Array<{ value: number; key: string }> = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 7, key: "sun" },
];

function defaultWeekSchedules(): ProfessionalSchedule[] {
  return days.map((d) => ({ dayOfWeek: d.value, startTime: "09:00", endTime: "17:00" }));
}

function normalizeTimeInput(s: string) {
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
  const [error, setError] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [schedules, setSchedules] = useState<ProfessionalSchedule[]>(defaultWeekSchedules);
  const [fieldError, setFieldError] = useState<FieldErrors>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await femmeJson<Professional[]>("/api/professionals");
      setProfessionals(Array.isArray(res) ? res : []);
    } catch {
      setError(t("femme.professionals.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const daysByValue = useMemo(() => new Map(days.map((d) => [d.value, d.key] as const)), []);

  function openNew() {
    setEditing(null);
    setFullName("");
    setPhone("");
    setEmail("");
    setPhotoDataUrl("");
    setSchedules(defaultWeekSchedules());
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(p: Professional) {
    setEditing(p);
    setFullName(p.fullName);
    setPhone(p.phone ?? "");
    setEmail(p.email ?? "");
    setPhotoDataUrl(p.photoDataUrl ?? "");
    setSchedules(
      Array.isArray(p.schedules) && p.schedules.length > 0
        ? p.schedules.map((s) => ({ ...s }))
        : defaultWeekSchedules(),
    );
    setFieldError(null);
    setSaveError(null);
    setModalOpen(true);
  }

  function setScheduleTime(dow: number, patch: Partial<Pick<ProfessionalSchedule, "startTime" | "endTime">>) {
    setSchedules((prev) =>
      prev.map((s) => (s.dayOfWeek === dow ? { ...s, ...patch } : s)),
    );
  }

  async function save() {
    setFieldError(null);
    setSaveError(null);
    const nameTrim = fullName.trim();
    const nextErr: NonNullable<FieldErrors> = {};
    if (!nameTrim) nextErr.fullName = t("femme.professionals.form.fullNameRequired");

    const normalizedSchedules: ProfessionalSchedule[] = [];
    for (const d of days) {
      const item = schedules.find((s) => s.dayOfWeek === d.value);
      const start = normalizeTimeInput(item?.startTime ?? "");
      const end = normalizeTimeInput(item?.endTime ?? "");
      if (!start || !end) {
        nextErr.schedules = t("femme.professionals.form.scheduleInvalid");
        break;
      }
      if (start >= end) {
        nextErr.schedules = t("femme.professionals.form.scheduleRangeInvalid");
        break;
      }
      normalizedSchedules.push({ dayOfWeek: d.value, startTime: start, endTime: end });
    }

    if (Object.keys(nextErr).length > 0) {
      setFieldError(nextErr);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        fullName: nameTrim,
        phone: phone.trim() ? phone.trim() : null,
        email: email.trim() ? email.trim() : null,
        photoDataUrl: photoDataUrl.trim() ? photoDataUrl.trim() : null,
        schedules: normalizedSchedules,
      };
      if (editing) {
        await femmePutJson<Professional>(`/api/professionals/${editing.id}`, payload);
      } else {
        await femmePostJson<Professional>("/api/professionals", payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(translateApiError(e, t, "femme.professionals.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(p: Professional) {
    if (!window.confirm(t("femme.professionals.deactivateConfirm", { name: p.fullName }))) return;
    try {
      await femmePostJson<Professional>(`/api/professionals/${p.id}/deactivate`, {});
      await load();
    } catch (e) {
      setError(translateApiError(e, t, "femme.professionals.saveError"));
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3">
        <Spinner size="lg" />
        <Text>{t("femme.professionals.loading")}</Text>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
        {error}
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
                <Button type="button" variant="secondary" onClick={() => openEdit(p)} className="min-h-11">
                  {t("femme.professionals.edit")}
                </Button>
                {p.active ? (
                  <Button type="button" variant="ghost" onClick={() => deactivate(p)} className="min-h-11">
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
        onClose={() => setModalOpen(false)}
        title={editing ? t("femme.professionals.editTitle") : t("femme.professionals.addTitle")}
      >
        <div className="flex flex-col gap-4">
          {saveError ? (
            <Alert variant="destructive" title={t("femme.professionals.errorTitle")}>
              {saveError}
            </Alert>
          ) : null}

          <div>
            <Label htmlFor="prof-name">{t("femme.professionals.form.fullName")}</Label>
            <Input
              id="prof-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={fieldError?.fullName ? "true" : "false"}
              aria-describedby={fieldError?.fullName ? "prof-name-err" : undefined}
            />
            <FieldValidationError id="prof-name-err">{fieldError?.fullName}</FieldValidationError>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="prof-phone">{t("femme.professionals.form.phone")}</Label>
              <Input id="prof-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="prof-email">{t("femme.professionals.form.email")}</Label>
              <Input
                id="prof-email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="prof-photo">{t("femme.professionals.form.photoDataUrl")}</Label>
            <Input id="prof-photo" value={photoDataUrl} onChange={(e) => setPhotoDataUrl(e.target.value)} />
            <Text variant="muted" className="mt-1 text-xs">
              {t("femme.professionals.form.photoHelp")}
            </Text>
          </div>

          <div>
            <Heading as="h3" className="text-base">
              {t("femme.professionals.form.scheduleTitle")}
            </Heading>
            <Text variant="muted" className="mt-1">
              {t("femme.professionals.form.scheduleLead")}
            </Text>

            <div className="mt-3 flex flex-col gap-3">
              {days.map((d) => {
                const row = schedules.find((s) => s.dayOfWeek === d.value) ?? {
                  dayOfWeek: d.value,
                  startTime: "09:00",
                  endTime: "17:00",
                };
                return (
                  <Card key={d.value} className="p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Text className="font-medium">{t(`femme.professionals.days.${daysByValue.get(d.value)}`)}</Text>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`prof-${d.value}-start`} className="text-xs">
                            {t("femme.professionals.form.start")}
                          </Label>
                          <Input
                            id={`prof-${d.value}-start`}
                            value={row.startTime}
                            onChange={(e) => setScheduleTime(d.value, { startTime: e.target.value })}
                            placeholder="09:00"
                            inputMode="numeric"
                          />
                        </div>
                        <div>
                          <Label htmlFor={`prof-${d.value}-end`} className="text-xs">
                            {t("femme.professionals.form.end")}
                          </Label>
                          <Input
                            id={`prof-${d.value}-end`}
                            value={row.endTime}
                            onChange={(e) => setScheduleTime(d.value, { endTime: e.target.value })}
                            placeholder="17:00"
                            inputMode="numeric"
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
            <FieldValidationError id="prof-sched-err">{fieldError?.schedules}</FieldValidationError>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} className="min-h-11">
              {t("femme.professionals.cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={saving} className="min-h-11">
              {saving ? t("femme.professionals.saving") : t("femme.professionals.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

