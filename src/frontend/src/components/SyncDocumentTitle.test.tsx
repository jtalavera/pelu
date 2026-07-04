import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n";
import { SyncDocumentTitle } from "./SyncDocumentTitle";

describe("SyncDocumentTitle", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  it("sets the document title in the active language and updates on language change", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SyncDocumentTitle />
      </I18nextProvider>,
    );

    await waitFor(() => expect(document.title).toBe("Saloon Management"));

    await i18n.changeLanguage("es");

    await waitFor(() => expect(document.title).toBe("Gestión Peluquería"));
  });
});
