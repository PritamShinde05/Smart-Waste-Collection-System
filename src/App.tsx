import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RealtimeProvider } from './context/RealtimeContext';
import { ToastProvider } from './components/UI';

import { LandingPage } from './pages/LandingPage';
import { AdminRegisterPage } from './pages/AdminRegisterPage';
import { LoginPage } from './pages/LoginPage';

import { AdminLayout } from './layouts/AdminLayout';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminLiveMapPage } from './pages/admin/AdminLiveMapPage';
import { AdminSensorsPage } from './pages/admin/AdminSensorsPage';
import { AdminAddSensorPage } from './pages/admin/AdminAddSensorPage';
import { AdminBinDetailPage } from './pages/admin/AdminBinDetailPage';
import { AdminTasksPage } from './pages/admin/AdminTasksPage';
import { AdminCreateTaskPage } from './pages/admin/AdminCreateTaskPage';
import { AdminTaskDetailPage } from './pages/admin/AdminTaskDetailPage';
import { AdminEmployeesPage } from './pages/admin/AdminEmployeesPage';
import { AdminEmployeeFormPage } from './pages/admin/AdminEmployeeFormPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';

import { EmployeeLayout } from './layouts/EmployeeLayout';
import { EmployeeTasksPage } from './pages/employee/EmployeeTasksPage';
import { EmployeeTaskDetailPage } from './pages/employee/EmployeeTaskDetailPage';
import { EmployeeRoutePage } from './pages/employee/EmployeeRoutePage';
import { EmployeeCompleteTaskPage } from './pages/employee/EmployeeCompleteTaskPage';
import { EmployeeProfilePage } from './pages/employee/EmployeeProfilePage';

const ProtectedRoute: React.FC<{ role: 'ADMIN' | 'EMPLOYEE'; children: React.ReactNode }> = ({ role, children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Loading workspace...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role !== role) {
    return <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/employee/tasks'} replace />;
  }
  return <>{children}</>;
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RealtimeProvider>
          <BrowserRouter>
            <Routes>
              {/* Shared Public Screens (C1 - C3) */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/register" element={<AdminRegisterPage />} />
              <Route path="/login" element={<LoginPage />} />

              {/* Admin Screens (A1 - A11) */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute role="ADMIN">
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="map" element={<AdminLiveMapPage />} />
                <Route path="sensors" element={<AdminSensorsPage />} />
                <Route path="sensors/new" element={<AdminAddSensorPage />} />
                <Route path="sensors/:id" element={<AdminBinDetailPage />} />
                <Route path="tasks" element={<AdminTasksPage />} />
                <Route path="tasks/new" element={<AdminCreateTaskPage />} />
                <Route path="tasks/:id" element={<AdminTaskDetailPage />} />
                <Route path="employees" element={<AdminEmployeesPage />} />
                <Route path="employees/new" element={<AdminEmployeeFormPage />} />
                <Route path="employees/:id/edit" element={<AdminEmployeeFormPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
              </Route>

              {/* Employee Screens (E1 - E5) */}
              <Route
                path="/employee"
                element={
                  <ProtectedRoute role="EMPLOYEE">
                    <EmployeeLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/employee/tasks" replace />} />
                <Route path="tasks" element={<EmployeeTasksPage />} />
                <Route path="tasks/:id" element={<EmployeeTaskDetailPage />} />
                <Route path="tasks/:id/route" element={<EmployeeRoutePage />} />
                <Route path="tasks/:id/complete" element={<EmployeeCompleteTaskPage />} />
                <Route path="route" element={<EmployeeRoutePage />} />
                <Route path="profile" element={<EmployeeProfilePage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </RealtimeProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
