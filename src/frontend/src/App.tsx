import { BrowserRouter } from "react-router-dom";
import { SyncHtmlLang } from "./components/SyncHtmlLang";
import { ThemeContext } from "./context/ThemeContext";
import { useTheme } from "./hooks/useTheme";
import { AppRoutes } from "./routes";

export function App() {
  const { theme, toggle } = useTheme();

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <BrowserRouter>
        <SyncHtmlLang />
        <AppRoutes />
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}
