import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckSquare, RefreshCw, Route as RouteIcon, Square, AlertTriangle } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { LiveBinsMap, RouteMap } from '../../components/MapComponents';
import {
  CardSkeleton,
  SensorStatusText,
  formatDistance,
  formatDuration,
  useToast,
} from '../../components/UI';
import type { Employee, RoutePreviewResult, Sensor } from '../../types';

export const AdminCreateTaskPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedBinIds, setSelectedBinIds] = useState<number[]>(() => {
    const raw = searchParams.get('bins');
    if (!raw) return [];
    return raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  });

  const [employeeId, setEmployeeId] = useState<number | ''>(() => {
    const raw = searchParams.get('employee');
    return raw ? Number(raw) : '';
  });
  const [startType, setStartType] = useState<'DEPOT' | 'EMPLOYEE_LAST_LOCATION'>('DEPOT');
  const [note, setNote] = useState('');

  const [preview, setPreview] = useState<RoutePreviewResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [senRes, empRes] = await Promise.all([api.listSensors(), api.listEmployees()]);
        setSensors(senRes.sensors.filter((s) => s.isActive));
        setEmployees(empRes.employees.filter((e) => e.status === 'ACTIVE'));
      } catch {
        showToast('Failed to load bins and employees.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  // Sort Full bins prominently at the top
  const sortedSensors = useMemo(() => {
    const rank = (s: Sensor) => (s.status === 'FULL' ? 0 : s.status === 'MEDIUM' ? 1 : s.status === 'NORMAL' ? 2 : 3);
    return [...sensors].sort((a, b) => rank(a) - rank(b) || (b.lastFillPercent ?? 0) - (a.lastFillPercent ?? 0));
  }, [sensors]);

  const fullBins = useMemo(() => sortedSensors.filter((s) => s.status === 'FULL'), [sortedSensors]);
  const selectedEmployee = useMemo(() => employees.find((e) => e.id === employeeId) || null, [employees, employeeId]);
  const employeeHasGps = Boolean(selectedEmployee && selectedEmployee.lastLat !== null && selectedEmployee.lastLng !== null);

  useEffect(() => {
    if (startType === 'EMPLOYEE_LAST_LOCATION' && !employeeHasGps) {
      setStartType('DEPOT');
    }
  }, [employeeHasGps, startType]);

  const toggleBin = (id: number) => {
    setPreview(null);
    setRouteError(null);
    setSelectedBinIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllFull = () => {
    setPreview(null);
    setRouteError(null);
    const ids = fullBins.map((b) => b.id);
    setSelectedBinIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const handleGenerateRoute = async () => {
    if (selectedBinIds.length === 0) {
      showToast('Select at least one bin first.', 'error');
      return;
    }
    setOptimizing(true);
    setRouteError(null);
    try {
      const res = await api.previewRoute({
        startType,
        employeeId: employeeId ? Number(employeeId) : undefined,
        sensorIds: selectedBinIds,
      });
      setPreview(res);
    } catch (err: any) {
      setPreview(null);
      setRouteError(err.message || 'Road routing service unavailable. Please retry.');
    } finally {
      setOptimizing(false);
    }
  };

  const handleConfirmAssign = async () => {
    if (selectedBinIds.length === 0) {
      showToast('Select at least one bin.', 'error');
      return;
    }
    if (!employeeId) {
      showToast('Select an employee to assign.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.createTask({
        employeeId: Number(employeeId),
        sensorIds: selectedBinIds,
        startType,
        note: note.trim() || undefined,
      });
      showToast(`Task #${res.task.id} assigned with optimized road route.`, 'success');
      navigate(`/admin/tasks/${res.task.id}`, { replace: true });
    } catch (err: any) {
      setRouteError(err.message || 'Could not create task.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <CardSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">
      <Link to="/admin/tasks" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" />
        Back to Tasks
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Create Collection Task</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Select bins, pick an employee and starting point, and generate the shortest road-following tour.
        </p>
      </div>

      {/* Step 1: Select Bins (List + Map side-by-side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">1. Select Bins ({selectedBinIds.length} selected)</h2>
              <p className="text-xs text-slate-500">Full bins appear first for priority pickup.</p>
            </div>
            {fullBins.length > 0 && (
              <button
                type="button"
                onClick={selectAllFull}
                className="min-h-[38px] rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Select All Full ({fullBins.length})
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {sortedSensors.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">No active bins available.</div>
            ) : (
              sortedSensors.map((s) => {
                const checked = selectedBinIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleBin(s.id)}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors min-h-[52px] ${
                      checked ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {checked ? (
                        <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-slate-900">{s.binId}</div>
                        <div className="text-sm text-slate-700 truncate">{s.label}</div>
                      </div>
                    </div>
                    <SensorStatusText status={s.status} fillPercent={s.lastFillPercent} />
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">Bin Locations (tap marker to toggle)</h2>
          <LiveBinsMap
            sensors={sortedSensors}
            centerLat={user?.area?.centreLat ?? 18.5204}
            centerLng={user?.area?.centreLng ?? 73.8567}
            selectedSensorId={selectedBinIds[selectedBinIds.length - 1] ?? null}
            onSelectSensor={(s) => toggleBin(s.id)}
            heightClass="h-80"
          />
        </section>
      </div>

      {/* Step 2 & 3: Employee & Start Point */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">2. Select Employee</h2>
          {employees.length === 0 ? (
            <p className="text-sm text-slate-600">
              No active employees found.{' '}
              <Link to="/admin/employees/new" className="font-semibold text-emerald-700 underline">
                Add an employee
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => {
                    setEmployeeId(emp.id);
                    setPreview(null);
                  }}
                  className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors min-h-[52px] ${
                    employeeId === emp.id
                      ? 'border-emerald-600 bg-emerald-50/70'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{emp.name}</div>
                    <div className="text-xs text-slate-500">{emp.mobile}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-mono font-semibold text-slate-900">{emp.openTasks} open</div>
                    <div className="text-slate-500">{emp.completedTasks} done</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900">3. Starting Point &amp; Task Note</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setStartType('DEPOT');
                setPreview(null);
              }}
              className={`min-h-[48px] rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold ${
                startType === 'DEPOT'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div>Area Depot</div>
              <div className="font-normal text-slate-500 mt-0.5">Area centre coordinates</div>
            </button>

            <button
              type="button"
              disabled={!employeeHasGps}
              onClick={() => {
                setStartType('EMPLOYEE_LAST_LOCATION');
                setPreview(null);
              }}
              className={`min-h-[48px] rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold disabled:opacity-50 ${
                startType === 'EMPLOYEE_LAST_LOCATION'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div>Employee Last GPS</div>
              <div className="font-normal text-slate-500 mt-0.5">
                {employeeHasGps ? 'Recent GPS available' : 'No recent GPS recorded'}
              </div>
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="task-note">
              Optional instruction note for employee
            </label>
            <textarea
              id="task-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Gate near market closes at 11 AM."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={optimizing || selectedBinIds.length === 0}
            onClick={handleGenerateRoute}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <RouteIcon className="w-4 h-4" />
            {optimizing ? 'Calculating Road Route via OSRM...' : 'Generate Optimized Road Route'}
          </button>
        </section>
      </div>

      {/* Route Error with Retry */}
      {routeError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-900">Road routing failed</h3>
              <p className="text-sm text-red-700">{routeError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerateRoute}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry Routing
          </button>
        </div>
      )}

      {/* Step 4 & 5: Optimized Route Preview & Confirm */}
      {preview && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">Optimized Road Route Preview</h2>
              <p className="text-sm text-slate-600 tabular-nums">
                {preview.orderedStops.length} stop(s) · Total distance:{' '}
                <strong className="font-mono text-slate-900">{formatDistance(preview.totalDistanceMeters)}</strong> · Est.
                duration: <strong className="font-mono text-slate-900">{formatDuration(preview.estimatedTimeSeconds)}</strong>
              </p>
            </div>

            <button
              type="button"
              disabled={submitting || !employeeId}
              onClick={handleConfirmAssign}
              className="min-h-[48px] rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? 'Assigning Task...' : 'Confirm & Assign Task'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <RouteMap
                startLat={preview.startPoint.latitude}
                startLng={preview.startPoint.longitude}
                startLabel={preview.startPoint.label}
                stops={preview.orderedStops.map((st) => ({
                  sensorId: st.sensorId,
                  stopOrder: st.stopOrder,
                  binId: st.binId,
                  label: st.label,
                  latitude: st.latitude,
                  longitude: st.longitude,
                }))}
                routeGeometry={preview.routeGeometry}
                heightClass="h-80"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500">Ordered Collection Stops</div>
              <ol className="space-y-2 max-h-72 overflow-y-auto">
                {preview.orderedStops.map((st) => (
                  <li
                    key={st.sensorId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 font-mono text-xs font-bold text-white shrink-0">
                        {st.stopOrder}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-slate-900">{st.binId}</div>
                        <div className="text-xs text-slate-600 truncate">{st.label}</div>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-700 shrink-0">
                      {st.fillPercent !== null ? `${Math.round(st.fillPercent)}%` : '—'}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
