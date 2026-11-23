import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ArrowLeft, Check, Copy, KeyRound, Plus, Power, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import { LocationPickerMap } from '../../components/MapComponents';
import {
  CardSkeleton,
  ConfirmDialog,
  EmptyState,
  SensorStatusText,
  formatDateTime,
  formatInterval,
  formatRelativeTime,
  useToast,
} from '../../components/UI';
import type { CollectionRecord, Sensor, SensorReading } from '../../types';

export const AdminBinDetailPage: React.FC = () => {
  const { id } = useParams();
  const sensorId = Number(id);
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();

  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [range, setRange] = useState<'day' | 'week' | 'month'>('day');
  const [loading, setLoading] = useState(true);

  // Editable config fields
  const [label, setLabel] = useState('');
  const [binHeightCm, setBinHeightCm] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(900);
  const [fullThreshold, setFullThreshold] = useState('');
  const [lat, setLat] = useState(18.5204);
  const [lng, setLng] = useState(73.8567);
  const [savingConfig, setSavingConfig] = useState(false);

  // Regenerated key modal
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // QA / Hardware Test Simulator state
  const [simDistance, setSimDistance] = useState('18');
  const [simulating, setSimulating] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const res = await api.getSensorDetail(sensorId, range);
      setSensor(res.sensor);
      setReadings(res.readings);
      setCollections(res.collections);
      setLabel(res.sensor.label);
      setBinHeightCm(String(res.sensor.binHeightCm));
      setIntervalSeconds(res.sensor.intervalSeconds);
      setFullThreshold(String(res.sensor.fullThreshold));
      setLat(res.sensor.latitude);
      setLng(res.sensor.longitude);
    } catch (err: any) {
      showToast(err.message || 'Could not load sensor detail.', 'error');
    } finally {
      setLoading(false);
    }
  }, [sensorId, range, showToast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    return subscribe((event, payload) => {
      if (
        (event === 'sensor:reading' && payload?.sensor?.id === sensorId) ||
        (event === 'sensor:updated' && payload?.id === sensorId) ||
        event === 'task:updated' ||
        event === 'sync:reconnect' ||
        event === 'sync:poll'
      ) {
        loadDetail();
      }
    });
  }, [subscribe, sensorId, loadDetail]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await api.updateSensor(sensorId, {
        label: label.trim(),
        binHeightCm: Number(binHeightCm),
        intervalSeconds,
        fullThreshold: Number(fullThreshold),
        latitude: lat,
        longitude: lng,
      });
      setSensor(res.sensor);
      showToast('Sensor configuration updated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Update failed.', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleActive = async () => {
    if (!sensor) return;
    try {
      const res = await api.updateSensor(sensor.id, { isActive: !sensor.isActive });
      setSensor(res.sensor);
      showToast(res.sensor.isActive ? 'Sensor activated.' : 'Sensor deactivated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update sensor status.', 'error');
    }
  };

  const handleRegenerateKey = async () => {
    try {
      const res = await api.regenerateSensorKey(sensorId);
      setNewKey(res.deviceKey);
      setRegenConfirm(false);
      showToast('Device key regenerated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to regenerate key.', 'error');
    }
  };

  const handleSimulateReading = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimulating(true);
    try {
      const res = await api.simulateSensorReading(sensorId, Number(simDistance));
      setSensor(res.sensor);
      showToast(`Simulated reading recorded: ${res.fillPercentage}% (${res.status})`, 'success');
      loadDetail();
    } catch (err: any) {
      showToast(err.message || 'Reading rejected.', 'error');
    } finally {
      setSimulating(false);
    }
  };

  if (loading || !sensor) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8 space-y-5">
        <CardSkeleton rows={6} />
      </div>
    );
  }

  const fillVal = Math.round(sensor.lastFillPercent ?? 0);
  const gaugeColor =
    sensor.status === 'FULL'
      ? 'bg-red-600'
      : sensor.status === 'MEDIUM'
      ? 'bg-amber-500'
      : sensor.status === 'OFFLINE'
      ? 'bg-slate-400'
      : 'bg-emerald-600';

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin/sensors" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" />
          Back to Sensors
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleToggleActive}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Power className="w-4 h-4" />
            {sensor.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/admin/tasks/new?bins=${sensor.id}`)}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Plus className="w-4 h-4" />
            Create Task for Bin
          </button>
        </div>
      </div>

      {/* Top Overview + Visual Fill Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-slate-900">{sensor.binId}</span>
            <SensorStatusText status={sensor.status} fillPercent={sensor.lastFillPercent} />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">{sensor.label}</h1>

          {/* Visual Bin Gauge */}
          <div className="flex items-end gap-5 pt-2">
            <div className="relative h-36 w-20 rounded-b-xl rounded-t-md border-2 border-slate-300 bg-slate-100 overflow-hidden flex items-end">
              <div
                className={`w-full transition-all duration-300 ${gaugeColor}`}
                style={{ height: `${sensor.lastFillPercent !== null ? fillVal : 0}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-slate-900">
                {sensor.lastFillPercent !== null ? `${fillVal}%` : '—'}
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <div className="text-slate-400">Last reading</div>
                <div className="font-semibold text-slate-900">{formatRelativeTime(sensor.lastSeenAt)}</div>
              </div>
              <div>
                <div className="text-slate-400">Measured distance</div>
                <div className="font-mono font-semibold text-slate-900">
                  {sensor.lastDistanceCm !== null ? `${sensor.lastDistanceCm} cm` : '—'} / {sensor.binHeightCm} cm
                </div>
              </div>
              <div>
                <div className="text-slate-400">Reading interval</div>
                <div className="font-mono font-semibold text-slate-900">{formatInterval(sensor.intervalSeconds)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Reading History Line Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Reading History</h2>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['day', 'week', 'month'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`min-h-[32px] rounded-md px-3 text-xs font-semibold capitalize ${
                    range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {readings.length === 0 ? (
            <EmptyState
              icon={<RefreshCw className="w-5 h-5" />}
              title="No readings in this window"
              description="Send a reading from the ESP32 or use the test simulator below."
            />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={readings.map((r) => ({
                    ...r,
                    time: new Date(r.recordedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  }))}
                  margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={24} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
                  <Tooltip formatter={(val: any) => [`${val}%`, 'Fill']} />
                  <Line type="monotone" dataKey="fillPercent" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Configuration + Map Pin + Hardware Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveConfig} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">Sensor Settings &amp; Location</h2>
            <button
              type="button"
              onClick={() => setRegenConfirm(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-emerald-700"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Regenerate Device Key
            </button>
          </div>

          {newKey && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs space-y-1.5">
              <div className="font-semibold text-emerald-900">New Device Key (shown once)</div>
              <div className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 border border-emerald-200">
                <code className="font-mono break-all text-slate-900">{newKey}</code>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(newKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 2000);
                  }}
                  className="shrink-0 text-emerald-700 font-semibold inline-flex items-center gap-1"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Location label</label>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Height (cm)</label>
              <input
                type="number"
                min={10}
                max={500}
                required
                value={binHeightCm}
                onChange={(e) => setBinHeightCm(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Full (%)</label>
              <input
                type="number"
                min={51}
                max={100}
                required
                value={fullThreshold}
                onChange={(e) => setFullThreshold(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Interval</label>
              <select
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-2.5 text-sm bg-white"
              >
                <option value={60}>1 min</option>
                <option value={300}>5 min</option>
                <option value={900}>15 min</option>
                <option value={1800}>30 min</option>
                <option value={3600}>1 hr</option>
                <option value={14400}>4 hrs</option>
              </select>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1.5">Move pin to update bin coordinates</span>
            <LocationPickerMap
              lat={lat}
              lng={lng}
              onChange={(nextLat, nextLng) => {
                setLat(nextLat);
                setLng(nextLng);
              }}
              heightClass="h-48"
            />
            <div className="mt-1.5 text-xs font-mono text-slate-500">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          </div>

          <button
            type="submit"
            disabled={savingConfig}
            className="w-full min-h-[44px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {savingConfig ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>

        <div className="space-y-6">
          {/* Separated Development / QA Hardware Test Mechanism */}
          <form onSubmit={handleSimulateReading} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">Sensor Reading Test Simulator</h2>
            <p className="text-xs text-slate-600">
              Development utility to test ultrasonic fill calculation and real-time updates without an ESP32 wired. Physical ESP32 devices authenticate separately at <code className="font-mono">POST /api/device/reading</code>.
            </p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="sim-dist">
                  Measured distance from lid (0 – {sensor.binHeightCm} cm)
                </label>
                <input
                  id="sim-dist"
                  type="number"
                  step="0.5"
                  value={simDistance}
                  onChange={(e) => setSimDistance(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={simulating}
                className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                {simulating ? 'Sending...' : 'Send Test Reading'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { label: 'Empty (10%)', dist: Math.round(sensor.binHeightCm * 0.9) },
                { label: 'Medium (65%)', dist: Math.round(sensor.binHeightCm * 0.35) },
                { label: 'Full (90%)', dist: Math.round(sensor.binHeightCm * 0.1) },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSimDistance(String(preset.dist))}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {preset.label} ({preset.dist} cm)
                </button>
              ))}
            </div>
          </form>

          {/* Collection History */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">Collection History</h2>
            {collections.length === 0 ? (
              <p className="text-sm text-slate-500">This bin has not been collected yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {collections.map((c) => (
                  <div key={c.taskBinId} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-slate-900">{c.employeeName}</div>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(c.collectedAt)} · Fill at assignment:{' '}
                        <span className="font-mono">{Math.round(c.fillAtAssignment ?? 0)}%</span>
                      </div>
                    </div>
                    <Link
                      to={`/admin/tasks/${c.taskId}`}
                      className="text-xs font-semibold text-emerald-700 hover:underline font-mono"
                    >
                      Task #{c.taskId}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={regenConfirm}
        title="Regenerate device key?"
        description="The existing device key will stop working immediately. You will need to update the ESP32 firmware with the new key."
        confirmLabel="Regenerate Key"
        destructive
        onConfirm={handleRegenerateKey}
        onCancel={() => setRegenConfirm(false)}
      />
    </div>
  );
};
