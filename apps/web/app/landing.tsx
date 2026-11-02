import { ArrowRight, Banknote, FileCheck2, LandPlot, MapPinned, ShieldCheck, UserCheck } from 'lucide-react';
import Link from 'next/link';

const steps = [
  { icon: UserCheck, title: 'Register & verify', text: 'Create your NRI account and verify your mobile number.' },
  { icon: MapPinned, title: 'Add your property', text: 'Enter location, survey number and upload your documents.' },
  { icon: Banknote, title: 'Pay the registration charge', text: 'Complete a secure one-time payment to submit for review.' },
  { icon: FileCheck2, title: 'Meet your local agent', text: 'Once approved, book an appointment with a verified agent.' }
];

const pillars = [
  'Every property reviewed by an administrator before approval',
  'Verified, approved local agents in your district',
  'Times shown in your time zone and in IST, always',
  'Audit-ready records of every action and payment'
];

export function LandingPage({ signedIn, portalHref }: { signedIn: boolean; portalHref: string }) {
  return (
    <div className="lp">
      <section className="lp-hero" style={{ backgroundImage: 'linear-gradient(180deg, rgb(10 30 22 / 55%), rgb(10 30 22 / 82%)), url(/hero-land.jpg)' }}>
        <header className="lp-header">
          <span className="lp-logo"><span className="brand-mark"><LandPlot size={20} /></span>LandTrack</span>
          <nav>
            {signedIn
              ? <Link className="lp-btn lp-btn-glass" href={portalHref}>My portal</Link>
              : <><Link className="lp-link" href="/login">Log in</Link><Link className="lp-btn lp-btn-accent" href="/register">Register</Link></>}
          </nav>
        </header>
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">NRI land care · Telangana</p>
          <h1>Your land in India, looked after while you&apos;re away.</h1>
          <p>Register your property, pay online and meet a verified local agent — all from wherever you live.</p>
          <div className="lp-cta">
            <Link className="lp-btn lp-btn-accent" href={signedIn ? portalHref : '/register'}>{signedIn ? 'Open my portal' : 'Get started'}<ArrowRight size={16} /></Link>
            {!signedIn && <Link className="lp-btn lp-btn-glass" href="/login">Log in</Link>}
          </div>
        </div>
      </section>

      <section className="lp-section">
        <p className="lp-eyebrow dark">How it works</p>
        <h2>Four simple steps</h2>
        <div className="lp-steps">
          {steps.map(({ icon: Icon, title, text }, index) => (
            <article key={title} className="lp-step">
              <span className="lp-step-icon"><Icon size={20} /></span>
              <small>Step {index + 1}</small>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-panel">
          <div>
            <p className="lp-eyebrow">Why LandTrack</p>
            <h2>Trust, built into every step.</h2>
          </div>
          <ul>{pillars.map((item) => <li key={item}><ShieldCheck size={18} />{item}</li>)}</ul>
        </div>
      </section>

      <section className="lp-section lp-final">
        <h2>Start with one property.</h2>
        <Link className="lp-btn lp-btn-primary" href={signedIn ? portalHref : '/register'}>{signedIn ? 'Open my portal' : 'Create your account'}<ArrowRight size={16} /></Link>
      </section>

      <footer className="lp-footer"><span>© LandTrack · Hyderabad, Telangana</span></footer>
    </div>
  );
}
