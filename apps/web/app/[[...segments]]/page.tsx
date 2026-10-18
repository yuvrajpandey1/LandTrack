'use client';

import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Building2, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, FileText,
  Filter, Home, LandPlot, LayoutDashboard, MapPin, MessageCircle, MoreHorizontal,
  LogOut, Plus, Search, ShieldCheck, SlidersHorizontal, UserPlus, Users, Wallet, X
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AdminRegistrationPage, AgentRegistrationPage, LoginPage, NriRegistrationPage, PasswordChangePage } from '../auth-pages';
import { AppointmentBooking } from '../appointment-booking';
import { PaymentHistory } from '../payment-history';
import { PropertyRegistration } from '../property-registration';
import { useSession, type AccountRole } from '../session-provider';

type Role = 'Admin' | 'Auditor' | 'Agent' | 'NRI';
const roleByAccount: Record<AccountRole, Role> = { ADMIN: 'Admin', AUDITOR: 'Auditor', AGENT: 'Agent', NRI: 'NRI' };
const homeByRole: Record<Role, string> = { Admin: '/admin', Auditor: '/audit', Agent: '/agent', NRI: '/app' };
type PropertyStatus = 'Under review' | 'Approved' | 'Rejected' | 'Payment pending' | 'Draft';
type Property = {
  id: string;
  name: string;
  location: string;
  district: string;
  area: number;
  unit: string;
  owner: string;
  status: PropertyStatus;
  submitted: string;
  propertyType?: string;
  surveyNumber?: string;
  ownership?: string;
};
type AgentStatus = 'Pending approval' | 'Approved' | 'Rejected';
type Agent = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  experienceYears: number;
  languages: string[];
  districts: string[];
  status: AgentStatus;
  submitted: string;
};

type ApiProperty = {
  id: string;
  name: string;
  surveyNumber: string;
  type: string;
  area: string | number;
  areaUnit: string;
  ownership: string;
  status: string;
  createdAt: string;
  submittedAt?: string | null;
  district?: { name: string };
  taluka?: { name: string };
  village?: { name: string };
  owner?: { name: string };
};

type ApiAgent = {
  id: string;
  name: string;
  email: string;
  mobile: string;
  createdAt: string;
  status: string;
  agentProfile?: {
    approval: string;
    experienceYears: number | null;
    languages: string[];
    areasCovered: string[];
  } | null;
};

function toProperty(value: ApiProperty): Property {
  const statuses: Record<string, PropertyStatus> = {
    DRAFT: 'Draft',
    PAYMENT_PENDING: 'Payment pending',
    SUBMITTED: 'Under review',
    UNDER_REVIEW: 'Under review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected'
  };
  const units: Record<string, string> = { ACRE: 'acres', GUNTA: 'guntas', SQ_YARD: 'sq. yards', SQ_FT: 'sq. ft.', SQ_METER: 'sq. meters' };
  const location = [value.village?.name, value.district?.name].filter(Boolean).join(', ');
  return {
    id: value.id,
    name: value.name,
    location: location || 'Hyderabad, Telangana',
    district: value.district?.name ?? 'Hyderabad',
    area: Number(value.area),
    unit: units[value.areaUnit] ?? value.areaUnit,
    owner: value.owner?.name ?? 'Account owner',
    status: statuses[value.status] ?? 'Draft',
    submitted: new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value.submittedAt ?? value.createdAt)),
    propertyType: value.type,
    surveyNumber: value.surveyNumber,
    ownership: value.ownership
  };
}

function toAgent(value: ApiAgent, districtNames: Map<string, string>): Agent {
  const approval = value.agentProfile?.approval ?? 'PENDING';
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    mobile: value.mobile,
    experienceYears: value.agentProfile?.experienceYears ?? 0,
    languages: value.agentProfile?.languages ?? [],
    districts: (value.agentProfile?.areasCovered ?? []).map((id) => districtNames.get(id) ?? id),
    status: approval === 'APPROVED' ? 'Approved' : approval === 'REJECTED' ? 'Rejected' : 'Pending approval',
    submitted: new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value.createdAt))
  };
}

const districts = ['Hyderabad', 'Medchal-Malkajgiri', 'Rangareddy'];

const adminNavigation = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { label: 'Properties', href: '/admin/properties', icon: Building2 },
  { label: 'Agents', href: '/admin/agents', icon: Users },
  { label: 'Appointments', href: '/admin/appointments', icon: CalendarDays },
  { label: 'Communications', href: '/admin/communications', icon: MessageCircle },
  { label: 'Payments', href: '/admin/payments', icon: Wallet },
  { label: 'Masters & slots', href: '/admin/masters', icon: SlidersHorizontal },
  { label: 'Audit logs', href: '/admin/audit-logs', icon: ShieldCheck },
  { label: 'Reports', href: '/admin/reports', icon: FileText }
];

const navigationByRole: Record<Role, typeof adminNavigation> = {
  Admin: adminNavigation,
  Auditor: [
    { label: 'Audit overview', href: '/audit', icon: LayoutDashboard },
    { label: 'Property register', href: '/audit/properties', icon: Building2 },
    { label: 'Communication search', href: '/audit/search', icon: MessageCircle },
    { label: 'Exports', href: '/audit/exports', icon: FileText }
  ],
  Agent: [
    { label: 'My overview', href: '/agent', icon: LayoutDashboard },
    { label: 'Appointments', href: '/agent/appointments', icon: CalendarDays },
    { label: 'Chat', href: '/agent/chat', icon: MessageCircle },
    { label: 'Profile', href: '/agent/profile', icon: Users }
  ],
  NRI: [
    { label: 'My overview', href: '/app', icon: LayoutDashboard },
    { label: 'My properties', href: '/app/properties', icon: Building2 },
    { label: 'Appointments', href: '/app/appointments', icon: CalendarDays },
    { label: 'Messages', href: '/app/chat', icon: MessageCircle },
    { label: 'Payments', href: '/app/payments', icon: Wallet },
    { label: 'Settings', href: '/app/settings', icon: SlidersHorizontal }
  ]
};

const statusClasses: Record<PropertyStatus, string> = {
  'Under review': 'status-blue',
  Approved: 'status-green',
  Rejected: 'status-red',
  'Payment pending': 'status-amber',
  Draft: 'status-gray'
};

function Header({ role, name, onSignOut }: { role: Role; name: string; onSignOut: () => void }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="NRI Land Tracking System home">
        <span className="brand-mark"><LandPlot size={21} strokeWidth={2.4} /></span>
        <span>NRI Land Tracking System</span>
        <span className="region-pill">HYDERABAD</span>
      </Link>
      <div className="topbar-actions">
        <label className="search-box">
          <Search size={17} />
          <input aria-label="Search" placeholder="Search properties, people..." />
          <kbd>⌘ K</kbd>
        </label>
        <Link className="agent-register-link" href="/agent/register">Agent registration</Link>
        <Link className="agent-register-link" href="/account/password">Change password</Link>
        <button className="icon-button notification-button" aria-label="Notifications">
          <Bell size={19} /><span className="notification-dot" />
        </button>
        <span className="role-select"><span className="avatar">{name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span>{name}</span></span>
        <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button>
      </div>
    </header>
  );
}

function Sidebar({ role, pathname }: { role: Role; pathname: string }) {
  return (
    <aside className="sidebar">
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label={`${role} navigation`}>
        {navigationByRole[role].map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
          return (
            <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`}>
              <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
              {label === 'Agents' && role === 'Admin' && <span className="nav-count">4</span>}
            </Link>
          );
        })}
      </nav>
      {role === 'Admin' && (
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <div><strong>Audit trail active</strong><span>All admin actions are logged.</span></div>
        </div>
      )}
      <div className="sidebar-footer">
        <span className="avatar avatar-small">{role === 'NRI' ? 'NR' : role === 'Agent' ? 'AG' : role === 'Auditor' ? 'AU' : 'JD'}</span>
        <div><strong>{role === 'NRI' ? 'NRI User' : role === 'Agent' ? 'Agent account' : role === 'Auditor' ? 'Audit account' : 'Jane Doe'}</strong><span>{role}</span></div>
        <MoreHorizontal size={19} className="sidebar-more" />
      </div>
    </aside>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function StatCard({ title, value, change, icon: Icon, tone = 'blue' }: { title: string; value: string; change: string; icon: typeof Building2; tone?: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={20} /></div>
      <div className="stat-copy"><span>{title}</span><strong>{value}</strong></div>
      <div className={`stat-change ${change.startsWith('-') ? 'negative' : ''}`}>
        {change.startsWith('-') ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{change}
      </div>
    </article>
  );
}

function PropertyTable({ properties, audit = false, onStatusChange }: { properties: Property[]; audit?: boolean; onStatusChange?: (id: string, status: PropertyStatus) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [actionError, setActionError] = useState('');
  const filtered = useMemo(() => properties.filter((property) => {
    const matchesQuery = `${property.name} ${property.location} ${property.owner} ${property.id}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === 'All statuses' || property.status === status);
  }), [properties, query, status]);
  const review = async (id: string) => {
    if (!onStatusChange) return;
    setActionError('');
    try {
      await onStatusChange(id, 'Approved');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The property review could not be saved.');
    }
  };

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <div><h2>{audit ? 'Property register' : 'Recent property submissions'}</h2><p>{filtered.length} records · Hyderabad region</p></div>
        <div className="table-tools">
          <label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search properties" /></label>
          <label className="filter-select"><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status"><option>All statuses</option><option>Under review</option><option>Approved</option><option>Rejected</option><option>Payment pending</option><option>Draft</option></select></label>
        </div>
      </div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>PROPERTY</th><th>LOCATION</th><th>AREA</th><th>OWNER</th><th>SUBMITTED</th><th>STATUS</th>{onStatusChange && <th>REVIEW</th>}</tr></thead>
          <tbody>
            {filtered.map((property) => (
              <tr key={property.id}>
                <td><Link href={`${audit ? '/audit' : '/admin'}/properties/${property.id}`} className="property-link"><span className="property-thumb"><Building2 size={18} /></span><span><strong>{property.name}</strong><small>{property.id}</small></span></Link></td>
                <td><span className="location-cell"><MapPin size={14} />{property.location}</span></td>
                <td>{property.area} {property.unit}</td>
                <td>{property.owner}</td>
                <td>{property.submitted}</td>
                <td><span className={`status-badge ${statusClasses[property.status]}`}><span />{property.status}</span></td>
                {onStatusChange && <td>{property.status === 'Under review' ? <button className="text-action" onClick={() => { void review(property.id); }}>Approve <ArrowRight size={14} /></button> : <span className="muted">—</span>}</td>}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={onStatusChange ? 7 : 6} className="empty-cell">No properties match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>Showing {filtered.length} of {properties.length} properties</span><div className="pagination"><button disabled aria-label="Previous page"><ChevronLeft size={16} /></button><span>1</span><button aria-label="Next page"><ChevronRight size={16} /></button></div></div>
    </section>
  );
}

function AdminDashboard({ properties, activeAgents, onReview }: { properties: Property[]; activeAgents: number; onReview: (id: string, status: PropertyStatus) => Promise<void> }) {
  const pending = properties.filter((property) => property.status === 'Under review').length;
  return (
    <>
      <PageHeading eyebrow="ADMINISTRATION" title="Dashboard overview" description="A live view of property registrations and activity across Hyderabad." action={<Link className="button button-primary" href="/admin/properties"><Building2 size={18} />Review properties</Link>} />
      <section className="stats-grid">
        <StatCard title="Registered properties" value={String(properties.length).padStart(2, '0')} change="Current records" icon={Building2} />
        <StatCard title="Under review" value={String(pending).padStart(2, '0')} change={pending ? `${pending} need attention` : 'All caught up'} icon={ClipboardCheck} tone="amber" />
        <StatCard title="Approved agents" value={String(activeAgents).padStart(2, '0')} change="Eligible for assignment" icon={Users} tone="purple" />
        <StatCard title="Registration charge" value="₹500" change="Configured in settings" icon={Wallet} tone="green" />
      </section>
      <PropertyTable properties={properties} onStatusChange={onReview} />
    </>
  );
}

function AgentDirectory({ agents, onReview }: { agents: Agent[]; onReview: (id: string, status: AgentStatus, reason?: string) => Promise<void> }) {
  const [error, setError] = useState('');
  const pending = agents.filter((agent) => agent.status === 'Pending approval').length;
  const updateStatus = async (id: string, status: AgentStatus) => {
    setError('');
    const enteredReason = status === 'Rejected' ? window.prompt('Enter a reason for rejecting this agent application:') : undefined;
    if (status === 'Rejected' && !enteredReason?.trim()) return;
    const reason = enteredReason ?? undefined;
    try {
      await onReview(id, status, reason);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The agent review could not be saved.');
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="AGENT MANAGEMENT"
        title="Agents"
        description="Create agent profiles, review applications, and manage service coverage."
        action={<div className="agent-heading-actions"><Link className="button button-secondary" href="/agent/register"><UserPlus size={16} />Agent registration</Link><Link className="button button-primary" href="/admin/agents/new"><Plus size={17} />Create new agent</Link></div>}
      />
      <section className="stats-grid agent-stats">
        <StatCard title="Total agents" value={String(agents.length).padStart(2, '0')} change="Registered profiles" icon={Users} />
        <StatCard title="Pending applications" value={String(pending).padStart(2, '0')} change={pending ? 'Awaiting admin review' : 'All applications reviewed'} icon={Clock3} tone="amber" />
        <StatCard title="Approved agents" value={String(agents.filter((agent) => agent.status === 'Approved').length).padStart(2, '0')} change="Eligible for assignment" icon={CheckCircle2} tone="green" />
        <StatCard title="Service region" value="03" change="Hyderabad districts" icon={MapPin} tone="purple" />
      </section>
      <section className="card agent-directory-card">
        <div className="table-toolbar">
          <div><h2>Agent applications and profiles</h2><p>{agents.length} agent profiles</p></div>
          <span className="muted">Live records</span>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="table-scroll">
          <table className="agent-table">
            <thead><tr><th>AGENT</th><th>CONTACT</th><th>EXPERIENCE</th><th>LANGUAGES</th><th>SERVICE AREA</th><th>STATUS</th><th>REVIEW</th></tr></thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td><div className="agent-name-cell"><span className="agent-avatar">{agent.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{agent.name}</strong><small>{agent.id} · Applied {agent.submitted}</small></span></div></td>
                  <td><span className="agent-contact">{agent.email}<small>{agent.mobile}</small></span></td>
                  <td>{agent.experienceYears} {agent.experienceYears === 1 ? 'year' : 'years'}</td>
                  <td>{agent.languages.join(', ')}</td>
                  <td>{agent.districts.join(', ')}</td>
                  <td><span className={`status-badge ${agent.status === 'Approved' ? 'status-green' : agent.status === 'Rejected' ? 'status-red' : 'status-amber'}`}><span />{agent.status}</span></td>
                  <td>
                    {agent.status === 'Pending approval'
                      ? <div className="agent-review-actions"><button className="text-action" onClick={() => updateStatus(agent.id, 'Approved')}>Approve</button><button className="text-action agent-reject-action" onClick={() => updateStatus(agent.id, 'Rejected')}>Reject</button></div>
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
              {agents.length === 0 && <tr><td colSpan={7} className="empty-cell">No agent profiles yet. Create an agent or share the registration link.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>Showing {agents.length} agent profiles</span><span>Agent approval is required before assignment.</span></div>
      </section>
    </>
  );
}

function AgentForm({ mode, onCreate }: { mode: 'admin' | 'registration'; onCreate: (agent: Agent) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [languages, setLanguages] = useState('');
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [createdAgent, setCreatedAgent] = useState<Agent | null>(null);
  const isRegistration = mode === 'registration';

  const toggleDistrict = (district: string) => {
    setSelectedDistricts((selected) => selected.includes(district)
      ? selected.filter((item) => item !== district)
      : [...selected, district]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const languageList = [...new Set(languages.split(',').map((language) => language.trim()).filter(Boolean))];
    if (selectedDistricts.length === 0) {
      setError('Select at least one Hyderabad service district.');
      return;
    }
    if (!languageList.length) {
      setError('Add at least one language you can support clients in.');
      return;
    }
    if (isRegistration && (!/[A-Za-z]/.test(password) || !/\d/.test(password) || password.length < 10)) {
      setError('Password must be at least 10 characters and include a letter and a number.');
      return;
    }
    if (isRegistration && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (isRegistration && !acceptedTerms) {
      setError('Accept the terms and privacy notice to submit your application.');
      return;
    }

    const agent: Agent = {
      id: `AG-${Date.now().toString().slice(-6)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      mobile: mobile.trim(),
      experienceYears: Number(experienceYears),
      languages: languageList,
      districts: selectedDistricts,
      status: 'Pending approval',
      submitted: new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date())
    };
    onCreate(agent);
    setCreatedAgent(agent);
    setPassword('');
    setConfirmPassword('');
  };

  if (createdAgent) {
    return (
      <section className="card agent-form-card">
        <div className="success-panel">
          <span><Check size={22} /></span>
          <div><h2>{isRegistration ? 'Application submitted' : 'Agent profile created'}</h2><p>{isRegistration ? 'Your agent registration has been received.' : 'The agent profile is awaiting approval.'} Reference: {createdAgent.id}</p></div>
        </div>
        <div className="agent-next-steps">
          <h2>What happens next?</h2>
          <p>{isRegistration
            ? 'The NRI Land Tracking System admin team will review your profile and service areas. You can sign in after verifying your mobile number and your application is approved.'
            : 'This preview records the agent profile as pending. In the live service, the agent completes mobile verification and an administrator approves the profile before appointments can be assigned.'}</p>
          <span className="status-badge status-amber"><span />Pending approval</span>
        </div>
        <div className="wizard-actions">
          {isRegistration
            ? <Link href="/agent/register" className="button button-secondary">Submit another application</Link>
            : <Link href="/admin/agents" className="button button-secondary"><ChevronLeft size={16} />Back to agents</Link>}
          <Link href={isRegistration ? '/agent' : '/admin/agents'} className="button button-primary">{isRegistration ? 'Agent workspace' : 'View agent directory'}<ArrowRight size={16} /></Link>
        </div>
      </section>
    );
  }

  return (
    <form className="card agent-form-card" onSubmit={submit}>
      <div className="agent-form-intro">
        <span className="agent-form-icon"><Users size={20} /></span>
        <div><h2>{isRegistration ? 'Your agent profile' : 'Agent details'}</h2><p>{isRegistration ? 'Tell us about your local experience and the areas you cover.' : 'Create an agent profile for the Hyderabad service region.'}</p></div>
      </div>
      {isRegistration && <div className="upload-info"><ShieldCheck size={17} /><span>Your password is used only to submit this preview form and is never saved in browser storage.</span></div>}
      <div className="form-grid agent-form-grid">
        <label className="form-field"><span>Full name</span><input autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" /></label>
        <label className="form-field"><span>Email address</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label className="form-field"><span>Mobile number</span><input type="tel" autoComplete="tel" required pattern="\+[1-9][0-9]{7,14}" title="Enter a country code and number, for example +919876543210" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="+91 98765 43210" /></label>
        <label className="form-field"><span>Years of local property experience</span><input type="number" min="0" max="60" required value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} placeholder="e.g. 5" /></label>
        <label className="form-field full"><span>Languages</span><input required value={languages} onChange={(event) => setLanguages(event.target.value)} placeholder="English, Telugu, Hindi" /><small className="form-help">Separate each language with a comma.</small></label>
        <fieldset className="form-field full district-fieldset">
          <legend>Hyderabad service districts</legend>
          <div className="district-options">{districts.map((district) => <label key={district} className="district-option"><input type="checkbox" checked={selectedDistricts.includes(district)} onChange={() => toggleDistrict(district)} /><span>{district}</span></label>)}</div>
        </fieldset>
        {isRegistration && <>
          <label className="form-field"><span>Create password</span><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" /></label>
          <label className="form-field"><span>Confirm password</span><input type="password" autoComplete="new-password" minLength={10} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter password" /></label>
          <label className="terms-check full"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I agree to the NRI Land Tracking System terms and privacy notice.</span></label>
        </>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="agent-form-actions">
        <Link className="button button-secondary" href={isRegistration ? '/agent' : '/admin/agents'}><ChevronLeft size={16} />Cancel</Link>
        <button className="button button-primary" type="submit">{isRegistration ? 'Submit agent application' : 'Create agent profile'}<ArrowRight size={16} /></button>
      </div>
    </form>
  );
}

function RegistrationWizard({ onCreate, onPayment }: { onCreate: (property: Property) => void; onPayment: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [survey, setSurvey] = useState('');
  const [district, setDistrict] = useState('Hyderabad');
  const [taluka, setTaluka] = useState('');
  const [village, setVillage] = useState('');
  const [area, setArea] = useState('');
  const [unit, setUnit] = useState('acres');
  const [propertyType, setPropertyType] = useState('Agricultural land');
  const [ownership, setOwnership] = useState('Sole ownership');
  const [files, setFiles] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [createdPropertyId, setCreatedPropertyId] = useState('');
  const talukasByDistrict: Record<string, string[]> = {
    Hyderabad: ['Amberpet', 'Asifnagar', 'Charminar', 'Khairatabad'],
    Rangareddy: ['Shamshabad', 'Rajendranagar', 'Serilingampally'],
    'Medchal-Malkajgiri': ['Quthbullapur', 'Malkajgiri', 'Medchal']
  };
  const villagesByTaluka: Record<string, string[]> = {
    Amberpet: ['Amberpet', 'Bagh Amberpet'],
    Asifnagar: ['Asifnagar', 'Mehdipatnam'],
    Charminar: ['Charminar', 'Falaknuma'],
    Khairatabad: ['Khairatabad', 'Somajiguda'],
    Shamshabad: ['Shamshabad', 'Mamidipally'],
    Rajendranagar: ['Bandlaguda Jagir', 'Hydershakote'],
    Serilingampally: ['Gachibowli', 'Miyapur', 'Kondapur'],
    Quthbullapur: ['Kompally', 'Dulapally'],
    Malkajgiri: ['Malkajgiri', 'Neredmet'],
    Medchal: ['Medchal', 'Gundlapochampally']
  };

  const createDraft = () => {
    const property: Property = {
      id: `LT-${Math.floor(10300 + Math.random() * 600)}`,
      name,
      location: `${village}, ${district}`,
      district,
      area: Number(area),
      unit,
      owner: 'You',
      status: 'Payment pending',
      submitted: new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date()),
      propertyType,
      surveyNumber: survey,
      ownership
    };
    onCreate(property);
    setCreatedPropertyId(property.id);
    setNotice(`Property saved. Your ₹500 registration charge is ready for secure checkout.`);
    setStep(3);
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
            <div><h2>Add land details</h2><p>Register a property located in Hyderabad, Telangana.</p></div>
            <div className="form-grid">
              <label className="form-field full"><span>Property name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Green Valley Plot" required /></label>
              <label className="form-field"><span>Property type</span><select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}><option>Agricultural land</option><option>Residential plot</option><option>Commercial property</option><option>House</option><option>Apartment</option></select></label>
              <label className="form-field"><span>Survey number</span><input value={survey} onChange={(event) => setSurvey(event.target.value)} placeholder="e.g. 142/3A" /></label>
              <label className="form-field"><span>State</span><input value="Telangana" readOnly /></label>
              <label className="form-field"><span>City</span><input value="Hyderabad" readOnly /></label>
              <label className="form-field"><span>District</span><select value={district} onChange={(event) => { setDistrict(event.target.value); setTaluka(''); setVillage(''); }}><option>Hyderabad</option><option>Rangareddy</option><option>Medchal-Malkajgiri</option></select></label>
              <label className="form-field"><span>Taluka / Mandal</span><select value={taluka} onChange={(event) => { setTaluka(event.target.value); setVillage(''); }}><option value="">Select taluka / mandal</option>{talukasByDistrict[district].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="form-field"><span>Village</span><select value={village} onChange={(event) => setVillage(event.target.value)}><option value="">Select village</option>{(villagesByTaluka[taluka] ?? []).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="form-field full"><span>Address / landmark <em>Optional</em></span><input placeholder="Street, landmark or nearby location" /></label>
              <label className="form-field"><span>Land area</span><input type="number" min="0" step="0.01" value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. 2.5" /></label>
              <label className="form-field"><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option>acres</option><option>guntas</option><option>sq. yards</option><option>sq. ft.</option></select></label>
              <label className="form-field"><span>Ownership</span><select value={ownership} onChange={(event) => setOwnership(event.target.value)}><option>Sole ownership</option><option>Joint ownership</option><option>Inherited</option><option>Other</option></select></label>
              <label className="form-field"><span>Purpose</span><select><option>Track only</option><option>Sell</option><option>Lease</option><option>Rent</option></select></label>
            </div>
            <div className="wizard-actions"><span className="muted">Step 1 of 3</span><button className="button button-primary" disabled={!name.trim() || !area || !survey.trim() || !taluka || !village} onClick={() => setStep(2)}>Continue <ArrowRight size={16} /></button></div>
          </div>
        )}
        {step === 2 && (
          <div className="wizard-content">
            <div><h2>Property documents</h2><p>Upload a sale deed, land record or property photo. PDF, JPG and PNG up to 10 MB.</p></div>
            <label className="upload-zone"><span className="upload-icon"><Plus size={20} /></span><strong>Choose files to upload</strong><small>or drag and drop files here</small><input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).map((file) => file.name))} /></label>
            {files.map((file) => <div className="file-row" key={file}><FileText size={17} /><span>{file}</span><span className="file-pending">Selected</span></div>)}
            <div className="upload-info"><ShieldCheck size={17} /><span>Preview only: file selection is local; secure upload and virus scanning require the API.</span></div>
            <div className="wizard-actions"><button className="button button-secondary" onClick={() => setStep(1)}><ChevronLeft size={16} />Back</button><button className="button button-primary" disabled={!files.length} onClick={() => setStep(3)}>Review details <ArrowRight size={16} /></button></div>
          </div>
        )}
        {step === 3 && (
          <div className="wizard-content">
            {notice ? <div className="success-panel"><span><Check size={22} /></span><div><h2>Registration started</h2><p>{notice}</p></div></div> : <div><h2>Review and pay</h2><p>Confirm your property details before continuing to checkout.</p></div>}
            <div className="review-card"><div><span>Property</span><strong>{name || 'New property'}</strong></div><div><span>Survey number</span><strong>{survey || '—'}</strong></div><div><span>Location</span><strong>{village || 'Village not selected'}, {district}, Telangana</strong></div><div><span>Property type</span><strong>{propertyType}</strong></div><div><span>Area</span><strong>{area || '—'} {unit}</strong></div><div><span>Ownership</span><strong>{ownership}</strong></div><div className="full"><span>Selected documents</span><strong>{files.join(', ')}</strong></div></div>
            <div className="charge-row"><span>One-time registration charge</span><strong>₹500.00</strong></div>
            <div className="upload-info"><ShieldCheck size={17} /><span>Payment is processed through hosted checkout. Card details are never stored by the NRI Land Tracking System.</span></div>
            <div className="wizard-actions"><button className="button button-secondary" onClick={() => setStep(2)}><ChevronLeft size={16} />Back</button><button className="button button-primary" onClick={() => { if (!notice) createDraft(); else { onPayment(createdPropertyId); setNotice('Sandbox checkout complete. Payment confirmation is simulated in this preview.'); } }}><Wallet size={16} />{notice.includes('Sandbox checkout') ? 'Payment confirmed' : notice ? 'Continue to sandbox checkout' : 'Create registration'}</button></div>
          </div>
        )}
      </section>
      <aside className="wizard-aside">
        <div className="aside-card"><span className="aside-icon"><ShieldCheck size={20} /></span><h3>Your property, protected</h3><p>Your information and property documents are private and only visible to you and authorized NRI Land Tracking System staff.</p></div>
        <div className="aside-card"><h3>Before you begin</h3><ul><li>Keep your survey number handy</li><li>Upload a readable ownership document</li><li>Confirm the Hyderabad area location</li></ul></div>
      </aside>
    </div>
  );
}

function AppointmentScreen() {
  const [selectedDay, setSelectedDay] = useState(12);
  const [selectedSlot, setSelectedSlot] = useState('10:30 AM');
  const [mode, setMode] = useState('VIDEO');
  const [booked, setBooked] = useState(false);
  const slots = ['09:00 AM', '10:30 AM', '01:00 PM', '03:00 PM', '04:30 PM'];
  return (
    <div className="appointment-grid">
      <section className="card appointment-card">
        <div><h2>Choose a date and time</h2><p>Times are shown in your local time and India Standard Time (IST).</p></div>
        <div className="calendar">
          <div className="calendar-header"><button aria-label="Previous month"><ChevronLeft size={17} /></button><strong>October 2026</strong><button aria-label="Next month"><ChevronRight size={17} /></button></div>
          <div className="calendar-days">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-dates">{[28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1].map((day, index) => <button key={`${day}-${index}`} className={`${index < 3 || index > 33 ? 'other-month' : ''} ${day === selectedDay && index >= 3 && index < 34 ? 'selected' : ''} ${index % 7 === 6 || index < 3 ? 'disabled-day' : ''}`} disabled={index % 7 === 6 || index < 3} onClick={() => setSelectedDay(day)}>{day}</button>)}</div>
        </div>
        <div className="slot-heading"><div><h3>Available time slots</h3><p>Wednesday, October {selectedDay}</p></div><span className="timezone-label"><Clock3 size={14} /> IST (UTC+5:30)</span></div>
        <div className="slot-list">{slots.map((slot) => <button key={slot} className={`slot-button ${selectedSlot === slot ? 'selected' : ''}`} onClick={() => setSelectedSlot(slot)}>{slot}<small>{slot.replace(' AM', '').replace(' PM', '')} IST</small></button>)}</div>
        <label className="form-field mode-field"><span>Appointment mode</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="VIDEO">Video call</option><option value="AUDIO">Audio call</option><option value="SITE_VISIT">Site visit</option></select></label>
        {booked && <div className="success-inline"><Check size={17} />Appointment request sent. The admin team will assign an agent.</div>}
        <button className="button button-primary button-wide" onClick={() => setBooked(true)}><CalendarDays size={17} />Confirm booking</button>
      </section>
      <aside className="card booking-summary"><div className="summary-icon"><CalendarDays size={20} /></div><h3>Your appointment</h3><div className="summary-item"><span>Property</span><strong>Green Valley Plot</strong></div><div className="summary-item"><span>Date</span><strong>Oct {selectedDay}, 2026</strong></div><div className="summary-item"><span>Time</span><strong>{selectedSlot} IST</strong></div><div className="summary-item"><span>Mode</span><strong>{mode.replace('_', ' ')}</strong></div><div className="summary-note">Your booking is confirmed after the property review is approved.</div></aside>
    </div>
  );
}

function AuditDetail({ property }: { property: Property | undefined }) {
  const [tab, setTab] = useState('Details');
  const tabs = ['Details', 'Documents', 'Payment', 'Appointments', 'Communication', 'Timeline'];
  if (!property) return <div className="card empty-state"><Building2 size={28} /><h2>Property not found</h2><p>Return to the property register to choose a record.</p><Link href="/audit/properties" className="button button-primary">Back to register</Link></div>;
  return (
    <>
      <div className="breadcrumbs"><Link href="/audit">Audit</Link><span>/</span><Link href="/audit/properties">Properties</Link><span>/</span><strong>{property.id}</strong></div>
      <PageHeading eyebrow="READ-ONLY RECORD" title={property.name} description={`${property.id} · ${property.location}`} action={<span className={`status-badge ${statusClasses[property.status]}`}><span />{property.status}</span>} />
      <div className="audit-tabs" role="tablist">{tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
      {tab === 'Details' && <div className="audit-detail-grid"><section className="card details-card"><h2>Property details</h2><div className="details-rows"><div><span>Property name</span><strong>{property.name}</strong></div><div><span>Registered by</span><strong>{property.owner}</strong></div><div><span>Property type</span><strong>Agricultural land</strong></div><div><span>Survey number</span><strong>142/3A</strong></div><div><span>Location</span><strong>{property.location}</strong></div><div><span>Area</span><strong>{property.area} {property.unit}</strong></div><div><span>State / city</span><strong>Telangana / Hyderabad</strong></div><div><span>Submitted</span><strong>{property.submitted}</strong></div></div></section><section className="card timeline-card"><h2>Status timeline</h2>{[['Property created', 'Draft registration started', 'Oct 05, 2026 · 10:32 AM'], ['Documents received', 'Documents submitted for review', 'Oct 06, 2026 · 02:18 PM'], ['Submitted for review', 'Awaiting admin review', property.submitted]].map(([title, description, time], index) => <div className="timeline-item" key={title}><span className={`timeline-marker ${index === 2 ? 'current' : ''}`} /><div><strong>{title}</strong><p>{description}</p><small>{time}</small></div></div>)}</section></div>}
      {tab !== 'Details' && <section className="card audit-placeholder"><ShieldCheck size={25} /><h2>{tab}</h2><p>This read-only audit record has no {tab.toLowerCase()} entries in the sample workspace.</p></section>}
    </>
  );
}

function SectionPage({ pathname, properties, agents, activeAgents, onReviewProperty, onReviewAgent }: {
  pathname: string;
  properties: Property[];
  agents: Agent[];
  activeAgents: number;
  onReviewProperty: (id: string, status: PropertyStatus) => Promise<void>;
  onReviewAgent: (id: string, status: AgentStatus, reason?: string) => Promise<void>;
}) {
  if (pathname === '/admin') return <AdminDashboard properties={properties} activeAgents={activeAgents} onReview={onReviewProperty} />;
  if (pathname === '/admin/agents') return <AgentDirectory agents={agents} onReview={onReviewAgent} />;
  if (pathname === '/admin/agents/new') return <><PageHeading eyebrow="AGENT MANAGEMENT" title="Invite an agent" description="Agent profiles are created by verified applicants and become assignable after admin approval." /><div className="card empty-state"><Users size={28} /><h2>Share the agent application</h2><p>Ask the agent to create an account, verify their mobile number, and submit their service areas. Their verified application will appear here for approval.</p><Link href="/agent/register" className="button button-primary">Open agent registration<ArrowRight size={16} /></Link></div></>;
  if (pathname === '/app/properties/new') return <><PageHeading eyebrow="MY PROPERTIES" title="Register a property" description="Add your land or property in a supported Telangana district in a few guided steps." /><PropertyRegistration /></>;
  if (pathname === '/app/appointments/new') return <><PageHeading eyebrow="APPOINTMENTS" title="Book an agent appointment" description="Select a convenient date and time to speak with your Hyderabad agent." /><AppointmentBooking /></>;
  if (pathname === '/app/payments') return <><PageHeading eyebrow="PAYMENT HISTORY" title="Payments" description="Track registration charges and provider-confirmed receipts." /><PaymentHistory /></>;
  if (pathname.startsWith('/audit/properties/')) {
    const id = pathname.split('/').at(-1);
    return <AuditDetail property={properties.find((property) => property.id === id)} />;
  }
  if (pathname === '/audit') return <><PageHeading eyebrow="READ-ONLY AUDIT" title="Audit overview" description="Independent visibility into property registrations, payments, and communications." /><div className="stats-grid"><StatCard title="Total properties" value={String(properties.length).padStart(2, '0')} change="Sample records" icon={Building2} /><StatCard title="Submitted" value={String(properties.filter((item) => item.status === 'Under review').length).padStart(2, '0')} change="Awaiting review" icon={ClipboardCheck} tone="amber" /><StatCard title="Approved" value={String(properties.filter((item) => item.status === 'Approved').length).padStart(2, '0')} change="Reviewed records" icon={ShieldCheck} tone="green" /><StatCard title="Payment records" value="—" change="Not connected in preview" icon={Wallet} tone="purple" /></div><PropertyTable properties={properties} audit /></>;
  if (pathname === '/audit/properties') return <><PageHeading eyebrow="AUDIT REGISTER" title="Property register" description="Search and filter registered properties across the supported Telangana districts." action={<button className="button button-secondary"><Filter size={16} />Filters</button>} /><PropertyTable properties={properties} audit /></>;
  if (pathname === '/admin/properties') {
    return <><PageHeading eyebrow="PROPERTY REVIEW" title="Property submissions" description="Review property registrations and update their status." /><PropertyTable properties={properties} onStatusChange={onReviewProperty} /></>;
  }
  if (pathname === '/app' || pathname === '/agent') {
    const isAgent = pathname === '/agent';
    const approved = properties.filter((property) => property.status === 'Approved').length;
    const underReview = properties.filter((property) => property.status === 'Under review').length;
    return (
      <>
        <PageHeading eyebrow={isAgent ? 'AGENT WORKSPACE' : 'MY PROPERTIES'} title={isAgent ? 'Welcome to your workspace' : 'Welcome back'} description={isAgent ? 'Your assigned properties and customer requests.' : 'Track your property registrations and connect with your local agent.'} action={!isAgent && <Link className="button button-primary" href="/app/properties/new"><Plus size={17} />Add property</Link>} />
        <section className="stats-grid">
          <StatCard title={isAgent ? 'Assigned properties' : 'My properties'} value={String(properties.length).padStart(2, '0')} change="Current records" icon={Building2} />
          <StatCard title="Approved properties" value={String(approved).padStart(2, '0')} change="Ready for appointments" icon={CheckCircle2} tone="green" />
          <StatCard title="Under review" value={String(underReview).padStart(2, '0')} change="Registration status" icon={ClipboardCheck} tone="amber" />
        </section>
        {!isAgent && <div className="dashboard-grid"><div className="card quick-card"><h2>Quick actions</h2><div className="quick-actions"><Link href="/app/properties/new"><Plus size={17} /><span><strong>Register a property</strong><small>Add land details and securely upload documents</small></span><ArrowRight size={16} /></Link><Link href="/app/appointments/new"><CalendarDays size={17} /><span><strong>Book an appointment</strong><small>Choose an available slot for an approved property</small></span><ArrowRight size={16} /></Link><Link href="/app/payments"><Wallet size={17} /><span><strong>View payments</strong><small>Check provider-confirmed payment status</small></span><ArrowRight size={16} /></Link></div></div><div className="card next-appointment"><span className="eyebrow">PROPERTY SUPPORT</span><h2>Need help?</h2><p>Register your property first. Appointment booking becomes available after approval.</p><Link href="/app/appointments/new" className="text-action">Check appointment availability <ArrowRight size={15} /></Link></div></div>}
        <PropertyTable properties={properties} />
      </>
    );
  }
  if (pathname.includes('properties')) return <><PageHeading eyebrow="PROPERTY REGISTER" title={pathname.startsWith('/audit') ? 'Property register' : 'My properties'} description="Review status and details for properties in the supported Telangana districts." action={!pathname.startsWith('/audit') && <Link className="button button-primary" href="/app/properties/new"><Plus size={17} />Register property</Link>} /><PropertyTable properties={properties} audit={pathname.startsWith('/audit')} /></>;
  const title = pathname.split('/').filter(Boolean).at(-1)?.replaceAll('-', ' ') ?? 'NRI Land Tracking System';
  const formattedTitle = title.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const roleAdmin = pathname.startsWith('/admin');
  const hasReadOnly = pathname.startsWith('/audit');
  return (
    <>
      <PageHeading eyebrow={hasReadOnly ? 'READ-ONLY AUDIT' : roleAdmin ? 'ADMINISTRATION' : 'MY PROPERTIES'} title={formattedTitle} description={hasReadOnly ? 'Read-only access to NRI Land Tracking System records and communication activity.' : 'Manage NRI Land Tracking System activity for the Hyderabad region.'} />
      {pathname.includes('appointment') ? <AppointmentScreen /> : pathname.includes('properties') ? <PropertyTable properties={properties} audit={hasReadOnly} /> : (
        <section className="card module-card">
          <div className="module-icon"><ClipboardCheck size={23} /></div>
          <h2>{formattedTitle}</h2>
          <p>This workspace is ready for {formattedTitle.toLowerCase()} data. Connect the API to replace sample records with live information.</p>
          {hasReadOnly ? <p className="read-only-note"><ShieldCheck size={15} />Auditor access is read-only. Changes are not available in this area.</p> : <Link href={roleAdmin ? '/admin/properties' : '/app'} className="button button-secondary">Return to overview <ArrowRight size={15} /></Link>}
        </section>
      )}
    </>
  );
}

export default function NriLandTrackingSystemPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: sessionLoading, error: sessionError, request, signOut } = useSession();
  const [properties, setProperties] = useState<Property[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgents, setActiveAgents] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState('');
  const currentPath = pathname || '/';
  const publicRoute = currentPath === '/login' || currentPath === '/register' || currentPath === '/agent/register' || currentPath === '/admin/register';
  const passwordRoute = currentPath === '/account/password';
  const role = user ? roleByAccount[user.role] : null;
  const routeRole = role ?? 'NRI';
  const permitted = Boolean(user && role && (
    (currentPath.startsWith('/admin') && user.role === 'ADMIN')
    || (currentPath.startsWith('/audit') && (user.role === 'ADMIN' || user.role === 'AUDITOR'))
    || (currentPath.startsWith('/agent') && user.role === 'AGENT')
    || (currentPath.startsWith('/app') && user.role === 'NRI')
    || passwordRoute
  ));

  const refreshRecords = useCallback(async () => {
    if (!user) return;
    setRecordsLoading(true);
    setRecordsError('');
    try {
      const propertyPath = user.role === 'ADMIN'
        ? 'admin/properties?page=1&pageSize=100'
        : user.role === 'AUDITOR'
          ? 'audit/properties?page=1&pageSize=100'
          : 'properties?page=1&pageSize=100';
      const result = await request<{ items: ApiProperty[] }>(propertyPath);
      setProperties(result.items.map(toProperty));
      if (user.role === 'ADMIN') {
        const [apiAgents, dashboard, districts] = await Promise.all([
          request<ApiAgent[]>('admin/agents'),
          request<{ activeAgents: number }>('admin/dashboard'),
          request<Array<{ id: string; name: string }>>('masters/districts')
        ]);
        const districtNames = new Map(districts.map((district) => [district.id, district.name]));
        setAgents(apiAgents.map((agent) => toAgent(agent, districtNames)));
        setActiveAgents(dashboard.activeAgents);
      } else {
        setAgents([]);
        setActiveAgents(0);
      }
    } catch (cause) {
      setRecordsError(cause instanceof Error ? cause.message : 'Unable to load workspace data from the NRI Land Tracking System API.');
    } finally {
      setRecordsLoading(false);
    }
  }, [request, user]);

  useEffect(() => {
    if (user && permitted && !passwordRoute) void refreshRecords();
  }, [currentPath, passwordRoute, permitted, refreshRecords, user]);

  const reviewProperty = useCallback(async (id: string, status: PropertyStatus) => {
    const action = status === 'Approved' ? 'approve' : 'reject';
    await request(`admin/properties/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      ...(action === 'reject' ? { body: JSON.stringify({ reason: 'Rejected by administrator.' }) } : {})
    });
    await refreshRecords();
  }, [refreshRecords, request]);

  const reviewAgent = useCallback(async (id: string, status: AgentStatus, reason?: string) => {
    const action = status === 'Approved' ? 'approve' : 'reject';
    await request(`admin/agents/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      ...(action === 'reject' ? { body: JSON.stringify({ reason }) } : {})
    });
    await refreshRecords();
  }, [refreshRecords, request]);

  useEffect(() => {
    if (sessionLoading) return;
    if (!user && currentPath === '/login') return;
    if (!user && currentPath === '/register') return;
    if (currentPath === '/agent/register') return;
    if (!user && currentPath === '/admin/register') return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if ((publicRoute && currentPath !== '/agent/register') || currentPath === '/') {
      router.replace(homeByRole[roleByAccount[user.role]]);
      return;
    }
    if (!permitted) router.replace(homeByRole[roleByAccount[user.role]]);
  }, [currentPath, permitted, publicRoute, router, sessionLoading, user]);

  if (sessionLoading) return <div className="app-loading" aria-label="Loading NRI Land Tracking System" />;
  if (currentPath === '/login') return <LoginPage />;
  if (currentPath === '/register') return <NriRegistrationPage />;
  if (currentPath === '/agent/register') return <AgentRegistrationPage />;
  if (currentPath === '/admin/register' && !user) return <AdminRegistrationPage />;
  if (!user || !role || !permitted || currentPath === '/' || (recordsLoading && !passwordRoute)) return <div className="app-loading" aria-label="Loading NRI Land Tracking System" />;

  const handleSignOut = () => {
    void signOut().then(() => router.replace('/login')).catch((cause: unknown) => {
      console.error('NRI Land Tracking System sign-out request failed.', cause);
      router.replace('/login');
    });
  };

  return (
    <main className="app-shell">
      <Header role={role} name={user.name} onSignOut={handleSignOut} />
      <div className="app-body">
        <Sidebar role={routeRole} pathname={currentPath} />
        <div className="main-column">
          <main className="page-content">
            {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
            {passwordRoute
              ? <PasswordChangePage />
              : recordsError
              ? <section className="card empty-state"><h2>Workspace data unavailable</h2><p role="alert">{recordsError}</p><button className="button button-primary" onClick={() => { void refreshRecords(); }}>Try again</button></section>
              : <SectionPage pathname={currentPath} properties={properties} agents={agents} activeAgents={activeAgents} onReviewProperty={reviewProperty} onReviewAgent={reviewAgent} />}
          </main>
          <footer className="app-footer"><span>NRI Land Tracking System · Hyderabad, Telangana</span><span>Secure account workspace</span></footer>
        </div>
      </div>
    </main>
  );
}
