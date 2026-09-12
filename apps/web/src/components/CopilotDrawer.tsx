import React, { useEffect, useRef, useState } from "react";
import { CopilotMessage, copilotChat } from "../api/calendar";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRefreshEvents?: () => void;
  viewedDate?: Date;
  viewMode?: string;
}

const QUICK_ACTIONS = [
  {
    id: "today-summary",
    icon: "📋",
    label: "Today's Schedule",
    prompt: "Summarize my meetings and agenda for today with times and attendees.",
  },
  {
    id: "find-focus",
    icon: "⏱️",
    label: "Find Deep Work",
    prompt: "Find available 45-minute focus time blocks in my calendar this week.",
  },
  {
    id: "earliest-tomorrow",
    icon: "⚡",
    label: "Tomorrow's Kickoff",
    prompt: "What is my earliest meeting tomorrow, and are there any conflicts?",
  },
  {
    id: "external-guests",
    icon: "👥",
    label: "External Meetings",
    prompt: "List any meetings this week that include external guests or attendees.",
  },
];

export default function CopilotDrawer({
  isOpen,
  onClose,
  onRefreshEvents,
  viewedDate = new Date(),
  viewMode = "day",
}: Props) {
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

  async function executePrompt(promptText: string) {
    if (!promptText.trim() || loading) return;

    const userMsg: CopilotMessage = { role: "user", content: promptText };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await copilotChat(nextMessages, {
        userTime: new Date().toISOString(),
        viewedDate: viewedDate.toISOString().split("T")[0],
        viewMode,
      });
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    executePrompt(input);
  }

  const dateHeading = viewedDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <aside
      className="vibrancy"
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: 400,
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255, 159, 10, 0.15)",
              color: "var(--warning)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ✨
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Calendar Copilot</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
              Active on {dateHeading} ({viewMode} view)
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="icon-btn hoverable"
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

      {/* Quick Action Prompt Chips */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Suggested Inquiries
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => executePrompt(action.prompt)}
              disabled={loading}
              className="hoverable"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "6px 10px",
                textAlign: "left",
                cursor: loading ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: "var(--text-primary)",
              }}
            >
              <span>{action.icon}</span>
              <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {action.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Messages Scroll Area */}
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
            <span style={{ display: "inline-block", animation: "pulse 1.5s infinite" }}>
              ✨ Querying calendars…
            </span>
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

      {/* Input Form */}
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
          style={{ padding: "8px 16px" }}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
