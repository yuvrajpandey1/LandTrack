'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, MessageCircle, Video } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type Status = 'REQUESTED' | 'AGENT_ASSIGNED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED' | 'NO_SHOW';
type AppointmentRow = {
  id: string;
  status: Status;
  mode: 'AUDIO' | 'VIDEO' | 'SITE_VISIT';
  startUtc: string;
  endUtc: string;
  googleMeetUrl: string | null;
  property?: { id: string; name: string } | null;
  nri?: { id: string; name: string } | null;
  agent?: { id: string; name: string } | null;
  conversation?: { id: string } | null;
};
type AgentOption = { id: string; name: string; status: string; agentProfile: { approval: string } | null };
type SlotOption = { startUtc: string; localTime: string; istTime: string; available: boolean };

const statusLabel: Record<Status, string> = {
  REQUESTED: 'Requested', AGENT_ASSIGNED: 'Agent assigned', CONFIRMED: 'Confirmed', COMPLETED: 'Completed',
  CANCELLED: 'Cancelled', RESCHEDULED: 'Rescheduled', NO_SHOW: 'No-show'
};
const statusTone: Record<Status, string> = {
  REQUESTED: 'status-amber', AGENT_ASSIGNED: 'status-amber', CONFIRMED: 'status-green', COMPLETED: 'status-green',
  CANCELLED: 'status-red', RESCHEDULED: 'status-amber', NO_SHOW: 'status-red'
};
const modeLabel = { AUDIO: 'Audio call', VIDEO: 'Video call', SITE_VISIT: 'Site visit' };
const open: Status[] = ['REQUESTED', 'AGENT_ASSIGNED', 'CONFIRMED', 'RESCHEDULED'];

function message(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'The request could not be completed. Please try again.';
}

function isoDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function formatTimes(startUtc: string, zone?: string) {
  const start = new Date(startUtc);
  const local = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(start);
  const ist = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(start);
  return { local, ist };
}

export function AppointmentsList() {
  const { request, user } = useSession();
  const role = user?.role;
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [reschedule, setReschedule] = useState<{ id: string; date: string; slots: SlotOption[] } | null>(null);

  const load = useCallback(async () => {
    const result = await request<AppointmentRow[]>(role === 'ADMIN' ? 'admin/appointments' : 'appointments');
    setRows(result);
  }, [request, role]);

  useEffect(() => {
    let active = true;
    const tasks: Array<Promise<unknown>> = [load()];
    if (role === 'ADMIN') tasks.push(request<AgentOption[]>('admin/agents').then((result) => { if (active) setAgents(result); }));
    Promise.all(tasks)
      .catch((cause: unknown) => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, request, role]);

  const act = async (id: string, path: string, init: RequestInit | undefined, success: string) => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await request(`${path}`, init);
      setNotice(success);
      setReschedule(null);
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusyId('');
    }
  };

  const join = async (row: AppointmentRow) => {
    setBusyId(row.id);
    setError('');
    try {
      if (row.googleMeetUrl) {
        window.open(row.googleMeetUrl, '_blank', 'noopener');
      } else {
        const result = await request<{ roomUrl: string; token: string }>(`appointments/${row.id}/call-token`, { method: 'POST' });
        window.open(`${result.roomUrl}?jwt=${encodeURIComponent(result.token)}`, '_blank', 'noopener');
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusyId('');
    }
  };

  const pickDate = async (id: string, date: string) => {
    setReschedule({ id, date, slots: [] });
    try {
      const result = await request<{ slots: SlotOption[] }>(`slots?date=${encodeURIComponent(date)}&tz=${encodeURIComponent(user?.timeZone ?? 'Asia/Kolkata')}`);
      setReschedule({ id, date, slots: result.slots.filter((slot) => slot.available) });
    } catch (cause) {
      setError(message(cause));
    }
  };

  const visible = rows.filter((row) => filter === 'all' || open.includes(row.status));
  const canJoin = (row: AppointmentRow) => {
    if (row.mode === 'SITE_VISIT' || !['AGENT_ASSIGNED', 'CONFIRMED'].includes(row.status)) return false;
    const now = Date.now();
    return now >= new Date(row.startUtc).getTime() - 10 * 60_000 && now <= new Date(row.endUtc).getTime() + 60 * 60_000;
  };

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <div><h2>{role === 'ADMIN' ? 'All appointments' : 'My appointments'}</h2><p>Times are shown in your time zone and IST.</p></div>
        <div className="filter-pills" role="group" aria-label="Filter appointments">
          <button type="button" className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Upcoming</button>
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        {(role === 'NRI' || role === 'ADMIN') && <Link className="button button-primary" href={role === 'NRI' ? '/app/appointments/new' : '/admin/appointments/new'}><CalendarDays size={16} />Book appointment</Link>}
      </div>
      {notice && <p className="form-success" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="empty-cell">Loading appointments…</p> : visible.length === 0 ? <p className="empty-cell">No appointments to show.</p> : (
        <div className="appointment-list">
          {visible.map((row) => {
            const times = formatTimes(row.startUtc, user?.timeZone);
            const busy = busyId === row.id;
            const isOpen = open.includes(row.status);
            const chatHref = row.conversation ? `/${role === 'NRI' ? 'app' : role === 'AGENT' ? 'agent' : 'admin'}/${role === 'ADMIN' ? 'communications' : 'chat'}` : '';
            return (
              <article className="appointment-card" key={row.id}>
                <div className="appointment-main">
                  <div>
                    <h3>{row.property?.name ?? 'Property'}</h3>
                    <p>{modeLabel[row.mode]} · {times.local} <small>({times.ist} IST)</small></p>
                    <p className="appointment-people">
                      {role !== 'NRI' && <span>NRI: {row.nri?.name ?? '—'}</span>}
                      <span>Agent: {row.agent?.name ?? 'Not assigned yet'}</span>
                    </p>
                  </div>
                  <span className={`status-badge ${statusTone[row.status]}`}><span />{statusLabel[row.status]}</span>
                </div>
                <div className="appointment-actions">
                  {canJoin(row) && <button className="button button-primary" disabled={busy} onClick={() => { void join(row); }}><Video size={16} />Join call</button>}
                  {chatHref && isOpen && <Link className="button button-secondary" href={chatHref}><MessageCircle size={16} />Chat</Link>}
                  {role === 'ADMIN' && ['REQUESTED', 'AGENT_ASSIGNED'].includes(row.status) && (
                    <select aria-label="Assign agent" disabled={busy} value="" onChange={(event) => { if (event.target.value) void act(row.id, `admin/appointments/${row.id}/assign`, { method: 'POST', body: JSON.stringify({ agentId: event.target.value }) }, 'Agent assigned.'); }}>
                      <option value="">{row.agent ? 'Reassign agent…' : 'Assign agent…'}</option>
                      {agents.filter((agent) => agent.status === 'ACTIVE' && agent.agentProfile?.approval === 'APPROVED').map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                  )}
                  {(role === 'AGENT' || role === 'ADMIN') && row.status === 'AGENT_ASSIGNED' && <button className="button button-secondary" disabled={busy} onClick={() => { void act(row.id, `appointments/${row.id}/confirm`, { method: 'POST' }, 'Appointment confirmed.'); }}>Confirm</button>}
                  {(role === 'AGENT' || role === 'ADMIN') && row.status === 'CONFIRMED' && (
                    <>
                      <button className="button button-secondary" disabled={busy} onClick={() => { void act(row.id, `appointments/${row.id}/complete`, { method: 'POST' }, 'Appointment marked completed.'); }}>Mark completed</button>
                      <button className="button button-secondary" disabled={busy} onClick={() => { void act(row.id, `appointments/${row.id}/no-show`, { method: 'POST' }, 'Appointment marked as no-show.'); }}>No-show</button>
                    </>
                  )}
                  {(role === 'NRI' || role === 'ADMIN') && isOpen && row.status !== 'RESCHEDULED' && (
                    <>
                      <button className="button button-secondary" disabled={busy} onClick={() => { void pickDate(row.id, isoDate(1)); }}>Reschedule</button>
                      <button className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm('Cancel this appointment?')) void act(row.id, `appointments/${row.id}/cancel`, { method: 'POST' }, 'Appointment cancelled.'); }}>Cancel</button>
                    </>
                  )}
                </div>
                {reschedule?.id === row.id && (
                  <div className="reschedule-panel">
                    <label>New date<input type="date" min={isoDate(0)} value={reschedule.date} onChange={(event) => { void pickDate(row.id, event.target.value); }} /></label>
                    <div className="slot-list">
                      {reschedule.slots.length === 0 && <small>No free slots on this date.</small>}
                      {reschedule.slots.map((slot) => <button key={slot.startUtc} type="button" className="slot-button" disabled={busy} onClick={() => { void act(row.id, `appointments/${row.id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ startUtc: slot.startUtc }) }, 'Appointment rescheduled.'); }}>{slot.localTime}<small>{slot.istTime} IST</small></button>)}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
