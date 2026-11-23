import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../components/UI';

function makeSecureTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('') + '9a';
}

export const AdminEmployeeFormPage: React.FC = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => (isEdit ? '' : makeSecureTempPassword()));
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await api.listEmployees();
        const emp = res.employees.find((e) => e.id === Number(id));
        if (!emp) {
          showToast('Employee not found.', 'error');
          navigate('/admin/employees');
          return;
        }
        setName(emp.name);
        setMobile(emp.mobile);
        setEmail(emp.email);
        setStatus(emp.status);
      } catch {
        showToast('Failed to load employee.', 'error');
      }
    })();
  }, [id, isEdit, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit) {
        await api.updateEmployee(Number(id), {
          name: name.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          status,
        });
        showToast('Employee updated.', 'success');
      } else {
        await api.createEmployee({
          name: name.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          password,
          status,
        });
        showToast('Employee account created.', 'success');
      }
      navigate('/admin/employees', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6 lg:p-8 space-y-5">
      <Link to="/admin/employees" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" />
        Back to Employees
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          {isEdit ? 'Edit Employee' : 'Add Employee'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Employees are automatically assigned to your area and log in with these credentials.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="emp-name">
              Full name
            </label>
            <input
              id="emp-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rohan Patil"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="emp-mobile">
              Mobile number
            </label>
            <input
              id="emp-mobile"
              type="tel"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+91 9822001122"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="emp-email">
              Email address
            </label>
            <input
              id="emp-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rohan@city.gov"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm"
            />
          </div>

          {!isEdit && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-700" htmlFor="emp-pwd">
                  Temporary password
                </label>
                <button
                  type="button"
                  onClick={() => setPassword(makeSecureTempPassword())}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" />
                  Generate
                </button>
              </div>
              <input
                id="emp-pwd"
                type="text"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 font-mono text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">Share this temporary password with the employee for initial login.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="emp-status">
              Account status
            </label>
            <select
              id="emp-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="ACTIVE">Active (can log in)</option>
              <option value="INACTIVE">Inactive (login blocked)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Employee Account'}
          </button>
        </form>
      </div>
    </div>
  );
};
