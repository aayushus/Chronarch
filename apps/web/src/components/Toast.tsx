import React, { createContext, useCallback, useContext, useRef, useState } from "react";

/** Toast system (Chronarch design philosophy): one bottom-center stack for
 * transient feedback; every destructive action offers Undo.
 */

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastValue {
  toast: (message: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-2), { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), opts?.durationMs ?? 5000)
      );
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toasts-root" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
