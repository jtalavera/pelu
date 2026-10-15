import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Input, Label, Select, Text } from "@design-system";
import { getEntries, type EntryView } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { useDateLocale } from "../../i18n/dateLocale";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { formatParaguayDateTime } from "../../lib/paraguayDateTime";
import { ReassignDialog } from "./ReassignDialog";
import { SettlementStatusBadge, TableWrap, firstOfMonthYmd, formatPercent, tdClass, thClass, todayYmd, useProfessionals } from "./common";

/** Every commission movement, with «Cambiar profesional» on the live ones. */
export function MovementsTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const professionals = useProfessionals();
  const [from, setFrom] = useState(firstOfMonthYmd());
  const [to, setTo] = useState(todayYmd());
  const [professionalId, setProfessionalId] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toReassign, setToReassign] = useState<EntryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await getEntries({ from, to, professionalId: professionalId ? Number(professionalId) : null }));
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }, [from, to, professionalId, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    const list = entries ?? [];
    if (!q) return list;
    return list.filter(
      (e) => (e.invoiceNumber ?? "").toLowerCase().includes(q) || (e.itemName ?? "").toLowerCase().includes(q),
    );
  }, [entries, appliedQuery]);

  function movementLabel(e: EntryView): string {
    if (e.sourceType === "INVOICE_LINE") return t("femme.commissions.movements.type.LINE");
    if (e.sourceType === "REVERSAL") return t(`femme.commissions.reason.${e.reasonCode ?? "VOID"}`);
    return t(`femme.commissions.reason.${e.reasonCode ?? "MANUAL_ADJUSTMENT"}`);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="commission-movements">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQuery(query);
          void load();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="mov-from">{t("femme.commissions.common.from")}</Label>
          <LocalizedDateInput id="mov-from" value={from} onChange={setFrom} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="mov-to">{t("femme.commissions.common.to")}</Label>
          <LocalizedDateInput id="mov-to" value={to} onChange={setTo} />
        </div>
        <div className="flex min-w-[12rem] flex-col gap-1">
          <Label htmlFor="mov-professional">{t("femme.commissions.common.professional")}</Label>
          <Select id="mov-professional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            <option value="">{t("femme.commissions.common.allProfessionals")}</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex min-w-[12rem] flex-col gap-1">
          <Label htmlFor="mov-query">{t("femme.commissions.movements.search")}</Label>
          <Input
            id="mov-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("femme.commissions.movements.searchPlaceholder")}
          />
        </div>
        <Button type="submit" data-testid="movements-search">
          {t("femme.commissions.common.search")}
        </Button>
      </form>
      <Text variant="small" className="text-[var(--color-ink-3)]">
        {t("femme.commissions.movements.hint")}
      </Text>
      {notice && (
        <Alert variant="success" role="status">
          {notice}
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {entries && visible.length === 0 ? (
        <Text variant="muted">{t("femme.commissions.movements.empty")}</Text>
      ) : (
        <TableWrap testId="movements-table">
          <thead>
            <tr>
              <th className={thClass}>{t("femme.commissions.history.date")}</th>
              <th className={thClass}>{t("femme.commissions.reports.invoice")}</th>
              <th className={thClass}>{t("femme.commissions.common.item")}</th>
              <th className={thClass}>{t("femme.commissions.common.professional")}</th>
              <th className={thClass}>{t("femme.commissions.movements.movement")}</th>
              <th className={`${thClass} text-right`}>%</th>
              <th className={`${thClass} text-right`}>{t("femme.commissions.settlement.commission")}</th>
              <th className={thClass}>{t("femme.commissions.reports.settlementState")}</th>
              <th className={thClass} />
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} className="border-t" data-testid="movement-row">
                <td className={tdClass}>{formatParaguayDateTime(e.accrualAt, dateLocale)}</td>
                <td className={tdClass}>{e.invoiceNumber}</td>
                <td className={tdClass}>{e.itemName ?? e.note}</td>
                <td className={tdClass}>{e.professionalName}</td>
                <td className={tdClass}>
                  {movementLabel(e)}
                  {e.note && e.sourceType !== "ADJUSTMENT" && (
                    <span className="block text-xs text-[var(--color-ink-3)]">{e.note}</span>
                  )}
                </td>
                <td className={`${tdClass} text-right`}>{formatPercent(e.percentApplied)}</td>
                <td className={`${tdClass} text-right`}>{formatGuaraniesGs(e.commissionAmount)}</td>
                <td className={tdClass}>
                  <SettlementStatusBadge status={e.settlementStatus} />
                </td>
                <td className={`${tdClass} whitespace-nowrap`}>
                  {e.reassignable && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => setToReassign(e)}>
                      {t("femme.commissions.reassign.action")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <ReassignDialog
        entry={toReassign}
        onClose={() => setToReassign(null)}
        onDone={() => {
          setToReassign(null);
          setNotice(t("femme.commissions.reassign.done"));
          void load();
        }}
      />
    </div>
  );
}
