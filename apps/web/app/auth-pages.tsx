'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LandPlot, ShieldCheck } from 'lucide-react';
import { supportedCountries } from '@landtrack/shared';
import { ApiError, useSession } from './session-provider';

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
  const registered = useSearchParams().get('registered') === '1';
  const { user, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !busy) router.replace(roleHome(user.role));
  }, [busy, router, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await signIn(email.trim(), password);
      router.replace(roleHome(result.role));
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in to LandTrack" description="Access your property and appointment workspace with your password.">
        <form className="auth-form" onSubmit={submit}>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {registered && <p className="success-panel" role="status">Your account is ready. Sign in with your password.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
          <p className="auth-switch">New to LandTrack? <Link href="/register">Create an NRI account</Link></p>
          <p className="auth-switch">Local agent? <Link href="/agent/register">Apply to register</Link></p>
          <p className="auth-switch">Administrator? <Link href="/admin/register">Create with setup code</Link></p>
        </form>
    </AuthFrame>
  );
}

export function NriRegistrationPage() {
  const router = useRouter();
  const { request } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [currentCountry, setCurrentCountry] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      router.replace('/login?registered=1');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Create your NRI account" description="Create an account to register and manage your Hyderabad property. Sign in with your password after signup.">
        <form className="auth-form" onSubmit={submitRegistration}>
          <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Mobile number (include country code)</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label className="form-field"><span>Country of origin</span><select required value={originCountry} onChange={(event) => setOriginCountry(event.target.value)}><option value="">Select a country</option>{supportedCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          <label className="form-field"><span>Current country</span><select required value={currentCountry} onChange={(event) => setCurrentCountry(event.target.value)}><option value="">Select a country</option>{supportedCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          <label className="form-field"><span>WhatsApp number <em>Optional</em></span><input type="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={whatsappNumber} onChange={(event) => setWhatsappNumber(event.target.value)} /></label>
          <label className="terms-check"><input type="checkbox" checked={whatsappOptIn} onChange={(event) => setWhatsappOptIn(event.target.checked)} /><span>I agree to receive WhatsApp updates on this number.</span></label>
          <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the LandTrack terms and privacy notice.</span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<ArrowRight size={16} /></button>
          <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
        </form>
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
          areasCovered,
          consents: { terms: true, privacy: true }
        })
      });
      router.replace('/login?registered=1');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Agent registration" description="Apply to support property owners across the Hyderabad service region. Your profile remains pending admin approval after signup.">
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
    </AuthFrame>
  );
}

export function AdminRegistrationPage() {
  const router = useRouter();
  const { request } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request('auth/register/admin', {
        method: 'POST',
        body: JSON.stringify({ name, email, mobile, password, setupCode, consents: { terms: true, privacy: true } })
      });
      router.replace('/login?registered=1');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Administrator signup" description="Create one administrator account with the private setup code configured by the system operator. The code can only be used once.">
      <form className="auth-form" onSubmit={submitRegistration}>
        <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Mobile number</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
        <label className="form-field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="form-field"><span>Private one-time setup code</span><input type="password" autoComplete="off" minLength={32} required value={setupCode} onChange={(event) => setSetupCode(event.target.value)} /></label>
        <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the LandTrack terms and privacy notice.</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Creating administrator…' : 'Create administrator'}<ArrowRight size={16} /></button>
        <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

export function PasswordChangePage() {
  const { changePassword } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Your password has been changed.');
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card auth-card">
      <div className="auth-heading"><span className="agent-form-icon"><ShieldCheck size={20} /></span><div><h1>Change password</h1><p>Use your current password to set a new one for this account.</p></div></div>
      <form className="auth-form" onSubmit={submit}>
        <label className="form-field"><span>Current password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label className="form-field"><span>New password</span><input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small className="form-help">At least 10 characters, including a letter and a number.</small></label>
        <label className="form-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={10} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-panel" role="status">{success}</p>}
        <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Changing password…' : 'Change password'}<ArrowRight size={16} /></button>
      </form>
    </section>
  );
}
