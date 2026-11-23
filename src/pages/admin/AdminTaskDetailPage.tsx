import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Edit3, RefreshCw, X, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import { RouteMap } from '../../components/MapComponents';
import {
  CardSkeleton,
  ConfirmDialog,
  SensorStatusText,
  TaskStatusText,
  formatDateTime,
  formatDistance,
  formatDuration,
  useToast,
} from '../../components/UI';
import type { Sensor, TaskDetail } from '../../types';

export const AdminTaskDetailPage: React.FC = () => {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reoptimizing, setReoptimizing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [editBinsOpen, setEditBinsOpen] = useState(false);
  const [areaSensors, setAreaSensors] = useState<Sensor[]>([]);
  const [selectedSensorIds, setSelectedSensorIds] = useState<number[]>([]);
  const [savingBins, setSavingBins] = useState(false);

  const loadTask = useCallback(async () => {
    try {
      const res = await api.getTaskDetail(taskId);
      setTask(res.task);
    } catch (err: any) {
      showToast(err.message || 'Could not load task.', 'error');
    } finally {
      setLoading(false);
    }
  }, [taskId, showToast]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  useEffect(() => {
    return subscribe((event, payload) => {
      if (
        (event.startsWith('task:') && payload?.id === taskId) ||
        event === 'sync:reconnect' ||
        event === 'sync:poll'
      ) {
        loadTask();
      }
    });
  }, [subscribe, taskId, loadTask]);

  const handleReoptimize = async () => {
    setReoptimizing(true);
    try {
      const res = await api.reoptimizeTask(taskId);
      setTask(res.task);
      showToast('Task route re-optimized.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Re-optimization failed. Please retry.', 'error');
    } finally {
      setReoptimizing(false);
    }
  };

  const openEditBins = async () => {
    if (!task) return;
    setSelectedSensorIds(task.stops.map((s) => s.sensorId));
    setEditBinsOpen(true);
    try {
      const res = await api.listSensors();
      setAreaSensors(res.sensors);
    } catch {
      showToast('Failed to load area bins.', 'error');
    }
  };

  const toggleBinSelection = (sensorId: number) => {
    // Prevent removing a stop that has already been collected
    const alreadyCollected = task?.stops.some((st) => st.sensorId === sensorId && Boolean(st.collectedAt));
    if (alreadyCollected) {
      showToast('Collected stops cannot be removed from an active task.', 'info');
      return;
    }
    setSelectedSensorIds((prev) =>
      prev.includes(sensorId) ? prev.filter((x) => x !== sensorId) : [...prev, sensorId]
    );
  };

  const handleSaveBins = async () => {
    if (selectedSensorIds.length === 0) {
      showToast('Select at least one bin for this task.', 'error');
      return;
    }
    setSavingBins(true);
    try {
      const res = await api.reoptimizeTask(taskId, { sensorIds: selectedSensorIds });
      setTask(res.task);
      setEditBinsOpen(false);
      showToast('Bin list updated and route regenerated.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not update bins and regenerate route.', 'error');
    } finally {
      setSavingBins(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await api.cancelTask(taskId);
      setTask(res.task);
      setCancelOpen(false);
      showToast(`Task #${taskId} cancelled.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not cancel task.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading || !task) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <CardSkeleton rows={6} />
      </div>
    );
  }

  const canModify = task.status === 'ASSIGNED' || task.status === 'ACCEPTED';

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin/tasks" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>

        {canModify && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openEditBins}
              className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Edit3 className="w-4 h-4" />
              Edit Bins
            </button>
            <button
              type="button"
              disabled={reoptimizing}
              onClick={handleReoptimize}
              className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reoptimizing ? 'animate-spin' : ''}`} />
              {reoptimizing ? 'Re-optimizing...' : 'Re-optimize Route'}
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              <XCircle className="w-4 h-4" />
              Cancel Task
            </button>
          </div>
        )}
      </div>

      {/* Header & Timeline */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold text-slate-900 font-mono">Task #{task.id}</h1>
              <TaskStatusText status={task.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Assigned to{' '}
              <button
                type="button"
                onClick={() => navigate(`/admin/tasks?employeeId=${task.assignedTo.id}&status=ALL`)}
                className="font-semibold text-emerald-700 hover:underline"
              >
                {task.assignedTo.name}
              </button>{' '}
              · {task.assignedTo.mobile}
            </p>
          </div>

          <div className="flex items-center gap-6 text-sm tabular-nums">
            <div>
              <div className="text-xs text-slate-500">Total distance</div>
              <div className="font-mono font-bold text-slate-900">{formatDistance(task.totalDistanceMeters)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Est. time</div>
              <div className="font-mono font-bold text-slate-900">{formatDuration(task.estimatedTimeSeconds)}</div>
            </div>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-xs">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">1. Assigned</div>
            <div className="mt-0.5 text-slate-600 tabular-nums">{formatDateTime(task.createdAt)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">2. Accepted</div>
            <div className="mt-0.5 text-slate-600 tabular-nums">
              {task.acceptedAt ? formatDateTime(task.acceptedAt) : 'Pending'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-900">
              {task.status === 'CANCELLED' ? '3. Cancelled' : '3. Completed'}
            </div>
            <div className="mt-0.5 text-slate-600 tabular-nums">
              {task.status === 'CANCELLED'
                ? formatDateTime(task.cancelledAt)
                : task.completedAt
                ? formatDateTime(task.completedAt)
                : 'In progress'}
            </div>
          </div>
        </div>

        {(task.note || task.completionNote) && (
          <div className="border-t border-slate-100 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {task.note && (
              <div>
                <div className="text-xs font-medium text-slate-500">Admin Note</div>
                <p className="mt-0.5 text-slate-800">{task.note}</p>
              </div>
            )}
            {task.completionNote && (
              <div>
                <div className="text-xs font-medium text-slate-500">Employee Completion Note</div>
                <p className="mt-0.5 text-slate-800">{task.completionNote}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Route Map + Ordered Stops */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">Optimized Road Route</h2>
          <RouteMap
            startLat={task.startLat}
            startLng={task.startLng}
            startLabel={task.startType === 'DEPOT' ? 'Area Depot' : 'Employee Start'}
            stops={task.stops.map((st) => ({
              sensorId: st.sensorId,
              stopOrder: st.stopOrder,
              binId: st.binId,
              label: st.label,
              latitude: st.latitude,
              longitude: st.longitude,
              collected: Boolean(st.collectedAt),
            }))}
            routeGeometry={task.routeGeometry}
            heightClass="h-96"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Stops ({task.stops.filter((s) => s.collectedAt).length}/{task.stops.length} collected)
          </h2>
          <div className="space-y-2.5 max-h-96 overflow-y-auto">
            {task.stops.map((st) => {
              const done = Boolean(st.collectedAt);
              return (
                <div
                  key={st.taskBinId}
                  className={`rounded-xl border p-3.5 transition-colors ${
                    done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs font-bold text-white shrink-0 ${
                          done ? 'bg-emerald-600' : 'bg-slate-900'
                        }`}
                      >
                        {st.stopOrder}
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/admin/sensors/${st.sensorId}`}
                          className="font-mono text-xs font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                        >
                          {st.binId}
                        </Link>
                        <div className="text-sm font-medium text-slate-800 truncate">{st.label}</div>
                        <div className="mt-1 text-xs text-slate-500 tabular-nums">
                          Fill at assignment: <span className="font-mono">{Math.round(st.fillAtAssignment ?? 0)}%</span>
                        </div>
                      </div>
                    </div>
                    {done ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                        Collected
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 shrink-0">Pending</span>
                    )}
                  </div>
                  {st.collectedAt && (
                    <div className="mt-1.5 pl-8 text-[11px] text-emerald-800 tabular-nums">
                      Collected at {formatDateTime(st.collectedAt)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Edit Bins & Regenerate Route Modal */}
      {editBinsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">Edit Task Bins</h3>
                <p className="text-xs text-slate-500">
                  Add or remove stops. The road route will be re-optimized immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditBinsOpen(false)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {areaSensors.length === 0 ? (
                <CardSkeleton rows={4} />
              ) : (
                areaSensors.map((s) => {
                  const checked = selectedSensorIds.includes(s.id);
                  const collected = task.stops.some((st) => st.sensorId === s.id && Boolean(st.collectedAt));
                  return (
                    <label
                      key={s.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer ${
                        checked ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBinSelection(s.id)}
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900">{s.binId}</span>
                            {collected && <span className="text-[11px] font-semibold text-emerald-700">(Collected)</span>}
                          </div>
                          <div className="text-sm text-slate-700 truncate">{s.label}</div>
                        </div>
                      </div>
                      <SensorStatusText status={s.status} fillPercent={s.lastFillPercent} />
                    </label>
                  );
                })
              )}
            </div>

            <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600 tabular-nums">{selectedSensorIds.length} bin(s) selected</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingBins}
                  onClick={() => setEditBinsOpen(false)}
                  className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingBins || selectedSensorIds.length === 0}
                  onClick={handleSaveBins}
                  className="min-h-[42px] rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingBins ? 'Regenerating Route...' : 'Save & Re-optimize'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title={`Cancel Task #${task.id}?`}
        description="The assigned employee will no longer be able to accept or complete this task."
        confirmLabel="Cancel Task"
        destructive
        busy={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
};
