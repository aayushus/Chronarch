import React, { createContext, useContext, useEffect, useState } from "react";

import { apiFetch, getToken, setToken } from "./client";

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_admin: boolean;
}

interface AuthContextValue {
  token: string | null;
  user: CurrentUser | null;
  login: (email: string, password: string) => Promise<void>;
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
      .then(setUser)
      .catch(() => {
        // Stale/invalid token — drop it so the app falls back to the login screen.
        setToken(null);
        setTokenState(null);
      });
  }, [token]);

  async function login(email: string, password: string) {
    const res = await apiFetch<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(res.access_token);
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

  return <AuthContext.Provider value={{ token, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
