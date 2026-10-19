import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import "./theme.css";
import { AuthProvider, useAuth } from "./api/auth";
import { AppearanceProvider } from "./appearance";
import { ToastProvider } from "./components/Toast";
import CalendarPage from "./pages/CalendarPage";

// Route-level code-splitting: lazy-load sub-surfaces to slash initial bundle size
const LoginPage = React.lazy(() => import("./pages/LoginPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const StartPage = React.lazy(() => import("./pages/StartPage"));
const BookPage = React.lazy(() => import("./pages/BookPage"));
const CancelBookingPage = React.lazy(() => import("./pages/CancelBookingPage"));
const KioskPage = React.lazy(() => import("./pages/KioskPage"));
const KioskPairPage = React.lazy(() => import("./pages/KioskPairPage"));

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
            <React.Suspense
              fallback={
                <div
                  tabIndex={-1}
                  aria-label="Loading page"
                  role="status"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    color: "var(--text-muted, #64748b)",
                  }}
                >
                  <span>Loading...</span>
                </div>
              }
            >
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                {/* First-run wizard — skippable, delegates never enter. */}
                <Route
                  path="/start"
                  element={
                    <RequireAuth>
                      <StartPage />
                    </RequireAuth>
                  }
                />
                {/* Public booking surface — no auth shell by design. */}
                <Route path="/book/:slug" element={<BookPage />} />
                <Route path="/book/cancel/:token" element={<CancelBookingPage />} />
                {/* Wall display — token capability, no auth shell by design. */}
                <Route path="/kiosk/pair" element={<KioskPairPage />} />
                <Route path="/kiosk/:token" element={<KioskPage />} />
                {/* Main calendar command center. */}
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
            </React.Suspense>
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
