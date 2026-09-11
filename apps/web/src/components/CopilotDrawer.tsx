import React, { useEffect, useRef, useState } from "react";
import { CopilotMessage, copilotChat } from "../api/calendar";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRefreshEvents?: () => void;
}

export default function CopilotDrawer({ isOpen, onClose, onRefreshEvents }: Props) {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      content:
        "Hello! I am your Chronarch AI Copilot. Ask me about your schedule, available slots, or tell me to schedule or reschedule meetings.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || loading) return;

    const userMsg: CopilotMessage = { role: "user", content: prompt };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await copilotChat(nextMessages);
      setMessages([...nextMessages, res.message]);
      if (onRefreshEvents) {
        onRefreshEvents();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside
      className="vibrancy"
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: 380,
        maxWidth: "95vw",
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(255, 255, 255, 0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Calendar Copilot</span>
        </div>
        <button
          onClick={onClose}
          className="icon-btn"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 16,
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.map((m, idx) => (
          <div
            key={idx}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "88%",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              background: m.role === "user" ? "var(--accent)" : "var(--bg-raised)",
              color: m.role === "user" ? "#fff" : "var(--text-primary)",
              border: m.role === "user" ? "none" : "1px solid var(--border-subtle)",
              boxShadow: m.role === "user" ? "0 2px 8px rgba(10, 132, 255, 0.3)" : "none",
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-raised)",
              color: "var(--text-secondary)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ display: "inline-block", animation: "pulse 1.5s infinite" }}>Thinking…</span>
          </div>
        )}
        {error && (
          <div
            style={{
              color: "var(--danger)",
              fontSize: 12,
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(255, 69, 58, 0.1)",
              border: "1px solid rgba(255, 69, 58, 0.3)",
            }}
          >
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "14px 16px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          gap: 8,
          background: "rgba(0, 0, 0, 0.2)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Copilot anything…"
          disabled={loading}
          className="input-standard"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="btn-primary"
        >
          Send
        </button>
      </form>
    </aside>
  );
}
