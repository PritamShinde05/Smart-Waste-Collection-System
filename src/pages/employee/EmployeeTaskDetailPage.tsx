import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Navigation } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import { RouteMap } from '../../components/MapComponents';
import {
  CardSkeleton,
  TaskStatusText,
  formatDateTime,
  formatDistance,
  formatDuration,
  useToast,
} from '../../components/UI';
import type { TaskDetail } from '../../types';

export const EmployeeTaskDetailPage: React.FC = () => {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  const loadTask = useCallback(async () => {
    try {
      const res = await api.getMyTaskDetail(taskId);
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
      if ((event.startsWith('task:') && payload?.id === taskId) || event === 'sync:reconnect' || event === 'sync:poll') {
        loadTask();
      }
    });
  }, [subscribe, taskId, loadTask]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const res = await api.acceptTask(taskId);
      setTask(res.task);
      showToast('Task accepted! You can now follow the route.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not accept task.', 'error');
    } finally {
      setAccepting(false);
    }
  };

  if (loading || !task) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <CardSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-5 pb-28">
      <Link to="/employee/tasks" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" />
        Back to My Tasks
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-slate-900 font-mono">Task #{task.id}</h1>
          <TaskStatusText status={task.status} />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700 tabular-nums">
          <span>
            Distance: <strong className="font-mono text-slate-900">{formatDistance(task.totalDistanceMeters)}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Est. time: <strong className="font-mono text-slate-900">{formatDuration(task.estimatedTimeSeconds)}</strong>
          </span>
        </div>

        <div className="text-xs text-slate-500">Assigned {formatDateTime(task.createdAt)}</div>

        {task.note && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
            <span className="font-semibold">Admin note: </span>
            {task.note}
          </div>
        )}
      </div>

      {/* Small Route Preview */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-xs font-semibold text-slate-500">Route Map Preview</div>
        <RouteMap
          startLat={task.startLat}
          startLng={task.startLng}
          startLabel="Start"
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
          heightClass="h-56"
        />
      </div>

      {/* Ordered Bin Stops */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Ordered Stops ({task.stops.length})
        </h2>
        <ol className="divide-y divide-slate-100">
          {task.stops.map((st) => {
            const done = Boolean(st.collectedAt);
            return (
              <li key={st.taskBinId} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold text-white shrink-0 ${
                      done ? 'bg-emerald-600' : 'bg-slate-900'
                    }`}
                  >
                    {st.stopOrder}
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-slate-900">{st.binId}</div>
                    <div className="text-sm text-slate-700 truncate">{st.label}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {done ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      Collected
                    </span>
                  ) : (
                    <span className="font-mono text-xs font-semibold text-slate-600">
                      {Math.round(st.fillAtAssignment ?? 0)}% fill
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Thumb-friendly Sticky Bottom Actions */}
      {task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && (
        <div className="fixed bottom-16 lg:bottom-4 left-0 right-0 lg:left-64 px-4 py-3 bg-white/95 backdrop-blur-md border-t border-slate-200 z-20">
          <div className="mx-auto max-w-3xl flex gap-3">
            {task.status === 'ASSIGNED' && (
              <button
                type="button"
                disabled={accepting}
                onClick={handleAccept}
                className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {accepting ? 'Accepting...' : 'Accept Task'}
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(`/employee/tasks/${task.id}/route`)}
              className="flex-1 min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Navigation className="w-4 h-4" />
              View Route
            </button>
            {task.status === 'ACCEPTED' && (
              <button
                type="button"
                onClick={() => navigate(`/employee/tasks/${task.id}/complete`)}
                className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Complete Task
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
