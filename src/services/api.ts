import type {
  Area,
  CollectionRecord,
  DashboardSummary,
  Employee,
  NotificationItem,
  RoutePreviewResult,
  Sensor,
  SensorReading,
  TaskDetail,
  TaskSummary,
  User,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

let memoryToken: string | null = null;

export function setMemoryToken(token: string | null) {
  memoryToken = token;
}

export function getMemoryToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  retryable?: boolean;
  flagged?: boolean;

  constructor(message: string, status: number, extra?: { retryable?: boolean; flagged?: boolean }) {
    super(message);
    this.status = status;
    this.retryable = extra?.retryable;
    this.flagged = extra?.flagged;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed with status ${res.status}`,
      res.status,
      { retryable: data?.retryable, flagged: data?.flagged }
    );
  }
  return data as T;
}

export const api = {
  // Auth
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
  }) => request<{ token: string; user: User }>('/api/auth/register-admin', { method: 'POST', body: JSON.stringify(payload) }),

  login: (payload: { identifier: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ token: string; user: User }>('/api/auth/me'),

  changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<{ success: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Area
  getArea: () => request<Area>('/api/area'),
  updateArea: (payload: Partial<Area>) =>
    request<Area>('/api/area', { method: 'PUT', body: JSON.stringify(payload) }),

  // Sensors
  listSensors: (params?: { search?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.status && params.status !== 'ALL') q.set('status', params.status);
    const qs = q.toString();
    return request<{ sensors: Sensor[] }>(`/api/sensors${qs ? `?${qs}` : ''}`);
  },

  createSensor: (payload: {
    binId: string;
    label: string;
    latitude: number;
    longitude: number;
    binHeightCm: number;
    intervalSeconds: number;
    fullThreshold: number;
  }) =>
    request<{ sensor: Sensor; deviceKey: string; readingEndpoint: string }>('/api/sensors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSensorDetail: (id: number, range: 'day' | 'week' | 'month' = 'day') =>
    request<{ sensor: Sensor; readings: SensorReading[]; collections: CollectionRecord[] }>(
      `/api/sensors/${id}?range=${range}`
    ),

  updateSensor: (
    id: number,
    payload: Partial<{
      binId: string;
      label: string;
      latitude: number;
      longitude: number;
      binHeightCm: number;
      intervalSeconds: number;
      fullThreshold: number;
      isActive: boolean;
    }>
  ) => request<{ sensor: Sensor }>(`/api/sensors/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  regenerateSensorKey: (id: number) =>
    request<{ deviceKey: string }>(`/api/sensors/${id}/regenerate-key`, { method: 'POST' }),

  deleteSensor: (id: number) => request<{ success: boolean }>(`/api/sensors/${id}`, { method: 'DELETE' }),

  simulateSensorReading: (id: number, distanceCm: number) =>
    request<{ success: boolean; sensor: Sensor; fillPercentage: number; status: string; readingIntervalSeconds: number }>(
      `/api/sensors/${id}/simulate-reading`,
      { method: 'POST', body: JSON.stringify({ distanceCm }) }
    ),

  submitDeviceReading: (payload: { binId: string; deviceKey: string; distanceCm: number; timestamp?: string }) =>
    request<{ success: boolean; binId: string; fillPercentage: number; status: string; readingIntervalSeconds: number }>(
      '/api/device/reading',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  // Dashboard
  getDashboardSummary: (params?: { employeeId?: number; sensorId?: number }) => {
    const q = new URLSearchParams();
    if (params?.employeeId) q.set('employeeId', String(params.employeeId));
    if (params?.sensorId) q.set('sensorId', String(params.sensorId));
    const qs = q.toString();
    return request<DashboardSummary>(`/api/dashboard/summary${qs ? `?${qs}` : ''}`);
  },

  getFillTrends: (params?: { sensorId?: number; days?: number }) => {
    const q = new URLSearchParams();
    if (params?.sensorId) q.set('sensorId', String(params.sensorId));
    if (params?.days) q.set('days', String(params.days));
    const qs = q.toString();
    return request<{
      sensor: { id: number; binId: string; label: string } | null;
      points: Array<{ fillPercent: number; distanceCm: number; recordedAt: string }>;
    }>(`/api/dashboard/fill-trends${qs ? `?${qs}` : ''}`);
  },

  getCollectionsStats: (params?: { days?: number; employeeId?: number; sensorId?: number }) => {
    const q = new URLSearchParams();
    if (params?.days) q.set('days', String(params.days));
    if (params?.employeeId) q.set('employeeId', String(params.employeeId));
    if (params?.sensorId) q.set('sensorId', String(params.sensorId));
    const qs = q.toString();
    return request<{ collections: Array<{ day: string; count: number }> }>(
      `/api/dashboard/collections${qs ? `?${qs}` : ''}`
    );
  },

  getEmployeeStats: (params?: { days?: number; employeeId?: number }) => {
    const q = new URLSearchParams();
    if (params?.days) q.set('days', String(params.days));
    if (params?.employeeId) q.set('employeeId', String(params.employeeId));
    const qs = q.toString();
    return request<{
      employees: Array<{ employeeId: number; name: string; completedCount: number; openCount: number }>;
    }>(`/api/dashboard/employee-stats${qs ? `?${qs}` : ''}`);
  },

  // Employees
  listEmployees: () => request<{ employees: Employee[] }>('/api/employees'),

  createEmployee: (payload: {
    name: string;
    email: string;
    mobile: string;
    password: string;
    status: 'ACTIVE' | 'INACTIVE';
  }) => request<{ employee: Employee }>('/api/employees', { method: 'POST', body: JSON.stringify(payload) }),

  updateEmployee: (
    id: number,
    payload: { name: string; email: string; mobile: string; status: 'ACTIVE' | 'INACTIVE' }
  ) => request<{ employee: Employee }>(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  updateEmployeeStatus: (id: number, status: 'ACTIVE' | 'INACTIVE') =>
    request<{ success: boolean; status: string }>(`/api/employees/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  resetEmployeePassword: (id: number, newPassword: string) =>
    request<{ success: boolean }>(`/api/employees/${id}/reset-password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    }),

  getEmployeeHistory: (id: number) =>
    request<{ employee: Employee; tasks: TaskSummary[] }>(`/api/employees/${id}/history`),

  // Tasks & Routing (Admin)
  previewRoute: (payload: { startType: string; employeeId?: number; sensorIds: number[]; returnToDepot?: boolean }) =>
    request<RoutePreviewResult>('/api/routes/preview', { method: 'POST', body: JSON.stringify(payload) }),

  createTask: (payload: { employeeId: number; sensorIds: number[]; startType: string; note?: string; returnToDepot?: boolean }) =>
    request<{ task: TaskDetail }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),

  listTasks: (params?: { status?: string; employeeId?: number }) => {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') q.set('status', params.status);
    if (params?.employeeId) q.set('employeeId', String(params.employeeId));
    const qs = q.toString();
    return request<{ tasks: TaskSummary[] }>(`/api/tasks${qs ? `?${qs}` : ''}`);
  },

  getTaskDetail: (id: number) => request<{ task: TaskDetail }>(`/api/tasks/${id}`),

  cancelTask: (id: number) => request<{ task: TaskDetail }>(`/api/tasks/${id}/cancel`, { method: 'PATCH' }),

  reoptimizeTask: (id: number, payload?: { sensorIds?: number[]; startType?: string; returnToDepot?: boolean }) =>
    request<{ task: TaskDetail }>(`/api/tasks/${id}/reoptimize`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  // Employee Tasks
  listMyTasks: (status?: string) => {
    const q = new URLSearchParams();
    if (status && status !== 'ALL') q.set('status', status);
    const qs = q.toString();
    return request<{ tasks: TaskSummary[] }>(`/api/employee/tasks${qs ? `?${qs}` : ''}`);
  },

  getMyTaskDetail: (id: number) => request<{ task: TaskDetail }>(`/api/employee/tasks/${id}`),

  acceptTask: (id: number) => request<{ task: TaskDetail }>(`/api/employee/tasks/${id}/accept`, { method: 'PATCH' }),

  markBinCollected: (taskId: number, taskBinId: number) =>
    request<{ task: TaskDetail }>(`/api/employee/tasks/${taskId}/bins/${taskBinId}/collect`, { method: 'PATCH' }),

  completeTask: (id: number, completionNote?: string) =>
    request<{ task: TaskDetail }>(`/api/employee/tasks/${id}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ completionNote }),
    }),

  updateMyLocation: (latitude: number, longitude: number) =>
    request<{ success: boolean }>('/api/employee/location', {
      method: 'PATCH',
      body: JSON.stringify({ latitude, longitude }),
    }),

  // Notifications
  listNotifications: () => request<{ notifications: NotificationItem[] }>('/api/notifications'),
  markNotificationRead: (id: number) => request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<{ success: boolean }>('/api/notifications/read-all', { method: 'PATCH' }),
};
