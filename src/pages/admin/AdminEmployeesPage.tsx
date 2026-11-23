import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Plus, Power, Users, X } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import {
  CardSkeleton,
  EmptyState,
  TaskStatusText,
  formatDateTime,
  formatDistance,
  useToast,
} from '../../components/UI';
import type { Employee, TaskSummary } from '../../types';

export const AdminEmployeesPage: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [resetting, setResetting] = useState(false);

  const [historyData, setHistoryData] = useState<{ employee: Employee; tasks: TaskSummary[] } | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await api.listEmployees();
      setEmployees(res.employees);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    return subscribe((event) => {
      if (event === 'employee:updated' || event.startsWith('task:') || event === 'sync:reconnect' || event === 'sync:poll') {
        loadEmployees();
      }
    });
  }, [subscribe, loadEmployees]);

  const handleToggleStatus = async (emp: Employee) => {
    const next = emp.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.updateEmployeeStatus(emp.id, next);
      setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: next } : e)));
      showToast(`${emp.name} is now ${next.toLowerCase()}.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Status update failed.', 'error');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetting(true);
    try {
      await api.resetEmployeePassword(resetTarget.id, newPwd);
      showToast(`Password reset for ${resetTarget.name}.`, 'success');
      setResetTarget(null);
      setNewPwd('');
    } catch (err: any) {
      showToast(err.message || 'Password reset failed.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const openHistory = async (emp: Employee) => {
    try {
      const res = await api.getEmployeeHistory(emp.id);
      setHistoryData({ employee: emp, tasks: res.tasks });
    } catch (err: any) {
      showToast(err.message || 'Could not load employee history.', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Employees</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Create field collector accounts, monitor task loads, and manage active access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin/employees/new')}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      {loading ? (
        <CardSkeleton rows={4} />
      ) : employees.length === 0 ? (
        <EmptyState
          icon={<Users className="w-5 h-5" />}
          title="No employees added yet"
          description="Employees cannot self-register. Create an employee account so they can log in and collect bins."
          action={
            <button
              type="button"
              onClick={() => navigate('/admin/employees/new')}
              className="min-h-[44px] rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Add First Employee
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
                  <th className="py-3.5 px-4">Name</th>
                  <th className="py-3.5 px-4">Mobile &amp; Email</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Open Tasks</th>
                  <th className="py-3.5 px-4">Completed</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => openHistory(emp)}
                        className="hover:text-emerald-700 hover:underline text-left"
                      >
                        {emp.name}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="font-mono text-xs text-slate-800">{emp.mobile}</div>
                      <div className="text-xs text-slate-500">{emp.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                          emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            emp.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-slate-400'
                          }`}
                        />
                        {emp.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 tabular-nums">
                      {emp.openTasks}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-emerald-700 tabular-nums">
                      {emp.completedTasks}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/tasks/new?employee=${emp.id}`)}
                          className="min-h-[36px] rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Assign Task
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(emp)}
                          className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/employees/${emp.id}/edit`)}
                          className="min-h-[36px] rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(emp);
                            setNewPwd('');
                          }}
                          title="Reset password"
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(emp)}
                          title={emp.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          <Power className="w-4 h-4" />
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
            {employees.map((emp) => (
              <div key={emp.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold text-slate-900">{emp.name}</h2>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {emp.mobile} · {emp.email}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      emp.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {emp.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-600 tabular-nums">
                  <span>
                    Open tasks: <strong className="font-mono text-slate-900">{emp.openTasks}</strong>
                  </span>
                  <span>
                    Completed: <strong className="font-mono text-emerald-700">{emp.completedTasks}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/tasks/new?employee=${emp.id}`)}
                    className="min-h-[44px] rounded-xl bg-emerald-600 text-xs font-semibold text-white"
                  >
                    Assign
                  </button>
                  <button
                    type="button"
                    onClick={() => openHistory(emp)}
                    className="min-h-[44px] rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/employees/${emp.id}/edit`)}
                    className="min-h-[44px] rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setResetTarget(emp);
                      setNewPwd('');
                    }}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Reset Password
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(emp)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    <Power className="w-3.5 h-3.5" />
                    {emp.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleResetPassword} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">Reset Password for {resetTarget.name}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                New temporary password (8+ chars, letters &amp; numbers)
              </label>
              <input
                type="text"
                required
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="e.g. FieldPass2026"
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 text-sm font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="min-h-[44px] rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {resetting ? 'Updating...' : 'Reset Password'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employee Performance & Task History Modal */}
      {historyData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">{historyData.employee.name}</h3>
                <p className="text-xs text-slate-500">
                  {historyData.employee.completedTasks} completed · {historyData.employee.openTasks} open
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryData(null)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {historyData.tasks.length === 0 ? (
                <p className="text-sm text-slate-500">No tasks assigned to this employee yet.</p>
              ) : (
                historyData.tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setHistoryData(null);
                      navigate(`/admin/tasks/${t.id}`);
                    }}
                    className="w-full flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-left hover:bg-slate-50"
                  >
                    <div>
                      <div className="font-mono text-xs font-bold text-slate-900">Task #{t.id}</div>
                      <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                        {t.binCount} bins · {formatDistance(t.totalDistanceMeters)} · {formatDateTime(t.createdAt)}
                      </div>
                    </div>
                    <TaskStatusText status={t.status} />
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const id = historyData.employee.id;
                  setHistoryData(null);
                  navigate(`/admin/tasks?employeeId=${id}&status=ALL`);
                }}
                className="min-h-[40px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700"
              >
                Open in Tasks View
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = historyData.employee.id;
                  setHistoryData(null);
                  navigate(`/admin/tasks/new?employee=${id}`);
                }}
                className="min-h-[40px] rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white"
              >
                Assign New Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
