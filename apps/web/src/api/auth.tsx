import React, { createContext, useContext, useEffect, useState } from "react";

import { apiFetch, getToken, setToken } from "./client";

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  permissions: string[];
  roles: string[];
  working_hours_start?: string;
  working_hours_end?: string;
  home_timezone?: string;
  secondary_timezone?: string | null;
  working_days?: string;
  min_meeting_notice_minutes?: number;
  meeting_buffer_minutes?: number;
}

/** True when the user may enter Settings at all (admin or any section view). */
export function canSeeSettings(user: CurrentUser | null): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return (user.permissions ?? []).some((p) => p.endsWith(".view"));
}

/** Working-hours window as [startHour, endHour] (defaults 9–17). */
export function workingHoursOf(user: CurrentUser | null): [number, number] {
  const parse = (v: string | undefined, fallback: number) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
    if (!m) return fallback;
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    return h;
  };
  const start = parse(user?.working_hours_start, 9);
  const end = parse(user?.working_hours_end, 17);
  return start < end ? [start, end] : [9, 17];
}

interface AuthContextValue {
  token: string | null;
  user: CurrentUser | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signup: (email: string, displayName: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    apiFetch<CurrentUser>("/auth/me")
      .then((me) => {
        // Home-timezone changes are user-confirmed (CalendarPage prompts
        // when the browser zone differs) — never silently rewritten here.
        setUser(me);
      })
      .catch(() => {
        // Stale/invalid token — drop it so the app falls back to the login screen.
        setToken(null);
        setTokenState(null);
      });
  }, [token]);

  async function login(email: string, password: string, rememberMe: boolean = true) {
    const res = await apiFetch<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, remember_me: rememberMe }),
    });
    setToken(res.access_token, rememberMe);
    setTokenState(res.access_token);
  }

  async function signup(email: string, displayName: string, password: string) {
    const res = await apiFetch<{ access_token: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, display_name: displayName, password }),
    });
    setToken(res.access_token, true);
    setTokenState(res.access_token);
  }

  function logout() {
    apiFetch("/auth/logout", { method: "POST" }).catch(() => {
      // Ignore network errors on logout so local session always clears
    });
    setToken(null);
    setTokenState(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ token, user, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
