import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown rendering for assistant chat messages (GFM: tables, lists, bold).
 *
 * Raw HTML is NOT enabled — model output containing HTML tags renders as
 * inert text, so a weird completion can never inject markup into the app.
 * Styling matches the chat bubble typography (13px body, subtle tables).
 */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="copilot-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
          strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
          ul: ({ children }) => (
            <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
          code: ({ children }) => (
            <code
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                background: "rgba(255,255,255,0.08)",
                padding: "1px 5px",
                borderRadius: 4,
              }}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                background: "rgba(0,0,0,0.3)",
                padding: "8px 10px",
                borderRadius: 8,
                overflowX: "auto",
                margin: "4px 0 8px",
              }}
            >
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "4px 0 8px" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: 12,
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                textAlign: "left",
                fontWeight: 700,
                padding: "5px 8px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: "5px 8px",
                borderBottom: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
                verticalAlign: "top",
              }}
            >
              {children}
            </td>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)" }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "4px 0 8px",
                paddingLeft: 10,
                borderLeft: "2px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <div style={{ fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>{children}</div>,
          h2: ({ children }) => <div style={{ fontWeight: 700, fontSize: 13.5, margin: "0 0 6px" }}>{children}</div>,
          h3: ({ children }) => <div style={{ fontWeight: 700, fontSize: 13, margin: "0 0 6px" }}>{children}</div>,
          h4: ({ children }) => <div style={{ fontWeight: 700, fontSize: 12.5, margin: "0 0 6px" }}>{children}</div>,
          hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: "8px 0" }} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
