import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Crosshair, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LocationPickerMap } from '../components/MapComponents';
import { useToast } from '../components/UI';

export const AdminRegisterPage: React.FC = () => {
  const { user, registerAdmin } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const [areaName, setAreaName] = useState('');
  const [city, setCity] = useState('');
  const [centreLat, setCentreLat] = useState(18.5204);
  const [centreLng, setCentreLng] = useState(73.8567);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to={user.role === 'ADMIN' ? '/admin/dashboard' : '/employee/tasks'} replace />;
  }

  const pwdHasLen = password.length >= 8;
  const pwdHasMix = /[A-Za-z]/.test(password) && /[0-9]/.test(password);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported on this device.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCentreLat(Number(pos.coords.latitude.toFixed(6)));
        setCentreLng(Number(pos.coords.longitude.toFixed(6)));
        showToast('Area map centred on your current location.', 'success');
      },
      () => {
        showToast('Could not access GPS location. Tap the map to pick a centre point.', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !mobile.trim() || !areaName.trim() || !city.trim()) {
      setError('Please complete all required account and area fields.');
      return;
    }
    if (!pwdHasLen || !pwdHasMix) {
      setError('Password must be at least 8 characters with letters and numbers.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await registerAdmin({
        name: name.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        password,
        confirmPassword,
        areaName: areaName.trim(),
        city: city.trim(),
        centreLat,
        centreLng,
      });
      showToast('Area and admin account created.', 'success');
      navigate('/admin/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="font-display text-lg font-bold text-slate-900">
            VerdantRoute
          </Link>
          <Link to="/login" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            Already registered? Login
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <h1 className="font-display text-2xl font-bold text-slate-900">Register Admin & Create Area</h1>
          <p className="mt-1 text-sm text-slate-600">
            Create your administrator account and municipal collection area in one step.
          </p>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-8">
            {/* Section 1: Account */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
                1. Administrator Account
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-name">
                    Full name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Aarav Kulkarni"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-email">
                    Email address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@city.gov"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-mobile">
                    Mobile number
                  </label>
                  <input
                    id="reg-mobile"
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="reg-password"
                      type={showPwd ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-500 hover:text-slate-800"
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                    >
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className={pwdHasLen ? 'text-emerald-700 font-medium' : ''}>8+ chars</span>
                    {' · '}
                    <span className={pwdHasMix ? 'text-emerald-700 font-medium' : ''}>Letters &amp; numbers</span>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-confirm">
                    Confirm password
                  </label>
                  <input
                    id="reg-confirm"
                    type={showPwd ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Area */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
                2. Collection Area &amp; Map Centre
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-area">
                    Area name
                  </label>
                  <input
                    id="reg-area"
                    type="text"
                    required
                    value={areaName}
                    onChange={(e) => setAreaName(e.target.value)}
                    placeholder="e.g. Ward 14 Shivajinagar"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="reg-city">
                    City / Region
                  </label>
                  <input
                    id="reg-city"
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Pune"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">
                    Area depot / map centre (tap or drag pin)
                  </span>
                  <button
                    type="button"
                    onClick={handleLocateMe}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 py-1 px-2 rounded-lg hover:bg-emerald-50"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    Locate me
                  </button>
                </div>

                <LocationPickerMap
                  lat={centreLat}
                  lng={centreLng}
                  onChange={(lat, lng) => {
                    setCentreLat(lat);
                    setCentreLng(lng);
                  }}
                  heightClass="h-56"
                />

                <div className="mt-2 flex items-center gap-4 text-xs font-mono text-slate-500 tabular-nums">
                  <span>Lat: {centreLat.toFixed(6)}</span>
                  <span>Lng: {centreLng.toFixed(6)}</span>
                </div>
              </div>
            </section>

            <div className="sticky bottom-3 sm:static pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
              >
                {submitting ? 'Creating Account & Area...' : 'Create Admin Account & Area'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
