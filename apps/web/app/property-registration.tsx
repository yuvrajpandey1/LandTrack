'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { ArrowRight, Check, ChevronLeft, FileText, Plus, ShieldCheck, X } from 'lucide-react';
import Image from 'next/image';
import { ApiError, useSession } from './session-provider';

type LocationOption = { id: string; name: string; districtId?: string; talukaId?: string };
type SelectedDocument = { file: File; uploaded: boolean };
type DemoOrder = { orderId: string; amount: number; currency: string };
type RegisteredProperty = {
  id: string;
  name: string;
  type: string;
  surveyNumber: string;
  state: string;
  city: string;
  area: string | number;
  areaUnit: string;
  ownership: string;
  intent: string;
  status: string;
  submittedAt?: string | null;
  address?: string | null;
  landmark?: string | null;
  district: { name: string };
  taluka: { name: string };
  village: { name: string };
  documents: Array<{ id: string; kind: string; mimeType: string; scanStatus: string }>;
};
type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal: { ondismiss: () => void };
};
type RazorpayInstance = {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

async function loadRazorpayCheckout(): Promise<NonNullable<Window['Razorpay']>> {
  if (!window.Razorpay) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Razorpay checkout could not be loaded. Check your internet connection and try again.'));
      document.body.appendChild(script);
    });
  }
  if (!window.Razorpay) throw new Error('Razorpay checkout did not initialize. Please try again.');
  return window.Razorpay;
}

const propertyTypes: Record<string, string> = {
  'Agricultural land': 'AGRICULTURAL',
  'Residential plot': 'RESIDENTIAL_PLOT',
  'Commercial property': 'COMMERCIAL',
  House: 'HOUSE',
  Apartment: 'APARTMENT'
};
const areaUnits: Record<string, string> = {
  acres: 'ACRE',
  guntas: 'GUNTA',
  'sq. yards': 'SQ_YARD',
  'sq. ft.': 'SQ_FT'
};
const ownershipTypes: Record<string, string> = {
  'Sole ownership': 'SOLE',
  'Joint ownership': 'JOINT',
  Inherited: 'INHERITED',
  Other: 'OTHER'
};
const intents: Record<string, string> = { 'Track only': 'TRACK_ONLY', Sell: 'SELL', Lease: 'LEASE', Rent: 'RENT' };
const propertyTypeNames: Record<string, string> = {
  AGRICULTURAL: 'Agricultural land',
  RESIDENTIAL_PLOT: 'Residential plot',
  COMMERCIAL: 'Commercial property',
  HOUSE: 'House',
  APARTMENT: 'Apartment'
};
const areaUnitNames: Record<string, string> = { ACRE: 'acres', GUNTA: 'guntas', SQ_YARD: 'sq. yards', SQ_FT: 'sq. ft.', SQ_METER: 'sq. meters' };
const ownershipNames: Record<string, string> = { SOLE: 'Sole ownership', JOINT: 'Joint ownership', INHERITED: 'Inherited', OTHER: 'Other' };
const intentNames: Record<string, string> = { TRACK_ONLY: 'Track only', SELL: 'Sell', LEASE: 'Lease', RENT: 'Rent' };

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'The request could not be completed. Please try again.';
}

export function PropertyRegistration() {
  const { request } = useSession();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [surveyNumber, setSurveyNumber] = useState('');
  const [city, setCity] = useState('Hyderabad');
  const [address, setAddress] = useState('');
  const [districts, setDistricts] = useState<LocationOption[]>([]);
  const [talukas, setTalukas] = useState<LocationOption[]>([]);
  const [villages, setVillages] = useState<LocationOption[]>([]);
  const [districtId, setDistrictId] = useState('');
  const [talukaId, setTalukaId] = useState('');
  const [villageId, setVillageId] = useState('');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState('acres');
  const [propertyType, setPropertyType] = useState('Agricultural land');
  const [ownership, setOwnership] = useState('Sole ownership');
  const [intent, setIntent] = useState('Track only');
  const [documents, setDocuments] = useState<SelectedDocument[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState('');
  const [isDemoPayment, setIsDemoPayment] = useState(false);
  const [demoReceiptOpen, setDemoReceiptOpen] = useState(false);
  const [demoOrder, setDemoOrder] = useState<DemoOrder | null>(null);
  const [confirmDemoExit, setConfirmDemoExit] = useState(false);
  const [registeredProperty, setRegisteredProperty] = useState<RegisteredProperty | null>(null);
  const [propertyImageUrl, setPropertyImageUrl] = useState('');
  const [localPhotoPreview, setLocalPhotoPreview] = useState('');
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const selectedDistrict = districts.find((district) => district.id === districtId)?.name ?? '';
  const selectedTaluka = talukas.find((taluka) => taluka.id === talukaId)?.name ?? '';
  const selectedVillage = villages.find((village) => village.id === villageId)?.name ?? '';
  const propertyPhoto = documents.find(({ file }) => file.type.startsWith('image/'))?.file;

  useEffect(() => {
    if (!propertyPhoto) {
      setLocalPhotoPreview('');
      return;
    }
    const url = URL.createObjectURL(propertyPhoto);
    setLocalPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [propertyPhoto]);

  const finishRegistration = async (receiptNo: string) => {
    setPaymentReceipt(receiptNo);
    setDetailsError('');
    try {
      const property = await request<RegisteredProperty>(`properties/${propertyId}`);
      setRegisteredProperty(property);
      const photo = property.documents.find((document) => document.scanStatus === 'CLEAN' && document.mimeType.startsWith('image/'));
      if (photo) {
        try {
          const result = await request<{ url: string }>(`properties/${property.id}/documents/${photo.id}/url`);
          setPropertyImageUrl(result.url);
        } catch (cause) {
          setDetailsError(`The plot was registered, but its saved photo could not be loaded: ${errorMessage(cause)}`);
        }
      }
    } catch (cause) {
      setDetailsError(`Payment is confirmed and the plot is registered, but its saved details could not be loaded: ${errorMessage(cause)}`);
    }
  };

  const confirmOrderAfterCheckoutDismissal = async (orderId: string) => {
    setBusy(true);
    setCheckingPayment(true);
    setError('');
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await request<{ status: string; receiptNo?: string }>('payments/confirm-order', {
          method: 'POST',
          body: JSON.stringify({ orderId })
        });
        if (result.status === 'SUCCESS' && result.receiptNo) {
          setError('');
          await finishRegistration(result.receiptNo);
          return;
        }
        if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      setError('Checkout was closed. Razorpay has not confirmed the payment yet. If you completed payment, check payment history again shortly for your receipt.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      setCheckingPayment(false);
    }
  };

  useEffect(() => {
    let active = true;
    void request<LocationOption[]>('masters/districts')
      .then((result) => {
        if (!active) return;
        setDistricts(result);
        const hyderabad = result.find((district) => district.name.toLowerCase() === 'hyderabad');
        if (hyderabad) setDistrictId(hyderabad.id);
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!districtId) {
      setTalukas([]);
      setTalukaId('');
      setVillages([]);
      setVillageId('');
      return;
    }
    let active = true;
    void request<LocationOption[]>(`masters/talukas?districtId=${encodeURIComponent(districtId)}`)
      .then((result) => { if (active) setTalukas(result); })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [districtId, request]);

  useEffect(() => {
    if (!talukaId) {
      setVillages([]);
      setVillageId('');
      return;
    }
    let active = true;
    void request<LocationOption[]>(`masters/villages?talukaId=${encodeURIComponent(talukaId)}`)
      .then((result) => { if (active) setVillages(result); })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [request, talukaId]);

  const createDraft = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>('properties', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type: propertyTypes[propertyType],
          surveyNumber,
          city,
          districtId,
          talukaId,
          villageId,
          ...(address.trim() ? { address: address.trim() } : {}),
          area: Number(area),
          areaUnit: areaUnits[unit],
          ownership: ownershipTypes[ownership],
          intent: intents[intent]
        })
      });
      setPropertyId(result.id);
      setStep(2);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const invalid = selected.find((file) => !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} is not a PDF, JPEG, or PNG file under 10 MB.`);
      event.target.value = '';
      return;
    }
    setError('');
    setDocuments((current) => [...current, ...selected.map((file) => ({ file, uploaded: false }))]);
    event.target.value = '';
  };

  const uploadDocuments = async () => {
    if (!propertyId || documents.length === 0) {
      setError('Choose at least one property document before continuing.');
      return;
    }
    if (!propertyPhoto) {
      setError('Add at least one JPG or PNG plot photo so it can be included with the registration.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = [...documents];
      for (let index = 0; index < next.length; index += 1) {
        const document = next[index];
        if (document.uploaded) continue;
        const presign = await request<{ documentId: string }>(`properties/${propertyId}/documents`, {
          method: 'POST',
          body: JSON.stringify({
            kind: document.file.type.startsWith('image/') ? 'PHOTO' : 'OTHER',
            mimeType: document.file.type,
            sizeBytes: document.file.size
          })
        });
        const scanned = await request<{ scanStatus: string }>(`properties/${propertyId}/documents/${presign.documentId}/upload`, {
          method: 'PUT',
          headers: { 'content-type': document.file.type },
          body: document.file
        });
        if (scanned.scanStatus !== 'CLEAN') throw new Error(`${document.file.name} did not pass security scanning.`);
        next[index] = { ...document, uploaded: true };
        setDocuments([...next]);
      }
      setStep(3);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const beginCheckout = async () => {
    if (!propertyId) {
      setError('Create a property draft before starting checkout.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const order = await request<{
        provider: 'fake' | 'razorpay';
        orderId: string;
        paymentId: string;
        keyId?: string;
        amount: number;
        currency: string;
        checkoutUrl?: string | null;
      }>(`properties/${propertyId}/submit`, { method: 'POST' });
      if (order.provider === 'fake') {
        if (!order.orderId || !Number.isSafeInteger(order.amount) || order.amount < 100) {
          throw new Error('The demo checkout returned an invalid order.');
        }
        setDemoOrder({ orderId: order.orderId, amount: order.amount, currency: order.currency });
        setConfirmDemoExit(false);
        return;
      }
      if (!order.orderId || !order.keyId || !Number.isSafeInteger(order.amount) || order.amount < 100) {
        throw new Error('The payment provider returned an invalid checkout order.');
      }
      const Razorpay = await loadRazorpayCheckout();
      let paymentCallbackReceived = false;
      const checkout = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'NRI Land Tracking System',
        description: `Registration payment for ${name}`,
        order_id: order.orderId,
        handler: async (response) => {
          paymentCallbackReceived = true;
          setBusy(true);
          setError('');
          try {
            const result = await request<{ status: string; receiptNo: string }>('payments/verify', {
              method: 'POST',
              body: JSON.stringify(response)
            });
            if (result.status !== 'SUCCESS') throw new Error('The payment could not be confirmed by the server.');
            await finishRegistration(result.receiptNo);
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            if (!paymentCallbackReceived) void confirmOrderAfterCheckoutDismissal(order.orderId);
          }
        }
      });
      checkout.on('payment.failed', (response) => {
        setBusy(false);
        setError(response.error?.description ?? 'Payment failed. Please check the details or try another payment method.');
      });
      checkout.open();
      setBusy(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmDemoExitAndRegister = async () => {
    if (!demoOrder) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ status: string; receiptNo: string; propertyId: string; demo: true }>('payments/demo-confirm-exit', {
        method: 'POST',
        body: JSON.stringify({ orderId: demoOrder.orderId })
      });
      if (result.status !== 'SUCCESS' || result.propertyId !== propertyId || !result.receiptNo || !result.demo) {
        throw new Error('The demo payment could not be confirmed for this plot.');
      }
      setIsDemoPayment(true);
      setConfirmDemoExit(false);
      setDemoOrder(null);
      await finishRegistration(result.receiptNo);
      setDemoReceiptOpen(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wizard-layout">
      <section className="card wizard-card">
        <div className="stepper">
          {['Land details', 'Documents', 'Review & pay'].map((label, index) => {
            const current = index + 1;
            return <div key={label} className={`stepper-item ${step === current ? 'current' : ''} ${step > current ? 'completed' : ''}`}><span>{step > current ? <Check size={14} /> : current}</span><small>{label}</small></div>;
          })}
        </div>
        {step === 1 && (
          <div className="wizard-content">
            <div><h2>Add land details</h2><p>Register a property located in one of the supported districts in Telangana.</p></div>
            <div className="form-grid">
              <label className="form-field full"><span>Property name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Green Valley Plot" /></label>
              <label className="form-field"><span>Property type</span><select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>{Object.keys(propertyTypes).map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="form-field"><span>Survey number</span><input required maxLength={80} value={surveyNumber} onChange={(event) => setSurveyNumber(event.target.value)} placeholder="e.g. 142/3A" /></label>
              <label className="form-field"><span>State</span><input value="Telangana" readOnly /></label>
              <label className="form-field"><span>City / town</span><input required maxLength={120} value={city} onChange={(event) => setCity(event.target.value)} placeholder="e.g. Hyderabad or Sangareddy" /></label>
              <label className="form-field"><span>District</span><select required value={districtId} onChange={(event) => { const nextDistrictId = event.target.value; setDistrictId(nextDistrictId); setCity(districts.find((item) => item.id === nextDistrictId)?.name === 'Hyderabad' ? 'Hyderabad' : ''); setTalukaId(''); setVillageId(''); }}><option value="">Select district</option>{districts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="form-field"><span>Taluka / Mandal</span><select required value={talukaId} onChange={(event) => { setTalukaId(event.target.value); setVillageId(''); }}><option value="">Select taluka / mandal</option>{talukas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="form-field"><span>Village</span><select required value={villageId} onChange={(event) => setVillageId(event.target.value)}><option value="">Select village</option>{villages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="form-field full"><span>Address / landmark <em>Optional</em></span><input maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, landmark or nearby location" /></label>
              <label className="form-field"><span>Land area</span><input type="number" min="0.01" max="1000000" step="0.01" required value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. 2.5" /></label>
              <label className="form-field"><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}>{Object.keys(areaUnits).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="form-field"><span>Ownership</span><select value={ownership} onChange={(event) => setOwnership(event.target.value)}>{Object.keys(ownershipTypes).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="form-field"><span>Purpose</span><select value={intent} onChange={(event) => setIntent(event.target.value)}>{Object.keys(intents).map((value) => <option key={value}>{value}</option>)}</select></label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="wizard-actions"><span className="muted">Step 1 of 3</span><button className="button button-primary" disabled={busy || !name.trim() || !surveyNumber.trim() || !city.trim() || !districtId || !talukaId || !villageId || !area || Number(area) <= 0} onClick={() => { void createDraft(); }}>{busy ? 'Saving…' : 'Continue'} <ArrowRight size={16} /></button></div>
          </div>
        )}
        {step === 2 && (
          <div className="wizard-content">
            <div><h2>Property documents and plot photo</h2><p>Upload at least one plot photo plus any sale deed or land record. PDF, JPG and PNG up to 10 MB.</p></div>
            <label className="upload-zone"><span className="upload-icon"><Plus size={20} /></span><strong>Choose files to upload</strong><small>Files are stored privately and scanned before they can be submitted.</small><input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={selectFiles} /></label>
            {documents.map(({ file, uploaded }, index) => <div className="file-row" key={`${file.name}-${file.lastModified}-${index}`}><FileText size={17} /><span>{file.name}</span><span className={uploaded ? 'file-clean' : 'file-pending'}>{uploaded ? 'Scanned and clean' : 'Ready to upload'}</span></div>)}
            <div className="upload-info"><ShieldCheck size={17} /><span>Uploads remain private. The API verifies file type and size, then scans each document for malware.</span></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="wizard-actions"><button className="button button-secondary" disabled={busy} onClick={() => setStep(1)}><ChevronLeft size={16} />Back</button><button className="button button-primary" disabled={busy || documents.length === 0 || !propertyPhoto} onClick={() => { void uploadDocuments(); }}>{busy ? 'Uploading and scanning…' : 'Upload and continue'}<ArrowRight size={16} /></button></div>
          </div>
        )}
        {step === 3 && paymentReceipt && (
          <div className="wizard-content">
            <div className="success-panel" role="status"><span><Check size={20} /></span><div><h2>Plot registration successful</h2><p>{isDemoPayment ? 'Demo payment confirmed — no money was collected.' : 'Payment confirmed.'} Your plot has been submitted for review. Receipt: {paymentReceipt}.</p></div></div>
            {detailsError && <p className="form-error" role="alert">{detailsError}</p>}
            <section className="card registered-property-card" aria-label="Registered plot details">
              <div className="registered-property-image">
                {(propertyImageUrl || localPhotoPreview) && !imageUnavailable && <Image
                  src={propertyImageUrl || localPhotoPreview}
                  alt={`Uploaded photo of ${registeredProperty?.name ?? name}`}
                  fill
                  sizes="(max-width: 700px) 100vw, 40vw"
                  unoptimized
                  onError={(event) => {
                    if (localPhotoPreview && propertyImageUrl && event.currentTarget.src !== localPhotoPreview) {
                      event.currentTarget.src = localPhotoPreview;
                    } else {
                      setImageUnavailable(true);
                    }
                  }}
                />}
                {imageUnavailable && <span><FileText size={28} />Plot photo is unavailable</span>}
                {!propertyImageUrl && !localPhotoPreview && <span><FileText size={28} />No plot photo uploaded</span>}
              </div>
              <div className="registered-property-details">
                <div className="registered-property-heading">
                  <div><span className="eyebrow">REGISTERED PLOT</span><h3>{registeredProperty?.name ?? name}</h3></div>
                  <span className="status-badge status-blue"><span />Under review</span>
                </div>
                <div className="registered-property-grid">
                  <div><span>Plot registration number</span><strong>LT-PLOT-{(registeredProperty?.id ?? propertyId).slice(0, 8).toUpperCase()}</strong></div>
                  <div><span>Survey number</span><strong>{registeredProperty?.surveyNumber ?? surveyNumber}</strong></div>
                  <div><span>Property type</span><strong>{propertyTypeNames[registeredProperty?.type ?? propertyTypes[propertyType]] ?? propertyType}</strong></div>
                  <div><span>District</span><strong>{registeredProperty?.district.name ?? selectedDistrict}</strong></div>
                  <div><span>Taluka / Mandal</span><strong>{registeredProperty?.taluka.name ?? selectedTaluka}</strong></div>
                  <div><span>Village</span><strong>{registeredProperty?.village.name ?? selectedVillage}</strong></div>
                  <div><span>City / State</span><strong>{registeredProperty ? `${registeredProperty.city}, ${registeredProperty.state}` : `${city}, Telangana`}</strong></div>
                  <div><span>Area</span><strong>{registeredProperty?.area ?? area} {areaUnitNames[registeredProperty?.areaUnit ?? areaUnits[unit]] ?? unit}</strong></div>
                  <div><span>Ownership</span><strong>{ownershipNames[registeredProperty?.ownership ?? ownershipTypes[ownership]] ?? ownership}</strong></div>
                  <div><span>Purpose</span><strong>{intentNames[registeredProperty?.intent ?? intents[intent]] ?? intent}</strong></div>
                  {(registeredProperty?.address ?? address) && <div className="registered-property-wide"><span>Address / landmark</span><strong>{[registeredProperty?.address ?? address, registeredProperty?.landmark].filter(Boolean).join(', ')}</strong></div>}
                  <div className="registered-property-wide"><span>Uploaded documents</span><strong>{documents.map(({ file }) => file.name).join(', ')}</strong></div>
                  <div><span>Registration receipt</span><strong>{paymentReceipt}</strong></div>
                </div>
              </div>
            </section>
            <div className="wizard-actions"><a className="button button-secondary" href="/app/payments">View payment receipt</a><a className="button button-primary" href="/app/properties">View my plots<ArrowRight size={16} /></a></div>
          </div>
        )}
        {step === 3 && !paymentReceipt && (
          <div className="wizard-content">
            <div><h2>Review and pay</h2><p>Confirm your property details before continuing to secure payment.</p></div>
            <div className="review-card"><div><span>Property</span><strong>{name}</strong></div><div><span>Survey number</span><strong>{surveyNumber}</strong></div><div><span>Location</span><strong>{selectedVillage}, {selectedTaluka}, {selectedDistrict}</strong></div><div><span>City / town</span><strong>{city}</strong></div><div><span>Property type</span><strong>{propertyType}</strong></div><div><span>Area</span><strong>{area} {unit}</strong></div><div><span>Ownership</span><strong>{ownership}</strong></div><div className="full"><span>Documents</span><strong>{documents.map(({ file }) => file.name).join(', ')}</strong></div></div>
            <div className="charge-row"><span>Registration payment</span><strong>Secure payment checkout</strong></div>
            <div className="upload-info"><ShieldCheck size={17} /><span>Razorpay verifies real payments when enabled. The local demo mode collects no money and lets you complete registration through the checkout exit confirmation.</span></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {checkingPayment && <div className="upload-info" role="status"><ShieldCheck size={17} /><span>Checking payment with Razorpay and loading your plot registration and receipt…</span></div>}
            <div className="wizard-actions"><button className="button button-secondary" disabled={busy} onClick={() => setStep(2)}><ChevronLeft size={16} />Back</button><button className="button button-primary" disabled={busy} onClick={() => { void beginCheckout(); }}>{busy ? 'Preparing secure checkout…' : 'Pay securely'}<ArrowRight size={16} /></button></div>
          </div>
        )}
      </section>
      <aside className="wizard-aside">
        <div className="aside-card"><span className="aside-icon"><ShieldCheck size={20} /></span><h3>Your property, protected</h3><p>Your information and property documents are private and visible only to you and authorized NRI Land Tracking System staff.</p></div>
        <div className="aside-card"><h3>Before you begin</h3><ul><li>Keep your survey number handy</li><li>Upload a readable ownership document</li><li>Confirm the property district, mandal and village</li></ul></div>
      </aside>
      {demoOrder && (
        <div className="demo-checkout-backdrop">
          <section className="demo-checkout" role="dialog" aria-modal="true" aria-labelledby="demo-checkout-title">
            <header className="demo-checkout-header">
              <span className="demo-checkout-brand"><span>N</span><strong>NRI Land Tracking System</strong></span>
              <h2 id="demo-checkout-title">Payment Options</h2>
              <button type="button" className="icon-button" aria-label="Close checkout" disabled={busy} onClick={() => setConfirmDemoExit(true)}><X size={20} /></button>
            </header>
            <div className="demo-checkout-body">
              <div className="demo-checkout-summary"><span>Price summary</span><strong>{demoOrder.currency} {(demoOrder.amount / 100).toFixed(2)}</strong><small>Registration for {name}</small></div>
              <div className="demo-checkout-message">
                <span className="demo-label">DEMO CHECKOUT</span>
                <h3>No payment will be collected</h3>
                <p>Close this checkout and choose <strong>Yes, exit</strong> to finish the demo registration and display a sample receipt with your plot details.</p>
              </div>
            </div>
            {confirmDemoExit && (
              <div className="demo-exit-backdrop">
                <section className="demo-exit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="demo-exit-title">
                  <button type="button" className="icon-button demo-exit-close" aria-label="Keep checkout open" disabled={busy} onClick={() => setConfirmDemoExit(false)}><X size={18} /></button>
                  <div className="demo-exit-illustration"><ArrowRight size={30} /></div>
                  <h2 id="demo-exit-title">Are you sure you want to exit?</h2>
                  <p>For this demo, choosing <strong>Yes, exit</strong> will confirm a sample payment and finish plot registration. No money will be collected.</p>
                  {error && <p className="form-error" role="alert">{error}</p>}
                  <button type="button" className="button button-secondary demo-exit-action" disabled={busy} onClick={() => setConfirmDemoExit(false)}>Continue to payment</button>
                  <button type="button" className="button button-primary demo-exit-action" disabled={busy} onClick={() => { void confirmDemoExitAndRegister(); }}>{busy ? 'Confirming demo…' : 'Yes, exit'}</button>
                </section>
              </div>
            )}
          </section>
        </div>
      )}
      {isDemoPayment && demoReceiptOpen && paymentReceipt && (
        <div className="demo-checkout-backdrop">
          <section className="demo-receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-receipt-title">
            <span className="demo-receipt-icon"><Check size={26} /></span>
            <span className="demo-label">DEMO RECEIPT</span>
            <h2 id="demo-receipt-title">Payment successful</h2>
            <p>Sample payment confirmed for your plot registration. No money was collected.</p>
            <div className="demo-receipt-number"><span>Receipt number</span><strong>{paymentReceipt}</strong></div>
            <button type="button" className="button button-primary demo-exit-action" onClick={() => setDemoReceiptOpen(false)}>Close and view plot registration</button>
          </section>
        </div>
      )}
    </div>
  );
}
