import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, Plus, Power, Radio, Search, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import {
  CardSkeleton,
  ConfirmDialog,
  EmptyState,
  SensorStatusText,
  formatInterval,
  formatRelativeTime,
  useToast,
} from '../../components/UI';
import type { Sensor } from '../../types';

export const AdminSensorsPage: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'ALL');
  const [deleteTarget, setDeleteTarget] = useState<Sensor | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const param = searchParams.get('status') || 'ALL';
    setStatusFilter(param);
  }, [searchParams]);

  const loadSensors = useCallback(async () => {
    try {
      const res = await api.listSensors();
      setSensors(res.sensors);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSensors();
  }, [loadSensors]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.startsWith('sensor:') || event === 'area:updated' || event === 'sync:reconnect' || event === 'sync:poll') {
        loadSensors();
      }
    });
  }, [subscribe, loadSensors]);

  const filtered = useMemo(() => {
    return sensors.filter((s) => {
      if (statusFilter === 'ONLINE' && (!s.isActive || s.status === 'OFFLINE')) return false;
      else if (statusFilter === 'INACTIVE' && s.isActive) return false;
      else if (!['ALL', 'ONLINE', 'INACTIVE'].includes(statusFilter) && s.status !== statusFilter) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!s.binId.toLowerCase().includes(q) && !s.label.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sensors, statusFilter, search]);

  const handleToggleActive = async (sensor: Sensor) => {
    try {
      const res = await api.updateSensor(sensor.id, { isActive: !sensor.isActive });
      setSensors((prev) => prev.map((s) => (s.id === sensor.id ? res.sensor : s)));
      showToast(res.sensor.isActive ? `${sensor.binId} activated.` : `${sensor.binId} deactivated.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not update sensor status.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteSensor(deleteTarget.id);
      setSensors((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      showToast(`${deleteTarget.binId} deleted.`, 'success');
      setDeleteTarget(null);
    } catch (err: any) {
      showToast(err.message || 'Delete failed.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Sensors &amp; Bins</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Manage ultrasonic bin sensors, reading intervals, and map coordinates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin/sensors/new')}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Sensor
        </button>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Bin ID or location label..."
            className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto">
          {['ALL', 'FULL', 'MEDIUM', 'NORMAL', 'OFFLINE', 'INACTIVE'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(st);
                setSearchParams(st === 'ALL' ? {} : { status: st });
              }}
              className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <CardSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Radio className="w-5 h-5" />}
          title="No matching sensors"
          description="Add a new bin sensor or adjust your search filter."
          action={
            <button
              type="button"
              onClick={() => navigate('/admin/sensors/new')}
              className="min-h-[44px] rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Add Sensor
            </button>
          }
        />
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="py-3.5 px-4">Bin ID</th>
                  <th className="py-3.5 px-4">Location Label</th>
                  <th className="py-3.5 px-4">Status &amp; Fill</th>
                  <th className="py-3.5 px-4">Last Reading</th>
                  <th className="py-3.5 px-4">Interval</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/sensors/${s.id}`)}
                        className="hover:text-emerald-700 hover:underline text-left"
                      >
                        {s.binId}
                      </button>
                      {!s.isActive && <span className="ml-2 text-xs font-sans text-slate-400">Inactive</span>}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">{s.label}</td>
                    <td className="py-3.5 px-4">
                      <SensorStatusText status={s.status} fillPercent={s.lastFillPercent} />
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 tabular-nums">{formatRelativeTime(s.lastSeenAt)}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {formatInterval(s.intervalSeconds)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/map?focus=${s.id}`)}
                          className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Show on map
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/sensors/${s.id}`)}
                          className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(s)}
                          title={s.isActive ? 'Deactivate sensor' : 'Activate sensor'}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(s)}
                          title="Delete sensor"
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((s) => (
              <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-900">{s.binId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatInterval(s.intervalSeconds)}</span>
                      {!s.isActive && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Inactive</span>
                        </>
                      )}
                    </div>
                    <h2 className="mt-1 font-semibold text-slate-900">{s.label}</h2>
                  </div>
                  <SensorStatusText status={s.status} fillPercent={s.lastFillPercent} />
                </div>

                <div className="text-xs text-slate-500">
                  Last reading: {formatRelativeTime(s.lastSeenAt)}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/sensors/${s.id}`)}
                    className="min-h-[44px] rounded-xl bg-emerald-600 text-xs font-semibold text-white"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/map?focus=${s.id}`)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Map
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(s)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    <Power className="w-3.5 h-3.5" />
                    {s.isActive ? 'Pause' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(s)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 text-xs font-semibold text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete sensor"
        description={`Are you sure you want to permanently delete ${deleteTarget?.binId} (${deleteTarget?.label})? Historical readings for this bin will also be removed.`}
        confirmLabel="Delete sensor"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
