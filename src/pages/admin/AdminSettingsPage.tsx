import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { LocationPickerMap } from '../../components/MapComponents';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { useToast } from '../../components/UI';

export const AdminSettingsPage: React.FC = () => {
  const { user, updateAreaInContext, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [areaName, setAreaName] = useState(user?.area?.name || '');
  const [city, setCity] = useState(user?.area?.city || '');
  const [centreLat, setCentreLat] = useState(user?.area?.centreLat ?? 18.5204);
  const [centreLng, setCentreLng] = useState(user?.area?.centreLng ?? 73.8567);
  const [defaultIntervalSeconds, setDefaultIntervalSeconds] = useState(user?.area?.defaultIntervalSeconds ?? 900);
  const [mediumThreshold, setMediumThreshold] = useState(String(user?.area?.mediumThreshold ?? 50));
  const [fullThreshold, setFullThreshold] = useState(String(user?.area?.fullThreshold ?? 80));
  const [savingArea, setSavingArea] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await api.getArea();
        setAreaName(a.name);
        setCity(a.city);
        setCentreLat(a.centreLat);
        setCentreLng(a.centreLng);
        setDefaultIntervalSeconds(a.defaultIntervalSeconds);
        setMediumThreshold(String(a.mediumThreshold));
        setFullThreshold(String(a.fullThreshold));
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleSaveArea = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingArea(true);
    try {
      const updated = await api.updateArea({
        name: areaName.trim(),
        city: city.trim(),
        centreLat,
        centreLng,
        defaultIntervalSeconds,
        mediumThreshold: Number(mediumThreshold),
        fullThreshold: Number(fullThreshold),
      });
      updateAreaInContext(updated);
      showToast('Area settings saved. Sensor status thresholds recalculated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not save area settings.', 'error');
    } finally {
      setSavingArea(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    setSavingPwd(true);
    try {
      await api.changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('Password updated successfully.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Password update failed.', 'error');
    } finally {
      setSavingPwd(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Profile &amp; Area Settings</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Configure area centre coordinates, default sensor thresholds, and account security.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PWAInstallButton variant="compact" />
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Area Settings */}
        <form onSubmit={handleSaveArea} className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900">Area &amp; Default Thresholds</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Area name</label>
              <input
                type="text"
                required
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">City / Region</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Default interval</label>
              <select
                value={defaultIntervalSeconds}
                onChange={(e) => setDefaultIntervalSeconds(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
              >
                <option value={60}>1 min</option>
                <option value={300}>5 min</option>
                <option value={900}>15 min</option>
                <option value={1800}>30 min</option>
                <option value={3600}>1 hr</option>
                <option value={14400}>4 hrs</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Medium threshold (%)</label>
              <input
                type="number"
                min={10}
                max={89}
                required
                value={mediumThreshold}
                onChange={(e) => setMediumThreshold(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Full threshold (%)</label>
              <input
                type="number"
                min={20}
                max={100}
                required
                value={fullThreshold}
                onChange={(e) => setFullThreshold(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1.5">
              Area depot / centre location (drag or tap map)
            </span>
            <LocationPickerMap
              lat={centreLat}
              lng={centreLng}
              onChange={(lat, lng) => {
                setCentreLat(lat);
                setCentreLng(lng);
              }}
              heightClass="h-56"
            />
            <div className="mt-1.5 text-xs font-mono text-slate-500">
              {centreLat.toFixed(6)}, {centreLng.toFixed(6)}
            </div>
          </div>

          <button
            type="submit"
            disabled={savingArea}
            className="w-full sm:w-auto min-h-[44px] rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {savingArea ? 'Saving Area Settings...' : 'Save Area Settings'}
          </button>
        </form>

        {/* Admin Details & Change Password */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-2 text-sm">
            <h2 className="font-display text-base font-semibold text-slate-900">Administrator Profile</h2>
            <div className="pt-2">
              <div className="text-xs text-slate-500">Name</div>
              <div className="font-semibold text-slate-900">{user?.name}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Email</div>
              <div className="text-slate-800">{user?.email}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Mobile</div>
              <div className="font-mono text-slate-800">{user?.mobile}</div>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900">Change Password</h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Current password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">New password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Confirm new password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingPwd}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {savingPwd ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
