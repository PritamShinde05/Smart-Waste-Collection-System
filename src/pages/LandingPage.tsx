import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, MapPin, Radio, Route } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PWAInstallButton } from '../components/PWAInstallButton';

export const LandingPage: React.FC = () => {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/employee/tasks'} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 py-4">
          <Link to="/" className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            VerdantRoute
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#workflow" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <Link to="/login" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Sign in
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton variant="compact" />
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-emerald-700">Smart Waste Collection Platform</p>
            <h1 className="mt-3 font-display text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              Collect full bins on demand, never empty ones on schedule.
            </h1>
            <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed">
              Ultrasonic bin telemetry, live area mapping, and road-following optimized collection routes for municipal teams and field staff.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Link
                to="/login"
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
              >
                <span>Login to Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/register"
                className="min-h-[48px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                Register as Admin
              </Link>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Field employees sign in using credentials issued by their area admin.
            </p>
          </div>

          <div id="workflow" className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <Radio className="w-5 h-5 text-emerald-600" />
              <h2 className="mt-4 font-display text-base font-semibold text-slate-900">Live Fill Telemetry</h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                ESP32 + HC-SR04 sensors measure bin fill depth at configurable intervals and flag Normal, Medium, Full, or Offline states.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <Route className="w-5 h-5 text-emerald-600" />
              <h2 className="mt-4 font-display text-base font-semibold text-slate-900">Road-Optimized Tasks</h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Select overflowing bins, assign an employee, and compute the shortest road-following collection tour via OpenStreetMap routing.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <MapPin className="w-5 h-5 text-emerald-600" />
              <h2 className="mt-4 font-display text-base font-semibold text-slate-900">Mobile Field Execution</h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Collectors accept tasks, follow turn-by-turn road stops with live GPS, and mark bins emptied with instant admin sync.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>VerdantRoute Smart Waste Collection</span>
          <span>Role-isolated area operations</span>
        </div>
      </footer>
    </div>
  );
};
