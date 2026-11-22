import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n";
import type { AssistantDraft, ServiceRecordDraftPayload } from "../../api/assistant";
import type { AssistantDraftCard } from "../../assistant/AssistantContext";
import { ServiceRecordDraftCard } from "./ServiceRecordDraftCard";

type Line = ServiceRecordDraftPayload["lines"][number];

const line = (over: Partial<Line> & Pick<Line, "position" | "name" | "mark">): Line => ({
  serviceId: 1,
  quantity: 1,
  professionalId: 9,
  professionalName: "Lu",
  ...over,
});

const adminPayload: ServiceRecordDraftPayload = {
  clientId: 42,
  clientName: "MARIA GOMEZ",
  serviceRecordId: 500,
  appointmentId: null,
  appointmentTime: null,
  lines: [
    line({ position: 1, name: "Corte", mark: "KEPT", unitPrice: 50000, lineTotal: 50000 }),
    line({ position: 2, name: "Tintura", mark: "NEW", unitPrice: 120000, lineTotal: 120000 }),
    line({ position: 0, name: "Peinado", mark: "REMOVED", unitPrice: 30000, lineTotal: 30000 }),
  ],
  changes: [],
  notApplied: [],
  total: 170000,
  recordFingerprint: "fp",
};

/** What the server sends a professional: the same shape with every amount absent. */
const proPayload: ServiceRecordDraftPayload = {
  ...adminPayload,
  lines: [
    line({ position: 1, name: "Corte", mark: "KEPT" }),
    line({ position: 2, name: "Tintura", mark: "NEW" }),
  ],
  total: undefined,
};

function card(payload: ServiceRecordDraftPayload, over?: Partial<AssistantDraftCard>, status: AssistantDraft["status"] = "DRAFT"): AssistantDraftCard {
  return {
    kind: "draft",
    draft: {
      id: "d1",
      type: "SERVICE_RECORD",
      status,
      createdAt: "2026-11-22T10:00:00Z",
      expiresAt: "2026-11-23T10:00:00Z",
      missing: [],
      payload,
      resultType: null,
      resultId: null,
    },
    ...over,
  };
}

function renderCard(c: AssistantDraftCard) {
  const onConfirm = vi.fn();
  const onDiscard = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ServiceRecordDraftCard card={c} onConfirm={onConfirm} onDiscard={onDiscard} />
    </I18nextProvider>,
  );
  return { onConfirm, onDiscard };
}

describe("ServiceRecordDraftCard", () => {
  beforeEach(() => {
    void i18n.changeLanguage("es");
  });
  afterEach(() => cleanup());

  it("shows the administrator the lines, their amounts and the total", () => {
    renderCard(card(adminPayload));

    const first = screen.getByTestId("assistant-record-line-1");
    expect(first.textContent).toContain("Corte");
    expect(first.textContent).toContain("Gs. 50.000");
    expect(first.getAttribute("data-mark")).toBe("KEPT");
    expect(screen.getByTestId("assistant-record-line-2").getAttribute("data-mark")).toBe("NEW");
    expect(screen.getByTestId("assistant-record-total").textContent).toContain("Gs. 170.000");
    expect(screen.getByTestId("assistant-draft-client").textContent).toContain("MARIA GOMEZ");
  });

  it("shows a professional no amount and no total at all", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ServiceRecordDraftCard card={card(proPayload)} onConfirm={vi.fn()} onDiscard={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("assistant-record-line-1").textContent).toContain("Corte");
    expect(screen.queryByTestId("assistant-record-total")).toBeNull();
    expect(container.textContent).not.toContain("Gs.");
  });

  it("marks what was added, changed and taken out", () => {
    renderCard(
      card({
        ...adminPayload,
        lines: [
          line({ position: 1, name: "Corte", mark: "CHANGED", quantity: 3, unitPrice: 50000, lineTotal: 150000 }),
          line({ position: 2, name: "Tintura", mark: "NEW", unitPrice: 120000, lineTotal: 120000 }),
          line({ position: 0, name: "Peinado", mark: "REMOVED", unitPrice: 30000, lineTotal: 30000 }),
        ],
      }),
    );

    expect(screen.getByTestId("assistant-record-line-1").textContent).toContain("×3");
    expect(screen.getByTestId("assistant-record-line-1").textContent).toContain("Cambiado");
    expect(screen.getByTestId("assistant-record-line-2").textContent).toContain("Nuevo");
    const removed = screen.getByTestId("assistant-record-line-removed-0");
    expect(removed.textContent).toContain("Peinado");
    expect(removed.getAttribute("data-mark")).toBe("REMOVED");
  });

  it("says which turno a new ficha is linked to", () => {
    renderCard(card({ ...adminPayload, serviceRecordId: null, appointmentId: 70, appointmentTime: "15:00" }));

    expect(screen.getByTestId("assistant-record-appointment").textContent).toContain("15:00");
  });

  it("lists what no longer applied, and warns when the ficha changed", () => {
    renderCard(
      card(
        { ...adminPayload, notApplied: [{ op: "REMOVE", name: "Tintura" }] },
        { recordChanged: true },
      ),
    );

    expect(screen.getByTestId("assistant-record-not-applied").textContent).toContain("Tintura");
    expect(screen.getByTestId("assistant-record-changed")).toBeTruthy();
  });

  it("saves and discards with the buttons, and cannot be pressed while busy", async () => {
    const { onConfirm, onDiscard } = renderCard(card(adminPayload));

    await userEvent.click(screen.getByTestId("assistant-draft-confirm"));
    await userEvent.click(screen.getByTestId("assistant-draft-discard"));

    expect(onConfirm).toHaveBeenCalledWith("d1");
    expect(onDiscard).toHaveBeenCalledWith("d1");
    cleanup();

    renderCard(card(adminPayload, { busy: true }));
    expect((screen.getByTestId("assistant-draft-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("assistant-draft-discard") as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns green once saved, with no more buttons", () => {
    renderCard(
      card(
        adminPayload,
        {
          result: { type: "SERVICE_RECORD", invoiceId: null, invoiceNumberFormatted: null, sifenSubmissionStatus: null, serviceRecordId: 500, draft: card(adminPayload).draft },
        },
        "CONFIRMED",
      ),
    );

    const frame = screen.getByTestId("assistant-draft-card");
    expect(frame.getAttribute("data-status")).toBe("CONFIRMED");
    expect(within(frame).getByText("Ficha guardada", { selector: "span" })).toBeTruthy();
    expect(screen.queryByTestId("assistant-draft-confirm")).toBeNull();
  });

  it("dims a replaced draft and offers nothing to press", () => {
    renderCard(card(adminPayload, undefined, "SUPERSEDED"));

    expect(screen.getByTestId("assistant-draft-card").getAttribute("data-status")).toBe("SUPERSEDED");
    expect(screen.getByTestId("assistant-draft-inactive")).toBeTruthy();
    expect(screen.queryByTestId("assistant-draft-confirm")).toBeNull();
  });

  it("shows a translated error from the server and keeps the buttons", () => {
    const err = Object.assign(new Error("SERVICE_RECORD_NOT_OPEN"), { code: "SERVICE_RECORD_NOT_OPEN" });
    renderCard(card(adminPayload, { error: err }));

    expect(screen.getByTestId("assistant-draft-error")).toBeTruthy();
    expect((screen.getByTestId("assistant-draft-confirm") as HTMLButtonElement).disabled).toBe(false);
  });
});
