import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
} from 'recharts';
import { Plus, Radio, Users } from 'lucide-react';
import { api } from '../../services/api';
import { useRealtime } from '../../context/RealtimeContext';
import { CardSkeleton, EmptyState } from '../../components/UI';
import type { DashboardSummary, Employee, Sensor } from '../../types';

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe } = useRealtime();

  const [days, setDays] = useState<number>(7);
  const [selectedSensorId, setSelectedSensorId] = useState<number | ''>('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | ''>('');

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trendSensorId, setTrendSensorId] = useState<number | ''>('');
  const [fillTrend, setFillTrend] = useState<{
    sensor: { id: number; binId: string; label: string } | null;
    points: Array<{ fillPercent: number; recordedAt: string }>;
  }>({ sensor: null, points: [] });
  const [collections, setCollections] = useState<Array<{ day: string; count: number }>>([]);
  const [employeeStats, setEmployeeStats] = useState<
    Array<{ employeeId: number; name: string; completedCount: number; openCount: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const sFilter = selectedSensorId ? Number(selectedSensorId) : undefined;
      const eFilter = selectedEmployeeId ? Number(selectedEmployeeId) : undefined;
      const [sumRes, senRes, empRes, colRes, empStatRes] = await Promise.all([
        api.getDashboardSummary({ sensorId: sFilter, employeeId: eFilter }),
        api.listSensors(),
        api.listEmployees(),
        api.getCollectionsStats({ days, sensorId: sFilter, employeeId: eFilter }),
        api.getEmployeeStats({ days, employeeId: eFilter }),
      ]);

      setSummary(sumRes);
      setSensors(senRes.sensors);
      setEmployees(empRes.employees);
      setCollections(colRes.collections);
      setEmployeeStats(empStatRes.employees);

      const targetTrendId = trendSensorId ? Number(trendSensorId) : sFilter;
      const trendRes = await api.getFillTrends({ sensorId: targetTrendId, days });
      setFillTrend(trendRes);
    } catch {
      // handled gracefully by keeping last state
    } finally {
      setLoading(false);
    }
  }, [days, selectedSensorId, selectedEmployeeId, trendSensorId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    return subscribe((event) => {
      if (
        event.startsWith('sensor:') ||
        event.startsWith('task:') ||
        event === 'area:updated' ||
        event === 'employee:updated' ||
        event === 'sync:reconnect' ||
        event === 'sync:poll'
      ) {
        loadAll();
      }
    });
  }, [subscribe, loadAll]);

  if (loading && !summary) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardSkeleton key={i} rows={1} />
          ))}
        </div>
      </div>
    );
  }

  const cards = summary?.cards || {
    totalBins: 0,
    fullBins: 0,
    mediumBins: 0,
    normalBins: 0,
    offlineSensors: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    completedToday: 0,
    completedTasks: 0,
    cancelledTasks: 0,
    employeeCount: 0,
  };

  const summaryItems = [
    { label: 'Total bins', value: cards.totalBins, to: '/admin/sensors', accent: 'text-slate-900' },
    { label: 'Full bins', value: cards.fullBins, to: '/admin/map?status=FULL', accent: 'text-red-600' },
    { label: 'Medium bins', value: cards.mediumBins, to: '/admin/map?status=MEDIUM', accent: 'text-amber-600' },
    { label: 'Normal bins', value: cards.normalBins, to: '/admin/map?status=NORMAL', accent: 'text-emerald-600' },
    { label: 'Offline sensors', value: cards.offlineSensors, to: '/admin/sensors?status=OFFLINE', accent: 'text-slate-600' },
    { label: 'Pending tasks', value: cards.pendingTasks, to: '/admin/tasks?status=ASSIGNED', accent: 'text-amber-700' },
    { label: 'Tasks in progress', value: cards.inProgressTasks, to: '/admin/tasks?status=ACCEPTED', accent: 'text-sky-700' },
    { label: 'Completed today', value: cards.completedToday, to: '/admin/tasks?status=COMPLETED', accent: 'text-emerald-700' },
  ];

  const binSplitNonZero = (summary?.binStatusSplit || []).filter((x) => x.value > 0);
  const taskSplitNonZero = (summary?.taskStatusSplit || []).filter((x) => x.value > 0);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Area Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Live bin capacity, sensor health, and collection task throughput.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin/tasks/new')}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create Collection Task
        </button>
      </div>

      {/* Onboarding Empty State for new areas */}
      {cards.totalBins === 0 && cards.employeeCount === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6">
          <h2 className="font-display text-lg font-semibold text-slate-900">Set up your collection area</h2>
          <p className="mt-1 text-sm text-slate-600">
            Add your first bin sensor and field employee to begin tracking fill levels and dispatching routes.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/admin/sensors/new"
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Radio className="w-4 h-4" />
              Add First Sensor
            </Link>
            <Link
              to="/admin/employees/new"
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Users className="w-4 h-4" />
              Add First Employee
            </Link>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { label: '7d', val: 7 },
            { label: '30d', val: 30 },
            { label: '90d', val: 90 },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setDays(opt.val)}
              className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                days === opt.val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last {opt.label}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by bin"
          value={selectedSensorId}
          onChange={(e) => setSelectedSensorId(e.target.value ? Number(e.target.value) : '')}
          className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-600 focus:outline-none"
        >
          <option value="">All bins</option>
          {sensors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.binId} — {s.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by employee"
          value={selectedEmployeeId}
          onChange={(e) => setSelectedEmployeeId(e.target.value ? Number(e.target.value) : '')}
          className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-600 focus:outline-none"
        >
          <option value="">All employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </div>

      {/* 8 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {summaryItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.to)}
            className="text-left rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 hover:border-emerald-300 transition-colors min-h-[88px]"
          >
            <div className="text-xs font-medium text-slate-500">{item.label}</div>
            <div className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tabular-nums ${item.accent}`}>
              {item.value}
            </div>
          </button>
        ))}
      </div>

      {/* 6 Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Bin Status Distribution (Donut) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Bin Status Distribution</h2>
            <button
              type="button"
              onClick={() => navigate('/admin/map')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Open Live Map
            </button>
          </div>
          {binSplitNonZero.length === 0 ? (
            <EmptyState
              icon={<Radio className="w-5 h-5" />}
              title="No bins registered"
              description="Register sensors to view status distribution."
            />
          ) : (
            <div className="h-64 flex flex-col sm:flex-row items-center">
              <div className="w-full sm:w-2/3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={binSplitNonZero}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={3}
                      onClick={(entry) => navigate(`/admin/map?status=${String(entry.name).toUpperCase()}`)}
                      className="cursor-pointer"
                    >
                      {binSplitNonZero.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex sm:flex-col gap-3 sm:gap-2 text-xs">
                {(summary?.binStatusSplit || []).map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => navigate(`/admin/map?status=${item.name.toUpperCase()}`)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-700 font-medium">{item.name}</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">{item.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Chart 2: Current Fill Percentage by Bin (Highest first) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Current Fill % by Bin</h2>
            <span className="text-xs text-slate-500">Highest first · Click bar for detail</span>
          </div>
          {!summary || summary.binsByFill.length === 0 ? (
            <EmptyState
              icon={<Radio className="w-5 h-5" />}
              title="No bin readings yet"
              description="Current fill percentages will appear once sensors are added."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.binsByFill.slice(0, 10)} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="binId" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
                  <Tooltip formatter={(val: any) => [`${val}%`, 'Fill']} />
                  <Bar
                    dataKey="fillPercent"
                    radius={[6, 6, 0, 0]}
                    className="cursor-pointer"
                    onClick={(data: any) => {
                      if (data?.id) navigate(`/admin/sensors/${data.id}`);
                    }}
                  >
                    {summary.binsByFill.slice(0, 10).map((b) => (
                      <Cell
                        key={b.id}
                        fill={
                          b.status === 'FULL'
                            ? '#DC2626'
                            : b.status === 'MEDIUM'
                            ? '#D97706'
                            : b.status === 'OFFLINE'
                            ? '#94A3B8'
                            : '#16A34A'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Chart 3: Fill-level History of Selected Bin (Line) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Bin Fill-Level Trend</h2>
            <select
              aria-label="Select bin for trend chart"
              value={trendSensorId || fillTrend.sensor?.id || ''}
              onChange={(e) => setTrendSensorId(e.target.value ? Number(e.target.value) : '')}
              className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700"
            >
              {sensors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.binId} ({s.label})
                </option>
              ))}
            </select>
          </div>
          {fillTrend.points.length === 0 ? (
            <EmptyState
              icon={<Radio className="w-5 h-5" />}
              title="No historical readings"
              description="Readings sent by the bin sensor over time will plot here."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={fillTrend.points.map((p) => ({
                    ...p,
                    timeLabel: new Date(p.recordedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  }))}
                  margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="timeLabel" tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={24} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} unit="%" />
                  <Tooltip formatter={(val: any) => [`${val}%`, 'Fill']} />
                  <Line type="monotone" dataKey="fillPercent" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Chart 4: Collections per Day (Bar) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Bins Collected per Day</h2>
            <span className="text-xs text-slate-500">Last {days} days</span>
          </div>
          {collections.length === 0 ? (
            <EmptyState
              icon={<Radio className="w-5 h-5" />}
              title="No collections recorded yet"
              description="Completed bin stops will appear here daily."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={collections} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Bins Collected" fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Chart 5: Task Status Distribution (Donut) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Task Status Distribution</h2>
            <button
              type="button"
              onClick={() => navigate('/admin/tasks')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              View Tasks
            </button>
          </div>
          {taskSplitNonZero.length === 0 ? (
            <EmptyState
              icon={<Plus className="w-5 h-5" />}
              title="No tasks created yet"
              description="Assign a collection task to track progress."
            />
          ) : (
            <div className="h-64 flex flex-col sm:flex-row items-center">
              <div className="w-full sm:w-2/3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={taskSplitNonZero}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={3}
                      onClick={(entry) => {
                        const statusMap: Record<string, string> = {
                          Pending: 'ASSIGNED',
                          Accepted: 'ACCEPTED',
                          Completed: 'COMPLETED',
                        };
                        const name = String(entry?.name ?? '');
                        navigate(`/admin/tasks?status=${statusMap[name] || 'ALL'}`);
                      }}
                      className="cursor-pointer"
                    >
                      {taskSplitNonZero.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex sm:flex-col gap-3 sm:gap-2 text-xs">
                {(summary?.taskStatusSplit || []).map((item) => {
                  const statusMap: Record<string, string> = {
                    Pending: 'ASSIGNED',
                    Accepted: 'ACCEPTED',
                    Completed: 'COMPLETED',
                  };
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => navigate(`/admin/tasks?status=${statusMap[item.name] || 'ALL'}`)}
                      className="flex items-center gap-2 text-left hover:underline"
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-slate-700 font-medium">{item.name}</span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">{item.value}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Chart 6: Employee Collection Performance (Bar) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Employee Collection Performance</h2>
            <button
              type="button"
              onClick={() => navigate('/admin/employees')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
            >
              Manage Team
            </button>
          </div>
          {employeeStats.length === 0 ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title="No employees added yet"
              description="Add field employees to measure completed collection tasks."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={employeeStats} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="completedCount" name="Completed Tasks" fill="#059669" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
