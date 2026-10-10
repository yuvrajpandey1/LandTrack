'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LandPlot, ShieldCheck } from 'lucide-react';
import { ApiError, useSession } from './session-provider';

type Country = { code: string; name: string };
type District = { id: string; name: string };

function AuthFrame({ children, title, description }: { children: React.ReactNode; title: string; description: string }) {
  return (
    <main className="auth-page">
      <Link href="/" className="brand auth-brand" aria-label="LandTrack home">
        <span className="brand-mark"><LandPlot size={21} strokeWidth={2.4} /></span>
        <span>LandTrack</span>
      </Link>
      <section className="card auth-card">
        <div className="auth-heading">
          <span className="agent-form-icon"><ShieldCheck size={20} /></span>
          <div><h1>{title}</h1><p>{description}</p></div>
        </div>
        {children}
      </section>
      <p className="auth-region">LandTrack · Hyderabad, Telangana</p>
    </main>
  );
}

function showError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : 'The request could not be completed. Please try again.';
}

function roleHome(role: string): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'AUDITOR') return '/audit';
  if (role === 'AGENT') return '/agent';
  return '/app';
}

export function LoginPage() {
  const router = useRouter();
  const { user, signIn, setupMfa, verifyMfa } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mfa, setMfa] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !mfa && !busy) router.replace(roleHome(user.role));
  }, [busy, mfa, router, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await signIn(email.trim(), password, totp || undefined);
      if (result.mfaSetupRequired) {
        setMfa(await setupMfa());
        return;
      }
      router.replace(roleHome(result.role));
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await verifyMfa(totp);
      if (user) router.replace(roleHome(user.role));
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={mfa ? 'Secure your account' : 'Sign in to LandTrack'} description={mfa ? 'Set up your authenticator before opening the workspace.' : 'Access your property and appointment workspace.'}>
      {mfa ? (
        <form className="auth-form" onSubmit={confirmMfa}>
          <div className="upload-info"><ShieldCheck size={17} /><span>Scan the authenticator link or enter this setup key in your authenticator app. Keep the key private.</span></div>
          <p className="mfa-secret">{mfa.secret}</p>
          <label className="form-field"><span>Authenticator code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={totp} onChange={(event) => setTotp(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}<ArrowRight size={16} /></button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="form-field"><span>Authenticator code <em>Required for Admin and Auditor accounts</em></span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={totp} onChange={(event) => setTotp(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
          <p className="auth-switch">New to LandTrack? <Link href="/register">Create an NRI account</Link></p>
          <p className="auth-switch">Local agent? <Link href="/agent/register">Apply to register</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}

export function NriRegistrationPage() {
  const router = useRouter();
  const { request } = useSession();
  const [countries, setCountries] = useState<Country[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [currentCountry, setCurrentCountry] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pendingMobile, setPendingMobile] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void request<Country[]>('masters/countries')
      .then((result) => { if (active) setCountries(result); })
      .catch((cause: unknown) => { if (active) setError(showError(cause)); });
    return () => { active = false; };
  }, [request]);

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('auth/register/nri', {
        method: 'POST',
        body: JSON.stringify({
          name, email, mobile, password, originCountry, currentCountry,
          timeZone: 'Asia/Kolkata', whatsappOptIn,
          ...(whatsappNumber ? { whatsappNumber } : {}),
          consents: { terms: true, privacy: true }
        })
      });
      setPendingMobile(mobile);
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('auth/otp/verify', { method: 'POST', body: JSON.stringify({ mobile: pendingMobile, code }) });
      router.replace('/login?verified=1');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={pendingMobile ? 'Verify your mobile' : 'Create your NRI account'} description={pendingMobile ? `Enter the six-digit verification code sent to ${pendingMobile}.` : 'Create an account to register and manage your Hyderabad property.'}>
      {pendingMobile ? (
        <form className="auth-form" onSubmit={verify}>
          <label className="form-field"><span>Six-digit verification code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify mobile'}<ArrowRight size={16} /></button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitRegistration}>
          <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Mobile number (include country code)</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="form-field"><span>Country of origin</span><select required value={originCountry} onChange={(event) => setOriginCountry(event.target.value)}><option value="">Select a country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          <label className="form-field"><span>Current country</span><select required value={currentCountry} onChange={(event) => setCurrentCountry(event.target.value)}><option value="">Select a country</option>{countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          <label className="form-field"><span>WhatsApp number <em>Optional</em></span><input type="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={whatsappNumber} onChange={(event) => setWhatsappNumber(event.target.value)} /></label>
          <label className="terms-check"><input type="checkbox" checked={whatsappOptIn} onChange={(event) => setWhatsappOptIn(event.target.checked)} /><span>I agree to receive WhatsApp updates on this number.</span></label>
          <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the LandTrack terms and privacy notice.</span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy || countries.length === 0}>{busy ? 'Creating account…' : 'Create account'}<ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}

export function AgentRegistrationPage() {
  const router = useRouter();
  const { request } = useSession();
  const [districts, setDistricts] = useState<District[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [languages, setLanguages] = useState('');
  const [areasCovered, setAreasCovered] = useState<string[]>([]);
  const [pendingMobile, setPendingMobile] = useState('');
  const [code, setCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void request<District[]>('masters/districts')
      .then((result) => { if (active) setDistricts(result); })
      .catch((cause: unknown) => { if (active) setError(showError(cause)); });
    return () => { active = false; };
  }, [request]);

  const toggleArea = (id: string) => {
    setAreasCovered((selected) => selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id]);
  };

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('auth/register/agent', {
        method: 'POST',
        body: JSON.stringify({
          name, email, mobile, password, experienceYears: Number(experienceYears),
          languages: [...new Set(languages.split(',').map((item) => item.trim()).filter(Boolean))],
          areasCovered
        })
      });
      setPendingMobile(mobile);
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('auth/otp/verify', { method: 'POST', body: JSON.stringify({ mobile: pendingMobile, code }) });
      router.replace('/login?verified=1');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={pendingMobile ? 'Verify your mobile' : 'Agent registration'} description={pendingMobile ? `Enter the verification code sent to ${pendingMobile}. Your profile is reviewed after verification.` : 'Apply to support property owners across the Hyderabad service region.'}>
      {pendingMobile ? (
        <form className="auth-form" onSubmit={verify}>
          <label className="form-field"><span>Six-digit verification code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify mobile'}<ArrowRight size={16} /></button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitRegistration}>
          <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Mobile number (include country code)</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="form-field"><span>Years of local property experience</span><input type="number" min="0" max="60" required value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} /></label>
          <label className="form-field"><span>Languages</span><input required value={languages} onChange={(event) => setLanguages(event.target.value)} placeholder="English, Telugu, Hindi" /><small className="form-help">Separate each language with a comma.</small></label>
          <fieldset className="form-field district-fieldset">
            <legend>Service districts</legend>
            <div className="district-options">{districts.map((district) => <label key={district.id} className="district-option"><input type="checkbox" checked={areasCovered.includes(district.id)} onChange={() => toggleArea(district.id)} /><span>{district.name}</span></label>)}</div>
          </fieldset>
          <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the LandTrack terms and privacy notice.</span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy || districts.length === 0}>{busy ? 'Submitting application…' : 'Submit agent application'}<ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}
