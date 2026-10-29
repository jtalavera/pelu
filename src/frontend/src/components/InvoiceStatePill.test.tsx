import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { InvoiceStatePill, deriveInvoiceState } from "./InvoiceStatePill";

describe("deriveInvoiceState (billing redesign: one plain-language state per invoice)", () => {
  it.each([
    [{ status: "ISSUED", sifenSubmissionStatus: null }, "issued"],
    [{ status: "ISSUED" }, "issued"],
    [{ status: "ISSUED", sifenSubmissionStatus: "APPROVED" }, "issued"],
    [{ status: "ISSUED", sifenSubmissionStatus: "APPROVED_WITH_OBSERVATION" }, "issued"],
    [{ status: "ISSUED", sifenSubmissionStatus: "QUEUED" }, "processing"],
    [{ status: "ISSUED", sifenSubmissionStatus: "PENDING_VERIFICATION" }, "processing"],
    [{ status: "ISSUED", sifenSubmissionStatus: "REJECTED" }, "attention"],
    [{ status: "ISSUED", sifenSubmissionStatus: "CANCELLED" }, "voided"],
    [{ status: "VOIDED", sifenSubmissionStatus: "APPROVED" }, "voided"],
    [{ status: "VOIDED", sifenSubmissionStatus: "REJECTED" }, "voided"],
  ])("%j -> %s", (invoice, expected) => {
    expect(deriveInvoiceState(invoice)).toBe(expected);
  });
});

describe("InvoiceStatePill", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
  });

  it.each([
    [{ status: "ISSUED", sifenSubmissionStatus: "APPROVED" }, "Approved"],
    [{ status: "ISSUED", sifenSubmissionStatus: "QUEUED" }, "In progress"],
    [{ status: "ISSUED", sifenSubmissionStatus: "REJECTED" }, "Needs attention"],
    [{ status: "VOIDED" }, "Voided"],
  ])("renders %j as %s", (invoice, label) => {
    render(
      <I18nextProvider i18n={i18n}>
        <InvoiceStatePill invoice={invoice} />
      </I18nextProvider>,
    );
    expect(screen.getByText(label)).toBeTruthy();
  });
});
