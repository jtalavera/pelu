import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Input, Label, Select, Text } from "@design-system";
import { getMatrix, simulate, type MatrixRow, type SimulateResponse } from "../../api/commissions";
import { translateApiError } from "../../api/parseApiErrorMessage";
import { FieldValidationError } from "../../components/FieldValidationError";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";
import { formatGuaraniesGs } from "../../lib/formatMoney";
import { maskMoneyInput, parseMaskedMoney } from "../../lib/moneyInputMask";
import { formatPercent, todayYmd, useProfessionals } from "./common";

/** HU-COM-03: what commission would apply — nothing is persisted. */
export function SimulatorTab() {
  const { t } = useTranslation();
  const professionals = useProfessionals();
  const [items, setItems] = useState<MatrixRow[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [amount, setAmount] = useState("");
  const [taxRate, setTaxRate] = useState("10");
  const [discount, setDiscount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    getMatrix()
      .then((m) => setItems(m.rows))
      .catch(() => setItems([]));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const lineAmount = parseMaskedMoney(amount);
    if (!serviceId || lineAmount <= 0) {
      setFieldError(t("femme.commissions.simulator.amountRequired"));
      return;
    }
    setFieldError(null);
    try {
      setResult(
        await simulate({
          serviceId: Number(serviceId),
          professionalId: professionalId ? Number(professionalId) : null,
          lineAmount,
          taxRate: taxRate === "" ? null : Number(taxRate),
          discount: parseMaskedMoney(discount),
          date,
        }),
      );
      setError(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="commission-simulator">
      <Text variant="small" className="text-[var(--color-ink-3)]">
        {t("femme.commissions.simulator.hint")}
      </Text>
      <form onSubmit={(e) => void run(e)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-item">{t("femme.commissions.common.item")}</Label>
          <Select id="sim-item" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">{t("femme.commissions.simulator.chooseItem")}</option>
            {items.map((i) => (
              <option key={i.serviceId} value={i.serviceId}>
                {i.serviceName} ({t(`femme.commissions.kind.${i.itemKind}`)})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-professional">{t("femme.commissions.common.professional")}</Label>
          <Select id="sim-professional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
            <option value="">{t("femme.commissions.simulator.noProfessional")}</option>
            {professionals.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-amount">{t("femme.commissions.simulator.amount")}</Label>
          <Input
            id="sim-amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(maskMoneyInput(e.target.value))}
            invalid={!!fieldError}
            aria-describedby={fieldError ? "sim-amount-error" : undefined}
          />
          <FieldValidationError id="sim-amount-error">{fieldError}</FieldValidationError>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-tax">{t("femme.commissions.simulator.taxRate")}</Label>
          <Select id="sim-tax" value={taxRate} onChange={(e) => setTaxRate(e.target.value)}>
            <option value="10">10 %</option>
            <option value="5">5 %</option>
            <option value="0">{t("femme.commissions.simulator.exempt")}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-discount">{t("femme.commissions.simulator.discount")}</Label>
          <Input id="sim-discount" inputMode="numeric" value={discount} onChange={(e) => setDiscount(maskMoneyInput(e.target.value))} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sim-date">{t("femme.commissions.simulator.date")}</Label>
          <LocalizedDateInput id="sim-date" value={date} onChange={setDate} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" data-testid="commission-simulate">
            {t("femme.commissions.simulator.run")}
          </Button>
        </div>
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      {result && (
        <Card className="flex flex-col gap-2 p-4" data-testid="commission-simulation-result">
          <Text>
            {t("femme.commissions.simulator.percentLine", {
              percent: formatPercent(result.percent),
              origin: t(`femme.commissions.origin.${result.origin}`),
            })}
          </Text>
          <Text data-testid="commission-simulation-configured">
            {t("femme.commissions.simulator.formula", {
              base: t(`femme.commissions.base.${result.configured.baseType}`),
              baseAmount: formatGuaraniesGs(result.configured.baseAmount),
              percent: formatPercent(result.percent),
              commission: formatGuaraniesGs(result.configured.commissionAmount),
            })}
          </Text>
          <Text variant="small" className="text-[var(--color-ink-3)]" data-testid="commission-simulation-alternative">
            {t("femme.commissions.simulator.comparison", {
              base: t(`femme.commissions.base.${result.alternative.baseType}`),
              baseAmount: formatGuaraniesGs(result.alternative.baseAmount),
              commission: formatGuaraniesGs(result.alternative.commissionAmount),
            })}
          </Text>
        </Card>
      )}
    </div>
  );
}
