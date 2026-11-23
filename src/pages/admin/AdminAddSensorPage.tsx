import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Crosshair, KeyRound } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { LocationPickerMap } from '../../components/MapComponents';
import { useToast } from '../../components/UI';

const INTERVAL_PRESETS = [
  { label: '1 min', seconds: 60 },
  { label: '5 min', seconds: 300 },
  { label: '15 min', seconds: 900 },
  { label: '30 min', seconds: 1800 },
  { label: '1 hr', seconds: 3600 },
  { label: '4 hrs', seconds: 14400 },
];

export const AdminAddSensorPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [binId, setBinId] = useState('');
  const [label, setLabel] = useState('');
  const [binHeightCm, setBinHeightCm] = useState('120');
  const [intervalSeconds, setIntervalSeconds] = useState(user?.area?.defaultIntervalSeconds || 900);
  const [fullThreshold, setFullThreshold] = useState(String(user?.area?.fullThreshold || 80));
  const [latitude, setLatitude] = useState(user?.area?.centreLat ?? 18.5204);
  const [longitude, setLongitude] = useState(user?.area?.centreLng ?? 73.8567);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    sensorId: number;
    binId: string;
    deviceKey: string;
    endpoint: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(Number(pos.coords.latitude.toFixed(6)));
        setLongitude(Number(pos.coords.longitude.toFixed(6)));
        showToast('Pin moved to your current location.', 'success');
      },
      () => showToast('Could not read GPS location.', 'error'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const h = Number(binHeightCm);
    const thresh = Number(fullThreshold);
    if (!binId.trim() || !label.trim()) {
      setError('Bin ID and location label are required.');
      return;
    }
    if (Number.isNaN(h) || h < 10 || h > 500) {
      setError('Bin height must be between 10 cm and 500 cm.');
      return;
    }
    if (Number.isNaN(thresh) || thresh <= (user?.area?.mediumThreshold || 50) || thresh > 100) {
      setError(`Full threshold must be greater than ${user?.area?.mediumThreshold || 50}% and at most 100%.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createSensor({
        binId: binId.trim().toUpperCase(),
        label: label.trim(),
        latitude,
        longitude,
        binHeightCm: h,
        intervalSeconds,
        fullThreshold: thresh,
      });
      setCreatedCredentials({
        sensorId: res.sensor.id,
        binId: res.sensor.binId,
        deviceKey: res.deviceKey,
        endpoint: `${window.location.origin}${res.readingEndpoint}`,
      });
      showToast(`Sensor ${res.sensor.binId} registered.`, 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to add sensor.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!createdCredentials) return;
    await navigator.clipboard.writeText(createdCredentials.deviceKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (createdCredentials) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">Sensor Registered</h1>
              <p className="text-sm text-slate-600">Copy the device key now — it is displayed only once.</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm">
            <div>
              <div className="text-xs font-medium text-slate-500">Bin ID</div>
              <div className="mt-0.5 font-mono font-bold text-slate-900">{createdCredentials.binId}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Device Key (save in ESP32 firmware)</div>
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <code className="text-xs font-mono text-slate-900 break-all">{createdCredentials.deviceKey}</code>
                <button
                  type="button"
                  onClick={copyKey}
                  className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">HTTPS Reading Endpoint</div>
              <code className="mt-0.5 block text-xs font-mono text-slate-700 break-all">
                POST {createdCredentials.endpoint}
              </code>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-xs font-mono text-slate-100 overflow-x-auto">
            <pre>{`{
  "binId": "${createdCredentials.binId}",
  "deviceKey": "${createdCredentials.deviceKey}",
  "distanceCm": 24.5,
  "timestamp": "2026-11-23T09:00:00Z"
}`}</pre>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => navigate(`/admin/sensors/${createdCredentials.sensorId}`)}
              className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Open Bin Detail &amp; Test
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/sensors')}
              className="flex-1 min-h-[48px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Back to Sensors List
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8 space-y-5">
      <Link to="/admin/sensors" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" />
        Back to Sensors
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold text-slate-900">Add Bin Sensor</h1>
        <p className="mt-1 text-sm text-slate-600">
          Register an ESP32 + HC-SR04 bin node and pin its physical location on the map.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="bin-id">
                Unique Bin ID
              </label>
              <input
                id="bin-id"
                type="text"
                required
                value={binId}
                onChange={(e) => setBinId(e.target.value)}
                placeholder="e.g. BIN-101"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="bin-label">
                Bin name / location label
              </label>
              <input
                id="bin-label"
                type="text"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. FC Road Main Junction"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="bin-height">
                Bin height (cm)
              </label>
              <input
                id="bin-height"
                type="number"
                inputMode="decimal"
                min={10}
                max={500}
                required
                value={binHeightCm}
                onChange={(e) => setBinHeightCm(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="full-thresh">
                Full threshold (%)
              </label>
              <input
                id="full-thresh"
                type="number"
                inputMode="numeric"
                min={51}
                max={100}
                required
                value={fullThreshold}
                onChange={(e) => setFullThreshold(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">Reading interval (1 min to 4 hrs)</span>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_PRESETS.map((p) => (
                <button
                  key={p.seconds}
                  type="button"
                  onClick={() => setIntervalSeconds(p.seconds)}
                  className={`min-h-[40px] rounded-xl border px-3.5 text-xs font-semibold transition-colors ${
                    intervalSeconds === p.seconds
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Bin location (tap or drag map pin)</span>
              <button
                type="button"
                onClick={handleLocateMe}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Locate me
              </button>
            </div>
            <LocationPickerMap
              lat={latitude}
              lng={longitude}
              onChange={(lat, lng) => {
                setLatitude(lat);
                setLongitude(lng);
              }}
              heightClass="h-64"
            />
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs font-mono text-slate-600">
              <div>Latitude: {latitude.toFixed(6)}</div>
              <div>Longitude: {longitude.toFixed(6)}</div>
            </div>
          </div>

          <div className="sticky bottom-2 sm:static pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving Sensor...' : 'Save Sensor & Generate Device Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
