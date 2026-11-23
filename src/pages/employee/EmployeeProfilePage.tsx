import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { formatDateTime, formatDistance, useToast } from '../../components/UI';
import type { TaskSummary } from '../../types';

export const EmployeeProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [completedTasks, setCompletedTasks] = useState<TaskSummary[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    api
      .listMyTasks('COMPLETED')
      .then((res) => setCompletedTasks(res.tasks))
      .catch(() => {});
  }, []);

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
      showToast(err.message || 'Could not update password.', 'error');
    } finally {
      setSavingPwd(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-5">
      <h1 className="font-display text-2xl font-bold text-slate-900">Profile</h1>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">{user?.name}</div>
            <div className="text-sm font-mono text-slate-600">{user?.mobile}</div>
            <div className="text-xs text-slate-500 mt-1">
              Area: {user?.area?.name} · {user?.area?.city}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">{completedTasks.length}</div>
            <div className="text-xs text-slate-500">Completed</div>
          </div>
        </div>
      </div>

      {/* Recent Task History */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900">Completed Task History</h2>
          <button
            type="button"
            onClick={() => navigate('/employee/tasks?tab=COMPLETED')}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            View all
          </button>
        </div>

        {completedTasks.length === 0 ? (
          <p className="text-sm text-slate-500">No completed tasks yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {completedTasks.slice(0, 5).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/employee/tasks/${t.id}`)}
                className="w-full py-2.5 flex items-center justify-between text-left hover:bg-slate-50 px-1 rounded-lg"
              >
                <div>
                  <div className="font-mono text-xs font-bold text-slate-900">Task #{t.id}</div>
                  <div className="text-xs text-slate-500">
                    {t.binCount} bins · {formatDistance(t.totalDistanceMeters)}
                  </div>
                </div>
                <div className="text-xs text-slate-500 tabular-nums">{formatDateTime(t.completedAt)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-display text-base font-semibold text-slate-900">Change Password</h2>
        <input
          type="password"
          required
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
        />
        <input
          type="password"
          required
          placeholder="New password (8+ chars, letters & numbers)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
        />
        <input
          type="password"
          required
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
        />
        <button
          type="submit"
          disabled={savingPwd}
          className="w-full min-h-[48px] rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {savingPwd ? 'Updating...' : 'Update Password'}
        </button>
      </form>

      <div className="space-y-3">
        <PWAInstallButton variant="full" />
        <button
          type="button"
          onClick={handleLogout}
          className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </div>
  );
};
