'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Wallet } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type PaymentRecord = {
  id: string;
  status: 'CREATED' | 'PENDING' | 'SUCCESS' | 'FAILED';
  amount: string | number;
  currency: string;
  receiptNo?: string | null;
  createdAt: string;
  paidAt?: string | null;
  property?: { id: string; name: string };
};

const statusNames: Record<PaymentRecord['status'], string> = {
  CREATED: 'Created',
  PENDING: 'Pending',
  SUCCESS: 'Paid',
  FAILED: 'Failed'
};

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'Unable to load your payment history.';
}

export function PaymentHistory() {
  const { request } = useSession();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void request<PaymentRecord[]>('payments')
      .then((result) => { if (active) setPayments(result); })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  return (
    <>
      <section className="card table-card">
        <div className="table-toolbar"><div><h2>Registration payments</h2><p>Payment status is confirmed by the payment provider webhook.</p></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <p className="empty-cell">Loading payment records…</p> : (
          <div className="table-scroll"><table><thead><tr><th>PROPERTY</th><th>AMOUNT</th><th>CREATED</th><th>RECEIPT</th><th>STATUS</th></tr></thead><tbody>
            {payments.map((payment) => <tr key={payment.id}><td>{payment.property?.name ?? 'Property registration'}</td><td>{payment.currency} {Number(payment.amount).toFixed(2)}</td><td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(payment.createdAt))}</td><td>{payment.receiptNo ?? '—'}</td><td><span className={`status-badge ${payment.status === 'SUCCESS' ? 'status-green' : payment.status === 'FAILED' ? 'status-red' : 'status-amber'}`}><span />{statusNames[payment.status]}</span></td></tr>)}
            {payments.length === 0 && <tr><td colSpan={5} className="empty-cell">No payment records yet.</td></tr>}
          </tbody></table></div>
        )}
        <div className="table-footer"><span>{payments.length} payment records</span>{payments.some((payment) => payment.status === 'FAILED') && <Link href="/app/properties" className="text-action">Return to properties<ArrowRight size={14} /></Link>}</div>
      </section>
      <aside className="card next-appointment payment-note"><Wallet size={20} /><h2>Secure hosted checkout</h2><p>Payment card details are collected by the payment provider and are not stored by the NRI Land Tracking System.</p></aside>
    </>
  );
}
