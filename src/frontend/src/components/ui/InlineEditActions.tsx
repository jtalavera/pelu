import { useTranslation } from "react-i18next";

interface InlineEditActionsProps {
  isEditing: boolean;
  saving: boolean;
  saveError: string | null;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDeactivate?: () => void;
  onActivate?: () => void;
  isActive?: boolean;
  /** Overrides default i18n for the activate/reactivate action when inactive. */
  activateLabel?: string;
  /** Overrides default i18n for deactivate when active. */
  deactivateLabel?: string;
  /** Disables the activate button (e.g. while a request is in flight). */
  activateDisabled?: boolean;
}

export function InlineEditActions({
  isEditing,
  saving,
  saveError,
  onEdit,
  onSave,
  onCancel,
  onDeactivate,
  onActivate,
  isActive = true,
  activateLabel,
  deactivateLabel,
  activateDisabled = false,
}: InlineEditActionsProps) {
  const { t } = useTranslation();

  const btnBase: React.CSSProperties = {
    padding: "5px 12px",
    borderRadius: "var(--radius-md)",
    fontSize: 12,
    cursor: "pointer",
    border: "0.5px solid var(--color-stone-md)",
    background: "transparent",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    transition: "background 0.12s",
    whiteSpace: "nowrap",
  };

  if (isEditing) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{ ...btnBase, color: "var(--color-ink-2)" }}
          >
            {t("femme.inlineActions.cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{
              ...btnBase,
              background: saving ? "var(--color-rose-md)" : "var(--color-rose)",
              color: "#fff",
              border: "none",
            }}
          >
            {saving ? t("femme.inlineActions.saving") : t("femme.inlineActions.save")}
          </button>
        </div>
        {saveError ? (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-danger)",
            }}
          >
            {saveError}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      {isActive ? (
        <>
          <button
            type="button"
            onClick={onEdit}
            style={{
              ...btnBase,
              color: "var(--color-rose)",
              borderColor: "var(--color-rose-md)",
            }}
          >
            {t("femme.inlineActions.edit")}
          </button>
          {onDeactivate ? (
            <button
              type="button"
              onClick={onDeactivate}
              style={{ ...btnBase, color: "var(--color-ink-3)" }}
            >
              {deactivateLabel ?? t("femme.inlineActions.deactivate")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onEdit}
            style={{
              ...btnBase,
              color: "var(--color-rose)",
              borderColor: "var(--color-rose-md)",
            }}
          >
            {t("femme.inlineActions.edit")}
          </button>
          {onActivate ? (
            <button
              type="button"
              disabled={activateDisabled}
              onClick={onActivate}
              style={{
                ...btnBase,
                color: "var(--color-rose)",
                borderColor: "var(--color-rose-md)",
                opacity: activateDisabled ? 0.6 : 1,
              }}
            >
              {activateLabel ?? t("femme.inlineActions.activate")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
