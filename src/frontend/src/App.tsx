import { BrowserRouter } from "react-router-dom";
import { SyncDocumentTitle } from "./components/SyncDocumentTitle";
import { SyncHtmlLang } from "./components/SyncHtmlLang";
import { ThemeContext } from "./context/ThemeContext";
import { useTheme } from "./hooks/useTheme";
import { useVersionCheck } from "./hooks/useVersionCheck";
import { AppRoutes } from "./routes";
import { TourProvider } from "./tour/TourContext";

export function App() {
  const { theme, toggle } = useTheme();
  useVersionCheck();

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <BrowserRouter>
        <TourProvider>
          <SyncHtmlLang />
          <SyncDocumentTitle />
          <AppRoutes />
        </TourProvider>
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}
