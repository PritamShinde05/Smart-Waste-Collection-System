import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ClipboardList, Navigation, User as UserIcon, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { ConnectionIndicator } from '../components/UI';
import { PWAInstallButton } from '../components/PWAInstallButton';

export const EmployeeLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { connectionState, unreadNotifications } = useRealtime();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const tabs = [
    { to: '/employee/tasks', label: 'My Tasks', icon: ClipboardList, badge: unreadNotifications },
    { to: '/employee/route', label: 'Route', icon: Navigation, badge: 0 },
    { to: '/employee/profile', label: 'Profile', icon: UserIcon, badge: 0 },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop / Tablet Sidebar */}
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
          <div className="text-xs font-medium text-slate-500">Assigned Area</div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
            {user?.area?.name || 'Area'} · {user?.area?.city || ''}
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors min-h-[48px] ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </span>
                {tab.badge > 0 && (
                  <span className="font-mono text-xs font-semibold text-emerald-700">{tab.badge}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">{user?.name}</div>
            <div className="text-xs text-slate-500 truncate">Field Collector</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Logout"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 flex h-13 lg:h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 backdrop-blur-sm px-4 lg:px-8">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="lg:hidden flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-display font-bold text-xs shrink-0">
              VR
            </div>
            <span className="font-display text-base lg:text-lg font-bold tracking-tight text-slate-900 truncate">
              {user?.area?.name || 'Field Operations'}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ConnectionIndicator state={connectionState} />
            <div className="hidden sm:block">
              <PWAInstallButton variant="compact" />
            </div>
          </div>
        </header>

        <main className="flex-1 pb-20 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Employee Mobile Bottom Navigation (3 exact tabs: My Tasks, Route, Profile) */}
      <nav
        aria-label="Employee mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-3 h-15 items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center h-full text-[11px] font-medium transition-colors ${
                    isActive ? 'text-emerald-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                  }`
                }
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold text-white">
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className="mt-0.5 whitespace-nowrap">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
