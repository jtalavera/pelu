import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./App";
import i18n from "./i18n";
import { getInitialLanguage, I18N_LANGUAGE_STORAGE_KEY } from "./i18n/languagePreference";
import "./index.css";

const rootEl = document.getElementById("root")!;

async function bootstrap() {
  if (import.meta.env.VITE_PLAYWRIGHT === "1") {
    localStorage.setItem(I18N_LANGUAGE_STORAGE_KEY, "en");
  }
  await i18n.changeLanguage(getInitialLanguage());
  createRoot(rootEl).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
