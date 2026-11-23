import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Wifi, WifiOff, RefreshCw, X } from 'lucide-react';
import type { SensorStatus, TaskStatus } from '../types';
import type { ConnectionState } from '../context/RealtimeContext';

// ==================== TOASTS ====================
interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = createContext<{ showToast: (message: string, type?: 'success' | 'error' | 'info') => void } | null>(
  null
);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-20 md:bottom-5 right-4 left-4 md:left-auto z-50 flex flex-col gap-2 pointer-events-none md:w-96">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg transition-all ${
              t.type === 'success'
                ? 'border-emerald-200 bg-white text-slate-900'
                : t.type === 'error'
                ? 'border-red-200 bg-white text-slate-900'
                : 'border-slate-200 bg-white text-slate-900'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-slate-400 hover:text-slate-700 p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ==================== STATUS LABELS (NO COLOR-ONLY, ZERO-PILL) ====================
export const SensorStatusText: React.FC<{ status: SensorStatus; fillPercent?: number | null }> = ({
  status,
  fillPercent,
}) => {
  const cfg: Record<SensorStatus, { label: string; dot: string; text: string }> = {
    NORMAL: { label: 'Normal', dot: 'bg-emerald-600', text: 'text-emerald-700' },
    MEDIUM: { label: 'Medium', dot: 'bg-amber-600', text: 'text-amber-700' },
    FULL: { label: 'Full', dot: 'bg-red-600', text: 'text-red-700' },
    OFFLINE: { label: 'Offline', dot: 'bg-slate-400', text: 'text-slate-600' },
  };
  const info = cfg[status] || cfg.OFFLINE;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums ${info.text}`}>
      <span className={`w-2 h-2 rounded-full ${info.dot}`} aria-hidden="true" />
      <span>{info.label}</span>
      {fillPercent !== null && fillPercent !== undefined && status !== 'OFFLINE' && (
        <>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="font-mono">{Math.round(fillPercent)}%</span>
        </>
      )}
    </span>
  );
};

export const TaskStatusText: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const cfg: Record<TaskStatus, { label: string; dot: string; text: string }> = {
    ASSIGNED: { label: 'Assigned', dot: 'bg-amber-600', text: 'text-amber-700' },
    ACCEPTED: { label: 'Accepted', dot: 'bg-sky-600', text: 'text-sky-700' },
    COMPLETED: { label: 'Completed', dot: 'bg-emerald-600', text: 'text-emerald-700' },
    CANCELLED: { label: 'Cancelled', dot: 'bg-slate-400', text: 'text-slate-500' },
  };
  const info = cfg[status] || cfg.ASSIGNED;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${info.text}`}>
      <span className={`w-2 h-2 rounded-full ${info.dot}`} aria-hidden="true" />
      <span>{info.label}</span>
    </span>
  );
};

// ==================== CONNECTION INDICATOR ====================
export const ConnectionIndicator: React.FC<{ state: ConnectionState }> = ({ state }) => {
  if (state === 'LIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <Wifi className="w-3.5 h-3.5" />
        <span>Live</span>
      </span>
    );
  }
  if (state === 'RECONNECTING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap shrink-0">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span>Reconnecting</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Offline</span>
    </span>
  );
};

// ==================== CONFIRM DIALOG ====================
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, description, confirmLabel, destructive = false, busy = false, onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== EMPTY & SKELETON STATES ====================
export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</div>
    <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
    <p className="mt-1.5 max-w-md text-sm text-slate-600">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const CardSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 animate-pulse">
    <div className="h-4 w-1/3 rounded bg-slate-200" />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-10 w-full rounded-lg bg-slate-100" />
    ))}
  </div>
);

// ==================== FORMATTING HELPERS ====================
export function formatDistance(meters: number): string {
  if (!meters || meters <= 0) return '0.0 km';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = mins / 60;
  return Number.isInteger(hrs) ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${hrs.toFixed(1)} hrs`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
