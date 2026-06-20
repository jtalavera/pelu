import { useTranslation } from "react-i18next";

export function FiscalRucWarning() {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      style={{
        background: "var(--color-warning-lt)",
        borderRadius: "var(--radius-md)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--color-warning)",
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 12, color: "var(--color-warning)" }}>
        {t("femme.dashboard.alerts.businessRucMissing")}
      </span>
    </div>
  );
}
