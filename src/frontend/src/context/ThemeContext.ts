import { createContext, useContext } from "react";

interface ThemeContextType {
  theme: "light" | "dark";
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggle: () => {},
});

export const useThemeContext = () => useContext(ThemeContext);
