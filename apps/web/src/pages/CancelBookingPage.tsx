import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { apiFetch, friendlyError } from "../api/client";

export default function CancelBookingPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch<{ status: string }>(`/book/reservations/${token}/cancel`, { method: "POST" })
      .then(() => {
        setState("done");
        setMessage("Your booking is cancelled. The calendar invite has been withdrawn.");
      })
      .catch((e) => {
        setState("error");
        setMessage(friendlyError(e));
      });
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", justifyContent: "center", padding: "48px 20px" }}>
      <div style={{ width: 480, maxWidth: "100%", background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xl)", padding: 32, textAlign: "center", alignSelf: "flex-start" }}>
        {state === "working" && <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>Cancelling…</div>}
        {state === "done" && (
          <>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 8 }}>Cancelled</div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>{message}</p>
            <Link to="/" style={{ fontSize: "var(--text-md)", color: "var(--accent)" }}>Back to Calendar</Link>
          </>
        )}
        {state === "error" && (
          <>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: 8 }}>Couldn't cancel</div>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: 0 }}>{message}</p>
          </>
        )}
      </div>
    </div>
  );
}
