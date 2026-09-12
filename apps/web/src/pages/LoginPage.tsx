import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../api/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      // apiFetch throws "401 Unauthorized: …" for bad credentials — show a
      // clean message for that, and a distinct one for outages so users
      // don't retry a correct password against a down server.
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.startsWith("401")
          ? "Invalid email or password."
          : "Couldn't reach the server. Check your connection and try again."
      );
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--bg-app)",
      }}
    >
      <img src="/logo.svg" alt="Chronarch" width={56} height={56} style={{ borderRadius: 14, marginBottom: 16 }} />
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 28, color: "var(--text-primary)" }}>Chronarch</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, width: 300 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        <button type="submit" style={btnStyle}>
          Sign in
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 14,
  background: "var(--bg-raised)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  colorScheme: "dark",
};

const btnStyle: React.CSSProperties = {
  padding: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--accent)",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  marginTop: 6,
};
