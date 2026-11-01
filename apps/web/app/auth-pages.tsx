'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, LandPlot, LayoutDashboard, MapPin, Scale, ShieldCheck } from 'lucide-react';
import { supportedCountries } from './countries';
import { ApiError, useSession } from './session-provider';

type District = { id: string; name: string };

function AuthFrame({ children, title, description }: { children: React.ReactNode; title: string; description: string }) {
  return (
    <main className="auth-page">
      <Link href="/" className="brand auth-brand" aria-label="NRI Land Tracking System home">
        <span className="brand-mark"><LandPlot size={21} strokeWidth={2.4} /></span>
        <span>NRI Land Tracking System</span>
      </Link>
      <section className="card auth-card">
        <div className="auth-heading">
          <span className="agent-form-icon"><ShieldCheck size={20} /></span>
          <div><h1>{title}</h1><p>{description}</p></div>
        </div>
        {children}
      </section>
      <p className="auth-region">NRI Land Tracking System · Hyderabad, Telangana</p>
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
  const { user, signIn, setupMfa, verifyMfa, cancelMfa } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [mfaSecret, setMfaSecret] = useState('');
  const [code, setCode] = useState('');
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
      if (result.mfaRequired) {
        setMfaRequired(true);
        setMfaSetupRequired(result.mfaSetupRequired);
        if (result.mfaSetupRequired) {
          const setup = await setupMfa();
          setMfaSecret(setup.secret);
        }
        return;
      }
      router.replace(roleHome(result.role));
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await verifyMfa(code);
      router.replace(roleHome(result.role));
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  const restartSignIn = () => {
    cancelMfa();
    setMfaRequired(false);
    setMfaSetupRequired(false);
    setMfaSecret('');
    setCode('');
    setError('');
  };

  const retryMfaSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const setup = await setupMfa();
      setMfaSecret(setup.secret);
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title={mfaRequired ? (mfaSetupRequired ? 'Set up authenticator MFA' : 'Verify authenticator code') : 'Sign in to NRI Land Tracking System'}
      description={mfaRequired
        ? (mfaSetupRequired ? 'Administrator and Auditor accounts must enroll an authenticator before accessing the workspace.' : 'Enter the current six-digit code from your authenticator app to continue.')
        : 'Access your property and appointment workspace with your password.'}
    >
      {mfaRequired ? (
        <form className="auth-form" onSubmit={submitMfa}>
          {mfaSetupRequired && (
            <div className="mfa-setup-instructions">
              <p>Add an account in Google Authenticator, Microsoft Authenticator, or another TOTP app using this key:</p>
              <p className="mfa-secret" aria-label="Authenticator setup key">{mfaSecret}</p>
              <p>Use account <strong>{email.trim()}</strong>, issuer <strong>NRI Land Tracking System</strong>, and a 30-second time-based code.</p>
            </div>
          )}
          <label className="form-field">
            <span>Six-digit authenticator code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {mfaSetupRequired && !mfaSecret && (
            <button type="button" className="button button-secondary auth-submit" disabled={busy} onClick={() => { void retryMfaSetup(); }}>
              Retry authenticator setup
            </button>
          )}
          <button className="button button-primary auth-submit" disabled={busy || (mfaSetupRequired && !mfaSecret)}>
            {busy ? 'Verifying…' : mfaSetupRequired ? 'Enable MFA and continue' : 'Verify and sign in'}<ArrowRight size={16} />
          </button>
          <button type="button" className="auth-switch auth-switch-button" disabled={busy} onClick={restartSignIn}>Restart sign-in</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="form-field"><span>Email address</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="form-field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {registered && <p className="success-panel" role="status">Your account is ready. Sign in with your password.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
          <p className="auth-switch">New to NRI Land Tracking System? <Link href="/register">Create an NRI account</Link></p>
          <p className="auth-switch">Local agent? <Link href="/agent/register">Apply to register</Link></p>
          <p className="auth-switch">Administrator? <Link href="/admin/register">Create with setup code</Link></p>
        </form>
      )}
    </AuthFrame>
  );
}

const dialCodes = [
  { code: '+91', label: 'IN (+91)' }, { code: '+1', label: 'US/CA (+1)' }, { code: '+44', label: 'UK (+44)' },
  { code: '+971', label: 'AE (+971)' }, { code: '+966', label: 'SA (+966)' }, { code: '+974', label: 'QA (+974)' },
  { code: '+965', label: 'KW (+965)' }, { code: '+968', label: 'OM (+968)' }, { code: '+973', label: 'BH (+973)' },
  { code: '+65', label: 'SG (+65)' }, { code: '+60', label: 'MY (+60)' }, { code: '+61', label: 'AU (+61)' },
  { code: '+64', label: 'NZ (+64)' }, { code: '+49', label: 'DE (+49)' }, { code: '+33', label: 'FR (+33)' },
  { code: '+81', label: 'JP (+81)' }
];

const indianStates = ['Telangana', 'Andhra Pradesh', 'Karnataka', 'Maharashtra', 'Tamil Nadu', 'Kerala', 'Delhi', 'Gujarat', 'Other'];

export function NriRegistrationPage() {
  const router = useRouter();
  const { request } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dialCode, setDialCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [currentCountry, setCurrentCountry] = useState('');
  const [propertyState, setPropertyState] = useState('');
  const [propertyCity, setPropertyCity] = useState('');
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
          name, email, mobile: `${dialCode}${phone.replace(/\D/g, '')}`, password, originCountry: 'IN', currentCountry,
          timeZone: 'Asia/Kolkata', whatsappOptIn: false,
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
    <main className="nri-split">
      <aside className="nri-hero" aria-label="LandTracker benefits">
        <Link href="/" className="nri-hero-brand" aria-label="LandTracker home"><LandPlot size={16} strokeWidth={2.4} /><span>LandTracker</span></Link>
        <div className="nri-hero-copy">
          <h2>Start Your<br />Protection Journey.</h2>
          <ul>
            <li><BadgeCheck size={14} /><div><strong>Verified Land Agents</strong><span>Connect with trusted professionals for your property matters.</span></div></li>
            <li><Scale size={14} /><div><strong>Legal Safeguards</strong><span>Expert guidance and documentation support for your property.</span></div></li>
            <li><LayoutDashboard size={14} /><div><strong>Real-time Dashboard</strong><span>Track your land status and appointments from anywhere.</span></div></li>
          </ul>
        </div>
        <p className="nri-hero-foot">NRI Land Tracking System · Hyderabad, Telangana</p>
      </aside>
      <section className="nri-form-pane">
        <form className="nri-form" onSubmit={submitRegistration}>
          <h1>Register as NRI Property Owner</h1>
          <p className="nri-sub">Already a community member? Complete the form to begin.</p>
          <div className="nri-grid">
          <label className="form-field"><span>Full Name (as per passport)</span><input autoComplete="name" required maxLength={120} placeholder="As on your passport" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>Email Address</span><input type="email" autoComplete="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <div className="form-field"><span>International Phone Number</span>
            <div className="nri-phone">
              <select aria-label="Country dial code" value={dialCode} onChange={(event) => setDialCode(event.target.value)}>{dialCodes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
              <input type="tel" autoComplete="tel-national" required inputMode="numeric" pattern="[0-9 ]{7,14}" aria-label="Phone number" placeholder="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
          </div>
          <label className="form-field"><span>Country of Residence</span><select required value={currentCountry} onChange={(event) => setCurrentCountry(event.target.value)}><option value="">Select a country</option>{supportedCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
          </div>
          <fieldset className="nri-location">
            <legend><MapPin size={12} /> Primary Property Location</legend>
            <div className="nri-grid">
              <label className="form-field"><span>State in India</span><select value={propertyState} onChange={(event) => setPropertyState(event.target.value)}><option value="">Select State</option>{indianStates.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
              <label className="form-field"><span>District / City</span><input placeholder="e.g. Hyderabad" value={propertyCity} onChange={(event) => setPropertyCity(event.target.value)} /></label>
            </div>
          </fieldset>
          <label className="form-field"><span>Create Password</span><input type="password" autoComplete="new-password" minLength={10} required placeholder="Minimum 10 characters" value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 10 characters with a mix of letters, numbers and symbols.</small></label>
          <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the NRI Land Tracking System <strong>Terms of Service</strong> and confirm that I am an NRI. I consent to the processing of my data and privacy notice.</span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="nri-actions">
            <button className="button button-primary" disabled={busy}>{busy ? 'Creating account…' : 'Complete Registration'}</button>
            <p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p>
          </div>
        </form>
      </section>
    </main>
  );
}

export function AgentRegistrationPage() {
  const router = useRouter();
  const { request, signOut, user } = useSession();
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
      if (user) await signOut();
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
          {user && <p className="success-panel" role="note">You are signed in as {user.email}. Agent registration creates a separate account, so use a different email address and mobile number. You will be signed out after submitting.</p>}
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
          <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the NRI Land Tracking System terms and privacy notice.</span></label>
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
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestingCode, setRequestingCode] = useState(false);

  const requestSetupCode = async () => {
    setRequestingCode(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ message: string }>('auth/admin/setup-code', { method: 'POST' });
      setNotice(result.message);
    } catch (cause) {
      setError(showError(cause));
    } finally {
      setRequestingCode(false);
    }
  };

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
    <AuthFrame title="Administrator signup" description="Request a one-time code at adminlandtrack@gmail.com to create an administrator account. Only this email address is permitted. The code expires after 15 minutes and can only be used once.">
      <form className="auth-form" onSubmit={submitRegistration}>
        <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="form-field"><span>Mobile number</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} /></label>
        <label className="form-field"><span>Password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <div className="form-field"><span>Private one-time setup code</span><div className="code-request-row"><input type="password" autoComplete="off" minLength={32} required value={setupCode} onChange={(event) => setSetupCode(event.target.value)} /><button type="button" className="button button-secondary" disabled={requestingCode} onClick={() => { void requestSetupCode(); }}>{requestingCode ? 'Sending…' : 'Email me a code'}</button></div></div>
        <label className="terms-check"><input type="checkbox" required checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the NRI Land Tracking System terms and privacy notice.</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="success-inline" role="status">{notice}</p>}
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
