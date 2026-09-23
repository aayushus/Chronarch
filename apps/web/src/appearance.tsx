import React, { createContext, useContext, useEffect, useState } from "react";

/** Appearance prefs (Chronarch design philosophy): theme + density are
 * client-side, persisted, and applied as data attributes so the entire UI
 * re-themes through CSS tokens alone — no component logic branches.
 */

export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type CalendarRowMinutes = 30 | 60;

interface AppearanceValue {
  theme: Theme;
  density: Density;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  calendarRowMinutes: CalendarRowMinutes;
  setCalendarRowMinutes: (minutes: CalendarRowMinutes) => void;
  /** Grid hour height in px for Day/Week views. */
  hourHeight: (base: number) => number;
}

const AppearanceContext = createContext<AppearanceValue | undefined>(undefined);

function stored<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (v as T) || fallback;
  } catch {
    return fallback;
  }
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    stored<Theme>("chronarch_theme", "light") === "dark" ? "dark" : "light"
  );
  const [density, setDensityState] = useState<Density>(() =>
    stored<Density>("chronarch_density", "comfortable") === "compact" ? "compact" : "comfortable"
  );
  const [calendarRowMinutes, setCalendarRowMinutesState] = useState<CalendarRowMinutes>(() =>
    stored<string>("chronarch_calendar_row_minutes", "30") === "60" ? 60 : 30
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("chronarch_theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try {
      localStorage.setItem("chronarch_density", density);
    } catch {
      /* private mode */
    }
  }, [density]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }
  function setDensity(d: Density) {
    setDensityState(d);
  }
  function setCalendarRowMinutes(minutes: CalendarRowMinutes) {
    setCalendarRowMinutesState(minutes);
    try {
      localStorage.setItem("chronarch_calendar_row_minutes", String(minutes));
    } catch {
      /* private mode */
    }
  }
  function hourHeight(base: number): number {
    const densityScale = density === "compact" ? 0.68 : 1;
    return Math.round(base * densityScale * (60 / calendarRowMinutes));
  }

  return (
    <AppearanceContext.Provider value={{ theme, density, setTheme, setDensity, calendarRowMinutes, setCalendarRowMinutes, hourHeight }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}
