import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../services/api';

export type ConnectionState = 'LIVE' | 'RECONNECTING' | 'OFFLINE';

type EventHandler = (event: string, payload: any) => void;

interface RealtimeContextValue {
  connectionState: ConnectionState;
  unreadNotifications: number;
  refreshNotificationsCount: () => Promise<void>;
  subscribe: (handler: EventHandler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function playAlertFeedback() {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([160, 80, 160]);
    }
  } catch {
    // ignore
  }
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.11);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.33);
  } catch {
    // Autoplay blocked or unsupported
  }
}

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [connectionState, setConnectionState] = useState<ConnectionState>('OFFLINE');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const listenersRef = useRef<Set<EventHandler>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const hasConnectedOnceRef = useRef(false);

  const emit = useCallback((event: string, payload: any) => {
    for (const fn of listenersRef.current) {
      try {
        fn(event, payload);
      } catch {
        // ignore listener failure
      }
    }
  }, []);

  const userId = user?.id ?? null;
  const userRole = user?.role ?? null;

  const refreshNotificationsCount = useCallback(async () => {
    if (!userId) {
      setUnreadNotifications(0);
      return;
    }
    try {
      const res = await api.listNotifications();
      setUnreadNotifications(res.notifications.filter((n) => !n.read).length);
    } catch {
      // ignore
    }
  }, [userId]);

  useEffect(() => {
    refreshNotificationsCount();
  }, [refreshNotificationsCount]);

  useEffect(() => {
    if (!userId || !token) {
      setConnectionState('OFFLINE');
      hasConnectedOnceRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;
    let attempt = 0;

    const startPollingFallback = () => {
      if (pollingTimer !== null) return;
      pollingTimer = window.setInterval(() => {
        if (!navigator.onLine) {
          setConnectionState('OFFLINE');
          return;
        }
        emit('sync:poll', null);
        refreshNotificationsCount();
      }, 5000);
    };

    const stopPollingFallback = () => {
      if (pollingTimer !== null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      if (!navigator.onLine) {
        setConnectionState('OFFLINE');
        startPollingFallback();
        reconnectTimer = window.setTimeout(connect, 4000);
        return;
      }

      const customWsBase = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.replace(/\/$/, '');
      const wsUrl = customWsBase
        ? `${customWsBase.endsWith('/ws') ? customWsBase : `${customWsBase}/ws`}?token=${encodeURIComponent(token)}`
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

      setConnectionState('RECONNECTING');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        const wasReconnect = hasConnectedOnceRef.current;
        hasConnectedOnceRef.current = true;
        attempt = 0;
        setConnectionState('LIVE');
        stopPollingFallback();
        if (wasReconnect) {
          emit('sync:reconnect', null);
          refreshNotificationsCount();
        }
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          if (parsed?.event) {
            if (parsed.event === 'task:assigned' || parsed.event === 'notification:new') {
              refreshNotificationsCount();
              if (userRole === 'EMPLOYEE') {
                playAlertFeedback();
              }
            }
            emit(parsed.event, parsed.payload);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        setConnectionState(navigator.onLine ? 'RECONNECTING' : 'OFFLINE');
        startPollingFallback();
        const delay = Math.min(15000, 1500 * Math.pow(1.5, attempt));
        attempt++;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    const onOnline = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        connect();
      }
    };
    const onOffline = () => {
      setConnectionState('OFFLINE');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    connect();

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      stopPollingFallback();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [userId, userRole, token, emit, refreshNotificationsCount]);

  const subscribe = useCallback((handler: EventHandler) => {
    listenersRef.current.add(handler);
    return () => {
      listenersRef.current.delete(handler);
    };
  }, []);

  return (
    <RealtimeContext.Provider
      value={{
        connectionState,
        unreadNotifications,
        refreshNotificationsCount,
        subscribe,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
};

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}
