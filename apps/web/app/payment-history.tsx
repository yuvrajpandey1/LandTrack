'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Wallet } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type PaymentRecord = {
  id: string;
  providerOrderId: string;
  provider: string;
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
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const refreshPayments = () => request<PaymentRecord[]>('payments').then((result) => {
      if (active) setPayments(result);
      return result;
    });
    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get('razorpay_payment_link_status') ?? query.get('payment');
    const clearCallbackQuery = () => window.history.replaceState({}, '', window.location.pathname);
    let loadingRequest: Promise<PaymentRecord[]>;

    if (paymentStatus?.toLowerCase() === 'paid') {
      const callback = {
        razorpay_payment_id: query.get('razorpay_payment_id'),
        razorpay_payment_link_id: query.get('razorpay_payment_link_id'),
        razorpay_payment_link_reference_id: query.get('razorpay_payment_link_reference_id'),
        razorpay_payment_link_status: query.get('razorpay_payment_link_status'),
        razorpay_signature: query.get('razorpay_signature')
      };
      if (Object.values(callback).some((value) => !value)) {
        setError('Razorpay returned an incomplete payment confirmation. Your payment status will update after provider verification.');
        loadingRequest = refreshPayments();
        clearCallbackQuery();
      } else {
        loadingRequest = request<{ status: string; receiptNo: string }>('payments/verify-link', {
          method: 'POST',
          body: JSON.stringify(callback)
        })
          .then((result) => {
            if (!active) return;
            setNotice(`Payment successful. Your property registration has been submitted for review. Receipt: ${result.receiptNo}.`);
            return refreshPayments();
          })
          .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); })
          .then((result) => result ?? []);
        clearCallbackQuery();
      }
    } else if (paymentStatus === 'success' && query.get('provider') === 'fake') {
      const orderId = query.get('orderId');
      if (!orderId) {
        setError('The sandbox payment confirmation is missing its order reference.');
        loadingRequest = refreshPayments();
      } else {
        loadingRequest = refreshPayments().then((result) => {
          if (!active) return result;
          const payment = result.find((item) => item.providerOrderId === orderId && item.status === 'SUCCESS');
          if (payment) setNotice(`Payment successful. Your property registration has been submitted for review. Receipt: ${payment.receiptNo ?? 'confirmed'}.`);
          else setError('The sandbox payment could not be confirmed. Check the payment status and try again.');
          return result;
        });
      }
      clearCallbackQuery();
    } else if (paymentStatus) {
      setError('Payment was not completed. You can retry from the property registration page.');
      clearCallbackQuery();
      loadingRequest = refreshPayments();
    } else {
      loadingRequest = refreshPayments();
    }

    void loadingRequest
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); return []; })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);

  return (
    <>
      <section className="card table-card">
        <div className="table-toolbar"><div><h2>Registration payments</h2><p>Payment status is confirmed by Razorpay or the configured local test provider.</p></div></div>
        {notice && <div className="success-panel" role="status"><span><Wallet size={20} /></span><div><h2>Payment confirmed</h2><p>{notice}</p></div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <p className="empty-cell">Loading payment records…</p> : (
          <div className="table-scroll"><table><thead><tr><th>PROPERTY</th><th>AMOUNT</th><th>CREATED</th><th>RECEIPT</th><th>STATUS</th></tr></thead><tbody>
            {payments.map((payment) => <tr key={payment.id}><td>{payment.property?.name ?? 'Property registration'}</td><td>{payment.currency} {Number(payment.amount).toFixed(2)}</td><td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(payment.createdAt))}</td><td>{payment.receiptNo ?? '—'}</td><td><span className={`status-badge ${payment.status === 'SUCCESS' ? 'status-green' : payment.status === 'FAILED' ? 'status-red' : 'status-amber'}`}><span />{statusNames[payment.status]}</span></td></tr>)}
            {payments.length === 0 && <tr><td colSpan={5} className="empty-cell">No payment records yet.</td></tr>}
          </tbody></table></div>
        )}
        <div className="table-footer"><span>{payments.length} payment records</span>{payments.some((payment) => payment.status === 'FAILED') && <Link href="/app/properties" className="text-action">Return to properties<ArrowRight size={14} /></Link>}</div>
      </section>
      <aside className="card next-appointment payment-note"><Wallet size={20} /><h2>Razorpay Standard Checkout</h2><p>Payment card details are collected securely by Razorpay and are not stored by the NRI Land Tracking System.</p></aside>
    </>
  );
}
