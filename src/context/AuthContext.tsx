import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setMemoryToken } from '../services/api';
import type { Area, User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  registerAdmin: (payload: {
    name: string;
    email: string;
    mobile: string;
    password: string;
    confirmPassword: string;
    areaName: string;
    city: string;
    centreLat?: number;
    centreLng?: number;
  }) => Promise<User>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  updateAreaInContext: (area: Area) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((nextToken: string | null, nextUser: User | null) => {
    setMemoryToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await api.me();
      applySession(res.token, res.user);
    } catch {
      applySession(null, null);
    }
  }, [applySession]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.me();
        if (active) applySession(res.token, res.user);
      } catch {
        if (active) applySession(null, null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applySession]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login({ identifier, password });
      applySession(res.token, res.user);
      return res.user;
    },
    [applySession]
  );

  const registerAdmin = useCallback(
    async (payload: {
      name: string;
      email: string;
      mobile: string;
      password: string;
      confirmPassword: string;
      areaName: string;
      city: string;
      centreLat?: number;
      centreLng?: number;
    }) => {
      const res = await api.registerAdmin(payload);
      applySession(res.token, res.user);
      return res.user;
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    applySession(null, null);
  }, [applySession]);

  const updateAreaInContext = useCallback((area: Area) => {
    setUser((prev) => (prev ? { ...prev, area } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        registerAdmin,
        logout,
        refreshMe,
        updateAreaInContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
