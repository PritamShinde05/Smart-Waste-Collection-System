import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Map as MapIcon,
  Radio,
  ClipboardList,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Plus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { ConnectionIndicator } from '../components/UI';
import { PWAInstallButton } from '../components/PWAInstallButton';

export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { connectionState } = useRealtime();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/map', label: 'Live Map', icon: MapIcon },
    { to: '/admin/sensors', label: 'Sensors', icon: Radio },
    { to: '/admin/tasks', label: 'Tasks', icon: ClipboardList },
    { to: '/admin/employees', label: 'Employees', icon: Users },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ];

  const mobileTabs = [
    { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/admin/map', label: 'Live Map', icon: MapIcon },
    { to: '/admin/tasks', label: 'Tasks', icon: ClipboardList },
    { to: '/admin/employees', label: 'Employees', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white z-30">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-display font-bold text-sm">
            VR
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            VerdantRoute
          </span>
        </div>

        <div className="px-4 py-4 border-b border-slate-100">
          <div className="text-xs font-medium text-slate-500">Managed Area</div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
            {user?.area?.name || 'Area'} · {user?.area?.city || ''}
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 space-y-3">
          <button
            type="button"
            onClick={() => navigate('/admin/tasks/new')}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Create Task
          </button>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">{user?.name}</div>
              <div className="text-xs text-slate-500 truncate">Admin</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        {/* Top Bar (52px on mobile, 64px on desktop) */}
        <header className="sticky top-0 z-20 flex h-13 lg:h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 backdrop-blur-sm px-4 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 inline-flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-display text-base lg:text-lg font-bold tracking-tight text-slate-900 truncate">
              {user?.area?.name || 'VerdantRoute'}
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <ConnectionIndicator state={connectionState} />
            <div className="hidden sm:block">
              <PWAInstallButton variant="compact" />
            </div>
            <button
              type="button"
              onClick={() => navigate('/admin/sensors/new')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Sensor
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 pb-20 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation (4 exact Admin tabs) */}
      <nav
        aria-label="Admin mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-4 h-15 items-center">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
                    isActive ? 'text-emerald-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="mt-0.5 whitespace-nowrap">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Mobile Drawer for Sensors / Settings / Logout */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-r border-slate-200 shadow-xl z-10">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <span className="font-display font-bold text-slate-900">VerdantRoute</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 text-xs text-slate-600">
              <div className="font-semibold text-slate-900">{user?.name}</div>
              <div className="mt-0.5">
                {user?.area?.name} · {user?.area?.city}
              </div>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium min-h-[48px] ${
                        isActive ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2">
              <PWAInstallButton variant="full" />
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
