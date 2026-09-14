import React, { useEffect, useRef, useState } from "react";
import { friendlyError } from "../api/client";
import { CopilotMessage, copilotChatStream } from "../api/calendar";
import Icon from "./Icon";
import Markdown from "./Markdown";

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
  // Live reasoning trace for the in-flight turn.
  const [steps, setSteps] = useState<{ text: string; summary?: string; done: boolean }[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, steps, draft, status]);

  if (!isOpen) return null;

  async function executePrompt(promptText: string) {
    if (!promptText.trim() || loading) return;

    const userMsg: CopilotMessage = { role: "user", content: promptText };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);
    setSteps([]);
    setStatus(null);
    setDraft("");

    const runSteps: { text: string; summary?: string; done: boolean }[] = [];
    let runDraft = "";

    const pushSteps = () => setSteps([...runSteps]);

    try {
      await copilotChatStream(
        nextMessages,
        {
          viewedDate: viewedDate.toISOString().split("T")[0],
          viewMode,
        },
        (e) => {
          if (e.type === "status") {
            if (runSteps.length === 0 && !runDraft) setStatus(e.text);
          } else if (e.type === "tool") {
            setStatus(null);
            runSteps.push({ text: e.text, done: false });
            pushSteps();
          } else if (e.type === "result") {
            setStatus(null);
            const open = [...runSteps].reverse().find((s) => !s.done);
            if (open) {
              open.done = true;
              open.summary = e.summary;
            }
            pushSteps();
          } else if (e.type === "token") {
            setStatus(null);
            runDraft += e.text;
            setDraft(runDraft);
          } else if (e.type === "done") {
            const content = e.content || runDraft;
            const trace = runSteps.map((s) => ({ text: s.text, summary: s.summary }));
            setMessages([...nextMessages, { role: "assistant", content, trace }]);
            if (onRefreshEvents) onRefreshEvents();
          } else if (e.type === "error") {
            // Server sends an already-friendly message — show it verbatim.
            setError(e.message);
          }
        }
      );
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
      setSteps([]);
      setStatus(null);
      setDraft("");
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
      className="vibrancy mount-rise"
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
            <Icon name="sparkles" size={16} />
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
            {m.trace && m.trace.length > 0 && (
              <details style={{ marginBottom: 8 }}>
                <summary
                  style={{
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    listStyle: "none",
                  }}
                >
                  {m.trace.length} step{m.trace.length === 1 ? "" : "s"} ▸
                </summary>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                  {m.trace.map((t, i) => (
                    <div key={i} style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                      ✓ {t.text}
                      {t.summary ? <span style={{ color: "var(--text-tertiary)" }}> — {t.summary}</span> : null}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {m.role === "user" ? (
              m.content
            ) : (
              <Markdown text={m.content ?? ""} />
            )}
          </div>
        ))}

        {loading && (
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "88%",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-raised)",
              color: "var(--text-primary)",
              fontSize: 13,
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {status && steps.length === 0 && !draft && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
                <Icon name="refresh" size={13} /> {status}
              </span>
            )}
            {steps.map((s, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}
              >
                <span style={{ color: s.done ? "var(--success)" : "var(--warning)" }}>
                  {s.done ? "✓" : <Icon name="refresh" size={12} />}
                </span>
                <span>
                  {s.text}
                  {s.done && s.summary ? <span style={{ color: "var(--text-tertiary)" }}> — {s.summary}</span> : null}
                  {!s.done ? "…" : null}
                </span>
              </div>
            ))}
            {draft && <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{draft}</div>}
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
