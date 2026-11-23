import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { CardSkeleton, useToast } from '../../components/UI';
import type { TaskDetail } from '../../types';

export const EmployeeCompleteTaskPage: React.FC = () => {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [completionNote, setCompletionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getMyTaskDetail(taskId);
        setTask(res.task);
      } catch (err: any) {
        showToast(err.message || 'Could not load task.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [taskId, showToast]);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.completeTask(taskId, completionNote.trim() || undefined);
      showToast(`Task #${taskId} marked completed.`, 'success');
      navigate('/employee/tasks?tab=COMPLETED', { replace: true });
    } catch (err: any) {
      showToast(err.message || 'Could not complete task.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !task) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <CardSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-5">
      <Link to={`/employee/tasks/${task.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" />
        Back to Task Detail
      </Link>

      <form onSubmit={handleConfirm} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Complete Task #{task.id}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Confirm that all assigned bins have been emptied. The area dashboard and bin statuses will update live.
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-500">Bins Summary ({task.stops.length})</div>
          {task.stops.map((st) => (
            <div key={st.taskBinId} className="flex items-center justify-between text-sm">
              <span>
                <strong className="font-mono">{st.binId}</strong> · {st.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {st.collectedAt ? 'Collected' : 'Will mark collected'}
              </span>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="comp-note">
            Optional completion note (e.g. damaged lid, blocked access)
          </label>
          <textarea
            id="comp-note"
            rows={3}
            value={completionNote}
            onChange={(e) => setCompletionNote(e.target.value)}
            placeholder="Add any field observations for the admin..."
            className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Completing Task...' : 'Confirm Completion'}
        </button>
      </form>
    </div>
  );
};
