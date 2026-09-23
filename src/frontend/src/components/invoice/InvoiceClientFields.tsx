import { useTranslation } from "react-i18next";
import { Checkbox, Heading, Input, Label, Select, Text } from "@design-system";
import { ClientSearchField, type ClientSelection } from "../ClientSearchField";
import { FieldValidationError } from "../FieldValidationError";
import { IDENTITY_DOCUMENT_TYPE_OPTIONS } from "./invoiceFormShared";

export type InvoiceClientFieldsValue = {
  selection: ClientSelection;
  email: string;
  displayName: string;
  identityDocumentType: string;
  identityDocumentNumber: string;
  taxpayerType: string;
};

/**
 * Same legacy derivation the backend uses (`ClientIdentityDocumentType.resolve`) — an explicit type
 * wins, otherwise RUC if present, else Cédula paraguaya if a document number is present.
 */
export function resolveIdentityDocumentTypeAndNumber(client: {
  ruc?: string | null;
  identityDocumentNumber?: string | null;
  identityDocumentType?: string | null;
}): { type: string; number: string } {
  if (client.identityDocumentType) {
    const number =
      client.identityDocumentType === "RUC"
        ? (client.ruc ?? "")
        : (client.identityDocumentNumber ?? "");
    return { type: client.identityDocumentType, number };
  }
  if (client.ruc) return { type: "RUC", number: client.ruc };
  if (client.identityDocumentNumber) {
    return { type: "CEDULA_PARAGUAYA", number: client.identityDocumentNumber };
  }
  return { type: "RUC", number: "" };
}

export const emptyInvoiceClientFields = (): InvoiceClientFieldsValue => ({
  selection: null,
  email: "",
  displayName: "",
  identityDocumentType: "RUC",
  identityDocumentNumber: "",
  taxpayerType: "PERSONA_FISICA",
});

/**
 * Issue #175: the "Identificar cliente" fields (client search, recipient email, "sin nominar"
 * checkbox, display name / document type / document number / taxpayer type). Fully controlled.
 * Same DOM ids as `NewInvoiceTab` (`billing-client-search`, `billing-client-email`,
 * `client-display-name`, `client-identity-document-type`, …).
 */
export function InvoiceClientFields({
  value,
  onChange,
  emailError,
  errors,
  onCreateNew,
}: {
  value: InvoiceClientFieldsValue;
  onChange: (next: InvoiceClientFieldsValue) => void;
  emailError?: string | null;
  errors?: string | null;
  onCreateNew?: (query: string) => void;
}) {
  const { t } = useTranslation();
  const isInnominado = value.identityDocumentType === "INNOMINADO";

  function handleSelectionChange(selection: ClientSelection) {
    if (selection?.type === "client") {
      const resolved = resolveIdentityDocumentTypeAndNumber(selection.client);
      onChange({
        selection,
        email: selection.client.email ?? "",
        displayName: selection.client.fullName,
        identityDocumentType: resolved.type === "INNOMINADO" ? "RUC" : resolved.type,
        identityDocumentNumber: resolved.type === "INNOMINADO" ? "" : resolved.number,
        taxpayerType: selection.client.taxpayerType ?? "PERSONA_FISICA",
      });
    } else if (selection?.type === "occasional") {
      onChange({
        ...emptyInvoiceClientFields(),
        selection,
      });
    } else {
      onChange({ ...emptyInvoiceClientFields() });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading as="h3" className="text-base">
        {t("femme.billing.invoice.clientSection")}
      </Heading>
      <ClientSearchField
        id="billing-client-search"
        value={value.selection}
        onChange={handleSelectionChange}
        activeOnly
        onCreateNew={onCreateNew}
        label={t("femme.billing.invoice.clientSearchLabel")}
        placeholder={t("femme.billing.invoice.clientPlaceholder")}
      />
      <div>
        <Label htmlFor="billing-client-email">{t("femme.billing.invoice.clientEmailLabel")}</Label>
        <Input
          id="billing-client-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          placeholder={t("femme.billing.invoice.clientEmailPlaceholder")}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "billing-client-email-err" : "billing-client-email-hint"}
          className="mt-1 w-full"
        />
        {emailError ? (
          <FieldValidationError id="billing-client-email-err">{emailError}</FieldValidationError>
        ) : (
          <Text id="billing-client-email-hint" variant="muted" className="mt-1 text-sm">
            {t("femme.billing.invoice.clientEmailHint")}
          </Text>
        )}
      </div>
      <div className="flex flex-col gap-4 border-t border-[rgb(var(--color-border))] pt-4">
        <label
          htmlFor="client-unnamed-invoice"
          className="flex cursor-pointer items-center gap-2 text-sm font-medium"
        >
          <Checkbox
            id="client-unnamed-invoice"
            checked={isInnominado}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({
                  ...value,
                  identityDocumentType: "INNOMINADO",
                  displayName: "",
                  identityDocumentNumber: "",
                });
              } else if (value.selection?.type === "client") {
                const resolved = resolveIdentityDocumentTypeAndNumber(value.selection.client);
                onChange({
                  ...value,
                  displayName: value.selection.client.fullName,
                  identityDocumentType: resolved.type === "INNOMINADO" ? "RUC" : resolved.type,
                  identityDocumentNumber:
                    resolved.type === "INNOMINADO" ? "" : resolved.number,
                });
              } else {
                onChange({
                  ...value,
                  identityDocumentType: "RUC",
                  displayName: "",
                  identityDocumentNumber: "",
                });
              }
            }}
          />
          {t("femme.billing.invoice.unnamedInvoice")}
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="client-display-name">
              {t("femme.billing.invoice.clientDisplayName")}
            </Label>
            <Input
              id="client-display-name"
              value={value.displayName}
              onChange={(e) => onChange({ ...value, displayName: e.target.value })}
              placeholder={t("femme.billing.invoice.clientDisplayNamePlaceholder")}
              disabled={isInnominado}
              className="mt-1 w-full"
            />
          </div>
          <div>
            <Label htmlFor="client-identity-document-type">
              {t("femme.clients.identityDocumentType")}
            </Label>
            <Select
              id="client-identity-document-type"
              value={value.identityDocumentType}
              onChange={(e) => onChange({ ...value, identityDocumentType: e.target.value })}
              disabled={isInnominado}
              className="mt-1 w-full"
            >
              {IDENTITY_DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="client-identity-document-number">
              {t("femme.clients.identityDocumentNumber")}
            </Label>
            <Input
              id="client-identity-document-number"
              value={value.identityDocumentNumber}
              onChange={(e) => onChange({ ...value, identityDocumentNumber: e.target.value })}
              placeholder={t("femme.clients.identityDocumentNumberPlaceholder")}
              disabled={isInnominado}
              className="mt-1 w-full"
            />
          </div>
          {value.identityDocumentType === "RUC" && (
            <div>
              <Label htmlFor="client-taxpayer-type">{t("femme.clients.taxpayerType")}</Label>
              <Select
                id="client-taxpayer-type"
                value={value.taxpayerType}
                onChange={(e) => onChange({ ...value, taxpayerType: e.target.value })}
                className="mt-1 w-full"
              >
                <option value="PERSONA_FISICA">
                  {t("femme.clients.taxpayerTypePersonaFisica")}
                </option>
                <option value="PERSONA_JURIDICA">
                  {t("femme.clients.taxpayerTypePersonaJuridica")}
                </option>
              </Select>
            </div>
          )}
        </div>
      </div>
      {errors ? (
        <FieldValidationError id="billing-client-fields-err">{errors}</FieldValidationError>
      ) : null}
    </div>
  );
}
