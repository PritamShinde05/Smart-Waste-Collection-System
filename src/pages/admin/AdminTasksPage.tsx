import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import {
  CardSkeleton,
  ConfirmDialog,
  EmptyState,
  TaskStatusText,
  formatDateTime,
  formatDistance,
  formatDuration,
  useToast,
} from '../../components/UI';
import type { TaskSummary } from '../../types';

const TABS = [
  { key: 'ASSIGNED', label: 'Pending' },
  { key: 'ACCEPTED', label: 'In Progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'ALL', label: 'All' },
];

export const AdminTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState(searchParams.get('status') || 'ASSIGNED');
  const employeeFilter = searchParams.get('employeeId') ? Number(searchParams.get('employeeId')) : undefined;
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<TaskSummary | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const res = await api.listTasks({ status: tab, employeeId: employeeFilter });
      setTasks(res.tasks);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tab, employeeFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.startsWith('task:') || event === 'sync:reconnect' || event === 'sync:poll') {
        loadTasks();
      }
    });
  }, [subscribe, loadTasks]);

  const handleTabChange = (nextTab: string) => {
    setTab(nextTab);
    const nextParams: Record<string, string> = { status: nextTab };
    if (employeeFilter) nextParams.employeeId = String(employeeFilter);
    setSearchParams(nextParams);
  };

  const handleCancelTask = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancelTask(cancelTarget.id);
      showToast(`Task #${cancelTarget.id} cancelled.`, 'success');
      setCancelTarget(null);
      loadTasks();
    } catch (err: any) {
      showToast(err.message || 'Could not cancel task.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Collection Tasks</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Monitor assigned routes, acceptance status, and live collection progress.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin/tasks/new')}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create Task
        </button>
      </div>

      {/* Tabs + Clear Employee Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabChange(t.key)}
              className={`min-h-[38px] rounded-lg px-4 text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {employeeFilter && (
          <button
            type="button"
            onClick={() => setSearchParams({ status: tab })}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Filtered by employee #{employeeFilter} · Clear filter
          </button>
        )}
      </div>

      {loading ? (
        <CardSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-5 h-5" />}
          title="No tasks in this view"
          description="Create a new collection task to assign overflowing bins to a field employee."
          action={
            <button
              type="button"
              onClick={() => navigate('/admin/tasks/new')}
              className="min-h-[44px] rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Create Collection Task
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4 hover:border-slate-300 transition-colors"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-slate-900">Task #{task.id}</span>
                  <TaskStatusText status={task.status} />
                </div>

                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {task.assignedTo?.name || 'Unassigned'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                    <span>
                      {task.collectedCount}/{task.binCount} bins collected
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{formatDistance(task.totalDistanceMeters)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{formatDuration(task.estimatedTimeSeconds)}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-2.5 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>Created: {formatDateTime(task.createdAt)}</div>
                  <div>
                    {task.completedAt
                      ? `Completed: ${formatDateTime(task.completedAt)}`
                      : task.acceptedAt
                      ? `Accepted: ${formatDateTime(task.acceptedAt)}`
                      : 'Awaiting acceptance'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => navigate(`/admin/tasks/${task.id}`)}
                  className="flex-1 min-h-[44px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  View Task Detail
                </button>
                {(task.status === 'ASSIGNED' || task.status === 'ACCEPTED') && (
                  <button
                    type="button"
                    onClick={() => setCancelTarget(task)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel Task #${cancelTarget?.id}?`}
        description="The assigned employee will be notified immediately that this collection task is cancelled."
        confirmLabel="Cancel Task"
        destructive
        busy={cancelling}
        onConfirm={handleCancelTask}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
};
