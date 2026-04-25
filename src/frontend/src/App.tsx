import { BrowserRouter } from "react-router-dom";
import { SyncHtmlLang } from "./components/SyncHtmlLang";
import { ThemeContext } from "./context/ThemeContext";
import { useTheme } from "./hooks/useTheme";
import { AppRoutes } from "./routes";
import { TourProvider } from "./tour/TourContext";
import { TourJoyride } from "./tour/TourJoyride";

export function App() {
  const { theme, toggle } = useTheme();

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <BrowserRouter>
        <TourProvider>
          <SyncHtmlLang />
          <TourJoyride />
          <AppRoutes />
        </TourProvider>
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}
