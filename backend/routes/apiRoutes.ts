import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.ts';
import { registerAdmin, login, logout, getMe, changePassword } from '../controllers/authController.ts';
import { getArea, updateArea, getAdminBackups, triggerAdminBackup } from '../controllers/areaController.ts';
import {
  listSensors,
  createSensor,
  getSensorDetail,
  updateSensor,
  regenerateSensorKey,
  deleteSensor,
} from '../controllers/sensorController.ts';
import { submitDeviceReading, simulateSensorReading } from '../controllers/deviceController.ts';
import {
  getDashboardSummary,
  getFillTrends,
  getCollectionsStats,
  getEmployeeStats,
} from '../controllers/dashboardController.ts';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  resetEmployeePassword,
  getEmployeeHistory,
} from '../controllers/employeeController.ts';
import {
  previewRoute,
  createTask,
  listTasks,
  getTaskDetail,
  cancelTask,
  reoptimizeTask,
  listMyTasks,
  getMyTaskDetail,
  acceptTask,
  markBinCollected,
  completeTask,
  updateMyLocation,
} from '../controllers/taskController.ts';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../controllers/notificationController.ts';

export const apiRouter = Router();

// Health
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth
apiRouter.post('/auth/register-admin', registerAdmin);
apiRouter.post('/auth/login', login);
apiRouter.post('/auth/logout', logout);
apiRouter.get('/auth/me', requireAuth, getMe);
apiRouter.post('/auth/change-password', requireAuth, changePassword);

// Area & Backups
apiRouter.get('/area', requireAuth, getArea);
apiRouter.put('/area', requireAuth, requireRole('ADMIN'), updateArea);
apiRouter.get('/admin/backups', requireAuth, requireRole('ADMIN'), getAdminBackups);
apiRouter.post('/admin/backups', requireAuth, requireRole('ADMIN'), triggerAdminBackup);

// Sensors (Admin)
apiRouter.get('/sensors', requireAuth, requireRole('ADMIN'), listSensors);
apiRouter.post('/sensors', requireAuth, requireRole('ADMIN'), createSensor);
apiRouter.get('/sensors/:id', requireAuth, requireRole('ADMIN'), getSensorDetail);
apiRouter.put('/sensors/:id', requireAuth, requireRole('ADMIN'), updateSensor);
apiRouter.post('/sensors/:id/regenerate-key', requireAuth, requireRole('ADMIN'), regenerateSensorKey);
apiRouter.delete('/sensors/:id', requireAuth, requireRole('ADMIN'), deleteSensor);
apiRouter.post('/sensors/:id/simulate-reading', requireAuth, requireRole('ADMIN'), simulateSensorReading);

// Device Telemetry (ESP32)
apiRouter.post('/device/reading', submitDeviceReading);

// Dashboard (Admin)
apiRouter.get('/dashboard/summary', requireAuth, requireRole('ADMIN'), getDashboardSummary);
apiRouter.get('/dashboard/fill-trends', requireAuth, requireRole('ADMIN'), getFillTrends);
apiRouter.get('/dashboard/collections', requireAuth, requireRole('ADMIN'), getCollectionsStats);
apiRouter.get('/dashboard/employee-stats', requireAuth, requireRole('ADMIN'), getEmployeeStats);

// Employees (Admin)
apiRouter.get('/employees', requireAuth, requireRole('ADMIN'), listEmployees);
apiRouter.post('/employees', requireAuth, requireRole('ADMIN'), createEmployee);
apiRouter.put('/employees/:id', requireAuth, requireRole('ADMIN'), updateEmployee);
apiRouter.patch('/employees/:id/status', requireAuth, requireRole('ADMIN'), updateEmployeeStatus);
apiRouter.patch('/employees/:id/reset-password', requireAuth, requireRole('ADMIN'), resetEmployeePassword);
apiRouter.get('/employees/:id/history', requireAuth, requireRole('ADMIN'), getEmployeeHistory);

// Routes & Tasks (Admin)
apiRouter.post('/routes/preview', requireAuth, requireRole('ADMIN'), previewRoute);
apiRouter.post('/tasks', requireAuth, requireRole('ADMIN'), createTask);
apiRouter.get('/tasks', requireAuth, requireRole('ADMIN'), listTasks);
apiRouter.get('/tasks/:id', requireAuth, requireRole('ADMIN'), getTaskDetail);
apiRouter.patch('/tasks/:id/cancel', requireAuth, requireRole('ADMIN'), cancelTask);
apiRouter.post('/tasks/:id/reoptimize', requireAuth, requireRole('ADMIN'), reoptimizeTask);

// Employee Tasks & GPS
apiRouter.get('/employee/tasks', requireAuth, requireRole('EMPLOYEE'), listMyTasks);
apiRouter.get('/employee/tasks/:id', requireAuth, requireRole('EMPLOYEE'), getMyTaskDetail);
apiRouter.patch('/employee/tasks/:id/accept', requireAuth, requireRole('EMPLOYEE'), acceptTask);
apiRouter.patch('/employee/tasks/:id/bins/:taskBinId/collect', requireAuth, requireRole('EMPLOYEE'), markBinCollected);
apiRouter.patch('/employee/tasks/:id/complete', requireAuth, requireRole('EMPLOYEE'), completeTask);
apiRouter.patch('/employee/location', requireAuth, requireRole('EMPLOYEE'), updateMyLocation);

// Notifications
apiRouter.get('/notifications', requireAuth, listNotifications);
apiRouter.patch('/notifications/read-all', requireAuth, markAllNotificationsRead);
apiRouter.patch('/notifications/:id/read', requireAuth, markNotificationRead);
