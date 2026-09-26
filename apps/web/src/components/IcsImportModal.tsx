import React, { useState } from "react";
import { friendlyError } from "../api/client";
import { CalendarSummary, IcsPreviewEvent, importIcsEvent, previewIcs } from "../api/calendar";
import Icon from "./Icon";

interface Props {
  calendars: CalendarSummary[];
  initialContent?: string;
  onClose: () => void;
  onImported: () => void;
}

export default function IcsImportModal({ calendars, initialContent, onClose, onImported }: Props) {
  const [fileContent, setFileContent] = useState<string | null>(initialContent || null);
  const [fileName, setFileName] = useState<string | null>(initialContent ? "pasted.ics" : null);
  const [previewEvents, setPreviewEvents] = useState<IcsPreviewEvent[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Writable calendars only (BR-ICS-003)
  const writableCalendars = calendars.filter(
    (c) => (c.can_create ?? c.writable)
  );

  React.useEffect(() => {
    if (writableCalendars.length > 0 && !selectedCalendarId) {
      setSelectedCalendarId(writableCalendars[0].id);
    }
  }, [writableCalendars, selectedCalendarId]);

  React.useEffect(() => {
    if (initialContent) {
      handleParse(initialContent);
    }
  }, [initialContent]);

  async function handleParse(content: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await previewIcs(content);
      if (res.events.length === 0) {
        setError("No events found in this .ics file.");
      } else {
        setPreviewEvents(res.events);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setFileContent(text);
      handleParse(text);
    };
    reader.readAsText(file);
  }

  async function handleImportAll() {
    if (!selectedCalendarId) {
      setError("Please select a destination calendar.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      for (const ev of previewEvents) {
        await importIcsEvent({
          calendar_id: selectedCalendarId,
          title: ev.title,
          start: ev.start,
          end: ev.end,
          timezone: ev.timezone,
          description: ev.description,
          location: ev.location,
          all_day: ev.all_day,
        });
      }
      onImported();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 540, maxWidth: "90vw", padding: 24 }}
      >
        <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, margin: "0 0 6px" }}>Import .ics Calendar File</h3>
        <p style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", margin: "0 0 16px" }}>
          Upload a local .ics calendar file to preview and import its events into your calendar (BR-ICS-001..003).
        </p>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: "var(--text-md)", marginBottom: 14, background: "rgba(255, 69, 58, 0.1)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>
            {error}
          </div>
        )}

        {!previewEvents.length && !loading && (
          <div
            style={{
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 32,
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 16,
              background: "var(--bg-raised)",
            }}
            onClick={() => document.getElementById("ics-file-input")?.click()}
          >
            <input
              id="ics-file-input"
              type="file"
              accept=".ics,text/calendar"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "var(--radius-xl)",
                background: "rgba(10, 132, 255, 0.12)",
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 8,
              }}
            >
              <Icon name="upload" size={20} />
            </div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600 }}>Click to select or drag & drop an .ics file</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 4 }}>
              Supports standard iCalendar exports (.ics)
            </div>
          </div>
        )}

        {loading && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)", fontSize: "var(--text-md)" }}>
            Parsing .ics file…
          </div>
        )}

        {previewEvents.length > 0 && (
          <div>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 600, marginBottom: 8 }}>
              {previewEvents.length} Event{previewEvents.length === 1 ? "" : "s"} Found in {fileName || "file"}:
            </div>

            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: 8,
                marginBottom: 16,
                background: "var(--bg-raised)",
              }}
            >
              {previewEvents.map((ev, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px 12px",
                    borderBottom: idx < previewEvents.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>{ev.title}</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                    {new Date(ev.start).toLocaleString()} - {new Date(ev.end).toLocaleString()}
                    {ev.all_day && " (All day)"}
                    {ev.location && ` • ${ev.location}`}
                  </div>
                  {ev.description && (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 2, maxHeight: 32, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {ev.description}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: "var(--text-md)", fontWeight: 600, marginBottom: 6 }}>
                Destination Calendar (BR-ICS-003):
              </label>
              <select className="input-standard select"
                value={selectedCalendarId}
                onChange={(e) => setSelectedCalendarId(e.target.value)}
                style={{ width: "100%" }}
              >
                {writableCalendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.account_label})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} type="button" className="btn-secondary">
            Cancel
          </button>
          {previewEvents.length > 0 && (
            <button
              onClick={handleImportAll}
              disabled={importing}
              type="button"
              className="btn-primary"
            >
              {importing ? "Importing…" : `Import ${previewEvents.length} Event${previewEvents.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
