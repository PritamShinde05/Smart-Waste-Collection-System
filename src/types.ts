export type Role = 'ADMIN' | 'EMPLOYEE';
export type SensorStatus = 'NORMAL' | 'MEDIUM' | 'FULL' | 'OFFLINE';
export type TaskStatus = 'ASSIGNED' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED';

export interface Area {
  id: number;
  name: string;
  city: string;
  centreLat: number;
  centreLng: number;
  defaultIntervalSeconds: number;
  mediumThreshold: number;
  fullThreshold: number;
}

export interface User {
  id: number;
  areaId: number;
  name: string;
  email: string;
  mobile: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
  area: Area | null;
}

export interface Sensor {
  id: number;
  areaId: number;
  binId: string;
  label: string;
  latitude: number;
  longitude: number;
  binHeightCm: number;
  intervalSeconds: number;
  fullThreshold: number;
  status: SensorStatus;
  isActive: boolean;
  lastFillPercent: number | null;
  lastDistanceCm: number | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface SensorReading {
  id: number;
  distanceCm: number;
  fillPercent: number;
  recordedAt: string;
}

export interface CollectionRecord {
  taskBinId: number;
  taskId: number;
  collectedAt: string;
  fillAtAssignment: number | null;
  taskStatus: TaskStatus;
  employeeId: number;
  employeeName: string;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  mobile: string;
  status: 'ACTIVE' | 'INACTIVE';
  openTasks: number;
  completedTasks: number;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
  createdAt: string;
}

export interface TaskStop {
  taskBinId: number;
  sensorId: number;
  stopOrder: number;
  binId: string;
  label: string;
  latitude: number;
  longitude: number;
  fillAtAssignment: number | null;
  currentFillPercent: number | null;
  sensorStatus: SensorStatus;
  collectedAt: string | null;
}

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface TaskSummary {
  id: number;
  status: TaskStatus;
  totalDistanceMeters: number;
  estimatedTimeSeconds: number;
  note: string | null;
  completionNote?: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  binCount: number;
  collectedCount: number;
  assignedTo?: {
    id: number;
    name: string;
    mobile: string;
  };
}

export interface TaskDetail {
  id: number;
  areaId: number;
  status: TaskStatus;
  startType: string;
  returnToDepot?: boolean;
  startLat: number;
  startLng: number;
  routeGeometry: RouteGeometry | null;
  totalDistanceMeters: number;
  estimatedTimeSeconds: number;
  note: string | null;
  completionNote: string | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdBy: { id: number; name: string };
  assignedTo: { id: number; name: string; mobile: string; email: string };
  stops: TaskStop[];
}

export interface RoutePreviewResult {
  startType: string;
  returnToDepot?: boolean;
  startPoint: { label: string; latitude: number; longitude: number };
  orderedStops: Array<{
    sensorId: number;
    binId: string;
    label: string;
    latitude: number;
    longitude: number;
    fillPercent: number | null;
    stopOrder: number;
  }>;
  routeGeometry: RouteGeometry;
  totalDistanceMeters: number;
  estimatedTimeSeconds: number;
}

export interface NotificationItem {
  id: number;
  type: string;
  message: string;
  relatedTaskId: number | null;
  read: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  cards: {
    totalBins: number;
    fullBins: number;
    mediumBins: number;
    normalBins: number;
    offlineSensors: number;
    pendingTasks: number;
    inProgressTasks: number;
    completedToday: number;
    completedTasks: number;
    cancelledTasks: number;
    employeeCount: number;
  };
  binStatusSplit: Array<{ name: string; value: number; color: string }>;
  taskStatusSplit: Array<{ name: string; value: number; color: string }>;
  binsByFill: Array<{
    id: number;
    binId: string;
    label: string;
    fillPercent: number;
    hasReading: boolean;
    status: SensorStatus;
  }>;
}
