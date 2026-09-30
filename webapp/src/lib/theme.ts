import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "scriptor-theme";

// index.html zet data-theme al vóór de eerste paint; hier alleen uitlezen.
function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  const setTheme = useCallback((next: Theme) => {
    if (next === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Opslag geblokkeerd: keuze geldt dan alleen voor deze sessie.
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
