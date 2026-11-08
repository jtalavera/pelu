import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@design-system";
import type { ReceiptFormat } from "../api/downloadInvoicePdf";

/**
 * «Descargar comprobante»: the non-fiscal receipt comes in two formats (A4 sheet and 80 mm ticket) and the
 * user picks one when downloading. The button opens the two options in place (no floating menu, so it never
 * gets clipped by a dialog); picking one downloads it and folds the options back.
 */
export function ReceiptDownloadButton({
  onDownload,
  className,
  testId,
  size = "md",
}: {
  onDownload: (format: ReceiptFormat) => void | Promise<void>;
  className?: string;
  testId: string;
  size?: "md" | "lg";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options: Array<{ format: ReceiptFormat; label: string; hint: string }> = [
    { format: "A4", label: t("femme.billing.receipt.a4"), hint: t("femme.billing.receipt.a4Hint") },
    { format: "TICKET", label: t("femme.billing.receipt.ticket"), hint: t("femme.billing.receipt.ticketHint") },
  ];

  return (
    <div ref={rootRef} className="flex w-full flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        size={size}
        className={className}
        aria-expanded={open}
        aria-haspopup="true"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
      >
        {t("femme.billing.receipt.download")}
        <span aria-hidden="true" className="ml-2 text-xs">
          {open ? "▴" : "▾"}
        </span>
      </Button>
      {open && (
        <div
          role="group"
          aria-label={t("femme.billing.receipt.chooseFormat")}
          data-testid={`${testId}-formats`}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {options.map((o) => (
            <button
              key={o.format}
              type="button"
              data-testid={`${testId}-${o.format.toLowerCase()}`}
              onClick={() => {
                setOpen(false);
                void onDownload(o.format);
              }}
              className="flex min-h-11 flex-col items-start justify-center rounded-xl border border-line bg-surface px-3 py-2 text-left hover:bg-primary-lt"
            >
              <span className="text-sm font-bold text-ink">{o.label}</span>
              <span className="text-xs text-ink-3">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
