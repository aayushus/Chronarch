import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import "./theme.css";
import { AuthProvider, useAuth } from "./api/auth";
import { AppearanceProvider } from "./appearance";
import { ToastProvider } from "./components/Toast";
import LoginPage from "./pages/LoginPage";
import CalendarPage from "./pages/CalendarPage";
import SettingsPage from "./pages/SettingsPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  // user is null momentarily while /auth/me resolves after a fresh token —
  // avoid a flash-redirect to "/" by waiting rather than bouncing early.
  if (user === null) return null;
  // Every authenticated user may enter Settings: the Account tab is always
  // visible and every other tab gates itself on permissions.
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <AppearanceProvider>
        <ToastProvider>
          <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <CalendarPage />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAdmin>
                <SettingsPage />
              </RequireAdmin>
            }
          />
        </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AppearanceProvider>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
