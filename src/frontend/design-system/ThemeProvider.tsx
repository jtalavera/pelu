import { type ReactNode } from "react";
import { ThemeContext } from "../src/context/ThemeContext";
import { useTheme } from "../src/hooks/useTheme";

/** Test / story wrapper: same theme hook + context as {@link App}. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}
