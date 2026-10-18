'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { ArrowRight, Check, ChevronLeft, FileText, Plus, ShieldCheck, Wallet } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type LocationOption = { id: string; name: string; districtId?: string; talukaId?: string };
type SelectedDocument = { file: File; uploaded: boolean };

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
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedDistrict = districts.find((district) => district.id === districtId)?.name ?? '';
  const selectedTaluka = talukas.find((taluka) => taluka.id === talukaId)?.name ?? '';
  const selectedVillage = villages.find((village) => village.id === villageId)?.name ?? '';

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
    setBusy(true);
    setError('');
    try {
      const next = [...documents];
      for (let index = 0; index < next.length; index += 1) {
        const document = next[index];
        if (document.uploaded) continue;
        const presign = await request<{ documentId: string }>(`properties/${propertyId}/documents`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'OTHER', mimeType: document.file.type, sizeBytes: document.file.size })
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
      setError('Create a property draft before requesting payment.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const order = await request<{ checkoutUrl: string }>(`properties/${propertyId}/submit`, { method: 'POST' });
      setCheckoutUrl(order.checkoutUrl);
      window.location.assign(order.checkoutUrl);
    } catch (cause) {
      setError(errorMessage(cause));
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
            <div><h2>Property documents</h2><p>Upload a sale deed, land record or property photo. PDF, JPG and PNG up to 10 MB.</p></div>
            <label className="upload-zone"><span className="upload-icon"><Plus size={20} /></span><strong>Choose files to upload</strong><small>Files are stored privately and scanned before they can be submitted.</small><input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={selectFiles} /></label>
            {documents.map(({ file, uploaded }, index) => <div className="file-row" key={`${file.name}-${file.lastModified}-${index}`}><FileText size={17} /><span>{file.name}</span><span className={uploaded ? 'file-clean' : 'file-pending'}>{uploaded ? 'Scanned and clean' : 'Ready to upload'}</span></div>)}
            <div className="upload-info"><ShieldCheck size={17} /><span>Uploads remain private. The API verifies file type and size, then scans each document for malware.</span></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="wizard-actions"><button className="button button-secondary" disabled={busy} onClick={() => setStep(1)}><ChevronLeft size={16} />Back</button><button className="button button-primary" disabled={busy || documents.length === 0} onClick={() => { void uploadDocuments(); }}>{busy ? 'Uploading and scanning…' : 'Upload and continue'}<ArrowRight size={16} /></button></div>
          </div>
        )}
        {step === 3 && (
          <div className="wizard-content">
            {checkoutUrl
              ? <div className="success-panel"><span><Check size={22} /></span><div><h2>Opening secure checkout</h2><p>You are being redirected to the payment provider.</p></div></div>
              : <div><h2>Review and pay</h2><p>Confirm your property details before continuing to hosted checkout.</p></div>}
            <div className="review-card"><div><span>Property</span><strong>{name}</strong></div><div><span>Survey number</span><strong>{surveyNumber}</strong></div><div><span>Location</span><strong>{selectedVillage}, {selectedTaluka}, {selectedDistrict}</strong></div><div><span>City / town</span><strong>{city}</strong></div><div><span>Property type</span><strong>{propertyType}</strong></div><div><span>Area</span><strong>{area} {unit}</strong></div><div><span>Ownership</span><strong>{ownership}</strong></div><div className="full"><span>Documents</span><strong>{documents.map(({ file }) => file.name).join(', ')}</strong></div></div>
            <div className="charge-row"><span>One-time registration charge</span><strong>Shown by the payment provider</strong></div>
            <div className="upload-info"><ShieldCheck size={17} /><span>Payment is handled by hosted checkout. The NRI Land Tracking System does not collect or store card details.</span></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="wizard-actions"><button className="button button-secondary" disabled={busy} onClick={() => setStep(2)}><ChevronLeft size={16} />Back</button><button className="button button-primary" disabled={busy || Boolean(checkoutUrl)} onClick={() => { void beginCheckout(); }}><Wallet size={16} />{busy ? 'Preparing checkout…' : 'Continue to secure payment'}</button></div>
          </div>
        )}
      </section>
      <aside className="wizard-aside">
        <div className="aside-card"><span className="aside-icon"><ShieldCheck size={20} /></span><h3>Your property, protected</h3><p>Your information and property documents are private and visible only to you and authorized NRI Land Tracking System staff.</p></div>
        <div className="aside-card"><h3>Before you begin</h3><ul><li>Keep your survey number handy</li><li>Upload a readable ownership document</li><li>Confirm the property district, mandal and village</li></ul></div>
      </aside>
    </div>
  );
}
