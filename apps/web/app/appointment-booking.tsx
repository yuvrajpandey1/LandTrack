'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Check, Clock3 } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type PropertyOption = { id: string; name: string; status: string };
type SlotOption = { startUtc: string; localTime: string; istTime: string; available: boolean };
type AppointmentResult = { id: string; status: string; startUtc: string; mode: string };

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'The request could not be completed. Please try again.';
}

export function AppointmentBooking() {
  const { request } = useSession();
  const [date, setDate] = useState(todayInIndia);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [mode, setMode] = useState<'VIDEO' | 'AUDIO' | 'SITE_VISIT'>('VIDEO');
  const [appointment, setAppointment] = useState<AppointmentResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void request<{ items: PropertyOption[] }>('properties?page=1&pageSize=100')
      .then(({ items }) => {
        if (!active) return;
        const approved = items.filter((property) => property.status === 'APPROVED');
        setProperties(approved);
        if (approved[0]) setPropertyId(approved[0].id);
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    let active = true;
    setSelectedSlot('');
    void request<{ slots: SlotOption[] }>(`slots?date=${encodeURIComponent(date)}&tz=Asia%2FKolkata`)
      .then(({ slots: available }) => { if (active) setSlots(available.filter((slot) => slot.available)); })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [date, request]);

  const book = async () => {
    if (!propertyId || !selectedSlot) {
      setError('Select an approved property and an available time slot.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await request<AppointmentResult>('appointments', {
        method: 'POST',
        body: JSON.stringify({ propertyId, mode, startUtc: selectedSlot })
      });
      setAppointment(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (appointment) {
    return <section className="card success-card"><div className="success-panel"><span><Check size={22} /></span><div><h2>Appointment requested</h2><p>Your request is saved. The NRI Land Tracking System team will assign an agent and confirm the appointment.</p></div></div><div className="summary-item"><span>Reference</span><strong>{appointment.id}</strong></div><div className="summary-item"><span>Time (IST)</span><strong>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(appointment.startUtc))}</strong></div><div className="summary-item"><span>Mode</span><strong>{appointment.mode.replace('_', ' ')}</strong></div></section>;
  }

  return (
    <div className="appointment-grid">
      <section className="card appointment-card">
        <div><h2>Choose a date and time</h2><p>Times are shown in India Standard Time.</p></div>
        <div className="form-grid appointment-form-grid">
          <label className="form-field full"><span>Approved property</span><select required value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select an approved property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <label className="form-field"><span>Date</span><input type="date" min={todayInIndia()} required value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="form-field"><span>Appointment mode</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="VIDEO">Video call</option><option value="AUDIO">Audio call</option><option value="SITE_VISIT">Site visit</option></select></label>
        </div>
        <div className="slot-heading"><div><h3>Available time slots</h3><p>{date} · India Standard Time</p></div><span className="timezone-label"><Clock3 size={14} /> IST (UTC+5:30)</span></div>
        <div className="slot-list">{slots.map((slot) => <button type="button" key={slot.startUtc} className={`slot-button ${selectedSlot === slot.startUtc ? 'selected' : ''}`} onClick={() => setSelectedSlot(slot.startUtc)}>{slot.istTime}<small>{slot.localTime}</small></button>)}</div>
        {properties.length === 0 && <p className="form-help">Appointments can be booked once a property has been approved.</p>}
        {properties.length > 0 && slots.length === 0 && <p className="form-help">No appointment slots are available on this date. Choose another day.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={busy || !propertyId || !selectedSlot} onClick={() => { void book(); }}><CalendarDays size={17} />{busy ? 'Saving appointment…' : 'Request appointment'}</button>
      </section>
    </div>
  );
}
