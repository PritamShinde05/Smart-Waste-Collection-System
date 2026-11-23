import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Info, Navigation } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import { RouteMap } from '../../components/MapComponents';
import { CardSkeleton, EmptyState, formatDistance, useToast } from '../../components/UI';
import type { TaskDetail } from '../../types';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const EmployeeRoutePage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { subscribe } = useRealtime();
  const { showToast } = useToast();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [gpsLocation, setGpsLocation] = useState<[number, number] | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'requesting' | 'active' | 'denied'>('requesting');
  const [markingId, setMarkingId] = useState<number | null>(null);

  const loadTargetTask = useCallback(async () => {
    try {
      let targetId = id ? Number(id) : null;
      if (!targetId) {
        const accepted = await api.listMyTasks('ACCEPTED');
        if (accepted.tasks.length > 0) {
          targetId = accepted.tasks[0].id;
        } else {
          const assigned = await api.listMyTasks('ASSIGNED');
          if (assigned.tasks.length > 0) targetId = assigned.tasks[0].id;
        }
      }
      if (!targetId) {
        setTask(null);
        return;
      }
      const res = await api.getMyTaskDetail(targetId);
      setTask(res.task);
    } catch {
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTargetTask();
  }, [loadTargetTask]);

  useEffect(() => {
    return subscribe((event, payload) => {
      if (
        (event.startsWith('task:') && (!task || payload?.id === task.id)) ||
        event === 'sync:reconnect' ||
        event === 'sync:poll'
      ) {
        loadTargetTask();
      }
    });
  }, [subscribe, task, loadTargetTask]);

  // Live GPS tracking while Route screen is open
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('denied');
      return;
    }

    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsLocation([lat, lng]);
        setGpsStatus('active');

        const now = Date.now();
        if (now - lastSent > 10_000) {
          lastSent = now;
          api.updateMyLocation(lat, lng).catch(() => {});
        }
      },
      () => {
        setGpsStatus('denied');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const nextStop = useMemo(() => {
    if (!task) return null;
    return task.stops.find((s) => !s.collectedAt) || null;
  }, [task]);

  const allCollected = Boolean(task && task.stops.length > 0 && task.stops.every((s) => Boolean(s.collectedAt)));

  const distToNext = useMemo(() => {
    if (!nextStop || !gpsLocation) return null;
    return haversineMeters(gpsLocation[0], gpsLocation[1], nextStop.latitude, nextStop.longitude);
  }, [nextStop, gpsLocation]);

  const handleMarkCollected = async () => {
    if (!task || !nextStop) return;
    setMarkingId(nextStop.taskBinId);
    try {
      const res = await api.markBinCollected(task.id, nextStop.taskBinId);
      setTask(res.task);
      showToast(`Stop #${nextStop.stopOrder} (${nextStop.binId}) marked collected.`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Could not mark bin collected.', 'error');
    } finally {
      setMarkingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <CardSkeleton rows={6} />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <EmptyState
          icon={<Navigation className="w-5 h-5" />}
          title="No active route"
          description="Accept an assigned task in My Tasks to start turn-by-turn collection navigation."
          action={
            <Link
              to="/employee/tasks"
              className="min-h-[48px] inline-flex items-center justify-center rounded-xl bg-emerald-600 px-6 text-sm font-semibold text-white"
            >
              Go to My Tasks
            </Link>
          }
        />
      </div>
    );
  }

  const externalMapsUrl = nextStop
    ? `https://www.google.com/maps/dir/?api=1&destination=${nextStop.latitude},${nextStop.longitude}`
    : null;

  return (
    <div className="relative h-[calc(100vh-7.25rem)] lg:h-[calc(100vh-4rem)] w-full flex flex-col">
      {/* GPS Explanation Banner if permission denied */}
      {gpsStatus === 'denied' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0 text-amber-700" />
          <span>Enable location permission in your browser to see your live GPS dot on the route map.</span>
        </div>
      )}

      {/* Full-screen Map */}
      <div className="flex-1 relative">
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
            isNext: nextStop?.taskBinId === st.taskBinId,
          }))}
          routeGeometry={task.routeGeometry}
          employeeLocation={gpsLocation}
          heightClass="h-full rounded-none border-0"
        />

        {/* Top floating link to Task Detail */}
        <div className="absolute top-3 right-3 z-10">
          <Link
            to={`/employee/tasks/${task.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-white min-h-[40px]"
          >
            Task #{task.id} Details
          </Link>
        </div>
      </div>

      {/* Bottom Sheet for Next Stop & One-Handed Actions */}
      <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6 rounded-t-3xl shadow-xl z-10">
        <div className="mx-auto max-w-2xl space-y-3">
          {allCollected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>All {task.stops.length} bins collected!</span>
              </div>
              {task.status === 'ACCEPTED' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/employee/tasks/${task.id}/complete`)}
                  className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Complete Task
                </button>
              ) : (
                <Link
                  to={`/employee/tasks/${task.id}`}
                  className="w-full min-h-[48px] inline-flex items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white"
                >
                  Back to Task Detail
                </Link>
              )}
            </div>
          ) : nextStop ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-500 tabular-nums">
                    Next Stop #{nextStop.stopOrder} of {task.stops.length}
                    {distToNext !== null && ` · ${formatDistance(distToNext)} away`}
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-slate-900">{nextStop.binId}</div>
                  <div className="text-sm font-medium text-slate-700 truncate">{nextStop.label}</div>
                </div>

                {externalMapsUrl && (
                  <a
                    href={externalMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 shrink-0"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Maps App
                  </a>
                )}
              </div>

              {task.status === 'ASSIGNED' ? (
                <button
                  type="button"
                  onClick={() => navigate(`/employee/tasks/${task.id}`)}
                  className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Accept Task First to Collect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={markingId === nextStop.taskBinId}
                  onClick={handleMarkCollected}
                  className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {markingId === nextStop.taskBinId ? 'Saving...' : `Mark ${nextStop.binId} Collected`}
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
