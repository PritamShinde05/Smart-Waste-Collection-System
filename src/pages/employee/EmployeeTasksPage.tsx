import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, ChevronRight, ClipboardList } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import {
  CardSkeleton,
  EmptyState,
  TaskStatusText,
  formatDateTime,
  formatDistance,
  formatDuration,
  useToast,
} from '../../components/UI';
import type { TaskSummary } from '../../types';

const EMP_TABS = [
  { key: 'ASSIGNED', label: 'New' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'COMPLETED', label: 'Completed' },
];

export const EmployeeTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe, refreshNotificationsCount } = useRealtime();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState(searchParams.get('tab') || 'ASSIGNED');
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertBanner, setAlertBanner] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.listMyTasks(tab);
      setTasks(res.tasks);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    loadTasks();
    api.markAllNotificationsRead().then(() => refreshNotificationsCount()).catch(() => {});
  }, [loadTasks, refreshNotificationsCount]);

  useEffect(() => {
    return subscribe((event, payload) => {
      if (event === 'task:assigned') {
        setAlertBanner(payload?.id ? `New collection task #${payload.id} assigned to you.` : 'New task assigned.');
        showToast('New collection task assigned!', 'info');
        loadTasks();
      } else if (event === 'task:updated' || event === 'sync:reconnect' || event === 'sync:poll') {
        loadTasks();
      }
    });
  }, [subscribe, loadTasks, showToast]);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">My Tasks</h1>
        <p className="mt-0.5 text-sm text-slate-600">Review assigned routes, accept tasks, and mark pickups.</p>
      </div>

      {alertBanner && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-medium">{alertBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setAlertBanner(null);
              setTab('ASSIGNED');
              setSearchParams({ tab: 'ASSIGNED' });
            }}
            className="text-xs font-semibold text-emerald-800 underline shrink-0"
          >
            View
          </button>
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1">
        {EMP_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setSearchParams({ tab: t.key });
            }}
            className={`min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <CardSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-5 h-5" />}
          title={`No ${tab.toLowerCase()} tasks`}
          description={
            tab === 'ASSIGNED'
              ? 'New tasks assigned by your area admin will appear here immediately.'
              : tab === 'ACCEPTED'
              ? 'Accept an assigned task to begin navigation.'
              : 'Completed collection tasks will be recorded here.'
          }
        />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => navigate(`/employee/tasks/${task.id}`)}
              className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 hover:border-emerald-300 transition-colors flex items-center justify-between gap-3 min-h-[84px]"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-slate-900">Task #{task.id}</span>
                  <TaskStatusText status={task.status} />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                  <span>
                    {task.collectedCount}/{task.binCount} bins
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{formatDistance(task.totalDistanceMeters)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{formatDuration(task.estimatedTimeSeconds)}</span>
                </div>

                <div className="text-xs text-slate-400">Assigned {formatDateTime(task.createdAt)}</div>
              </div>

              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
