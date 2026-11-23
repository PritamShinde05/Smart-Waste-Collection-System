import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Crosshair, Plus, Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useRealtime } from '../../context/RealtimeContext';
import { LiveBinsMap } from '../../components/MapComponents';
import { SensorStatusText, formatRelativeTime, useToast } from '../../components/UI';
import type { Sensor } from '../../types';

export const AdminLiveMapPage: React.FC = () => {
  const { user } = useAuth();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialStatus = searchParams.get('status') || 'ALL';
  const focusIdParam = searchParams.get('focus') ? Number(searchParams.get('focus')) : null;

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [search, setSearch] = useState('');
  const [selectedSensor, setSelectedSensor] = useState<Sensor | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  const loadSensors = useCallback(async () => {
    try {
      const res = await api.listSensors();
      setSensors(res.sensors);
      if (focusIdParam) {
        const match = res.sensors.find((s) => s.id === focusIdParam);
        if (match) setSelectedSensor(match);
      }
    } catch {
      // ignore
    }
  }, [focusIdParam]);

  useEffect(() => {
    loadSensors();
  }, [loadSensors]);

  // Update individual markers in place on live WebSocket updates
  useEffect(() => {
    return subscribe((event, payload) => {
      if (event === 'sensor:reading' && payload?.sensor) {
        const updated: Sensor = payload.sensor;
        setSensors((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSelectedSensor((prev) => (prev && prev.id === updated.id ? updated : prev));
      } else if (event === 'sensor:updated' && payload?.id) {
        const updated: Sensor = payload;
        setSensors((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSelectedSensor((prev) => (prev && prev.id === updated.id ? updated : prev));
      } else if (event === 'sensor:created' && payload?.id) {
        setSensors((prev) => (prev.some((s) => s.id === payload.id) ? prev : [payload, ...prev]));
      } else if (event === 'sensor:deleted' && payload?.id) {
        setSensors((prev) => prev.filter((s) => s.id !== payload.id));
        setSelectedSensor((prev) => (prev && prev.id === payload.id ? null : prev));
      } else if (event === 'area:updated' && Array.isArray(payload?.sensors)) {
        setSensors(payload.sensors);
      } else if (event === 'sync:reconnect' || event === 'sync:poll') {
        loadSensors();
      }
    });
  }, [subscribe, loadSensors]);

  const filteredSensors = useMemo(() => {
    return sensors.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!s.binId.toLowerCase().includes(q) && !s.label.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sensors, statusFilter, search]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast('GPS location is not supported by this browser.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => showToast('Unable to get your current GPS coordinates.', 'error'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-6 space-y-3">
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Bin ID or label..."
              className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 focus:border-emerald-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 overflow-x-auto">
            {['ALL', 'FULL', 'MEDIUM', 'NORMAL', 'OFFLINE'].map((st) => (
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

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleLocateMe}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Crosshair className="w-4 h-4" />
            Locate me
          </button>
          <button
            type="button"
            onClick={() => navigate('/admin/sensors/new')}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Sensor
          </button>
        </div>
      </div>

      {/* Map + Selected Bin Sheet */}
      <div className="relative">
        <LiveBinsMap
          sensors={filteredSensors}
          centerLat={user?.area?.centreLat ?? 18.5204}
          centerLng={user?.area?.centreLng ?? 73.8567}
          selectedSensorId={selectedSensor?.id ?? null}
          focusSensorId={focusIdParam}
          userLocation={userLocation}
          onSelectSensor={(s) => setSelectedSensor(s)}
          heightClass="h-[calc(100vh-15.5rem)] md:h-[calc(100vh-12.5rem)] min-h-[420px]"
        />

        {selectedSensor && (
          <div className="fixed lg:absolute bottom-16 lg:bottom-4 left-3 right-3 lg:left-auto lg:right-4 lg:w-96 z-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-900">{selectedSensor.binId}</span>
                  <span aria-hidden="true">·</span>
                  <span>Updated {formatRelativeTime(selectedSensor.lastSeenAt)}</span>
                </div>
                <h2 className="mt-1 font-display text-base font-semibold text-slate-900">{selectedSensor.label}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSensor(null)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close bin details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <SensorStatusText status={selectedSensor.status} fillPercent={selectedSensor.lastFillPercent} />
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {selectedSensor.latitude.toFixed(5)}, {selectedSensor.longitude.toFixed(5)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/admin/sensors/${selectedSensor.id}`)}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                View details
              </button>
              <button
                type="button"
                onClick={() => navigate(`/admin/tasks/new?bins=${selectedSensor.id}`)}
                className="min-h-[44px] rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Create task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
