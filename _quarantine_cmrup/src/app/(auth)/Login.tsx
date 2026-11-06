import { useState, useEffect } from 'react';
import { Navigation, CarFront, Bike, Users, ArrowRight, Mail, Lock, User, Phone, Loader2, ShieldCheck, Globe } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useCountry } from '@/lib/country-config';
import type { UserRole } from '@/lib/types';
import { supabase } from '@/lib/supabase';

const roles: { id: UserRole; label: string; desc: string; icon: typeof CarFront; tint: string }[] = [
  { id: 'customer', label: 'Customer', desc: 'Book rides and co-rides', icon: Users, tint: 'border-teal-500 bg-teal-50 text-teal-700' },
  { id: 'driver', label: 'Driver', desc: 'Accept trips and earn', icon: Bike, tint: 'border-amber-500 bg-amber-50 text-amber-700' },
  { id: 'owner', label: 'Private owner', desc: 'Offer co-riding seats', icon: CarFront, tint: 'border-orange-500 bg-orange-50 text-orange-700' },
  { id: 'admin', label: 'Admin', desc: 'Manage the platform', icon: ShieldCheck, tint: 'border-violet-500 bg-violet-50 text-violet-700' },
];

export default function Login() {
  const { signIn, signUp } = useAuth();
  const { country, setCountryCode, formatCurrency } = useCountry();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [role, setRole] = useState<UserRole>('customer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [countries, setCountries] = useState<{ code: string; name: string; flag_emoji: string | null; payment_methods: string[] }[]>([]);
  const [showCountries, setShowCountries] = useState(false);

  useEffect(() => {
    supabase.from('countries').select('code, name, flag_emoji, payment_methods').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setCountries(data as { code: string; name: string; flag_emoji: string | null; payment_methods: string[] }[]);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      const { error } = await signUp(email, password, fullName, phone, role);
      if (error) setError(error);
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0d2f35] lg:flex-row">
      <div className="relative flex flex-1 flex-col justify-between overflow-hidden p-8 text-white lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,rgba(233,245,91,0.12),transparent_40%),radial-gradient(circle_at_75%_70%,rgba(45,160,140,0.18),transparent_40%)]" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e9f55b] text-[#0d2f35]"><Navigation size={22} strokeWidth={2.8} /></div>
          <span className="font-display text-2xl font-semibold tracking-tight">Njanga</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight lg:text-5xl">Move {country.name} forward.</h1>
          <p className="mt-4 text-base text-[#a8c5c6]">One platform for riders, drivers, and private owners. Daily transport, private driver, airport, travel & delivery — built for local payments.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {country.payment_methods.map((m) => {
              const cls = m === 'MTN MoMo' ? 'bg-[#ffcc00] text-[#1a1a1a]' : m === 'Orange Money' ? 'bg-[#ff7900] text-white' : m === 'Cash' ? 'bg-white/10 text-white' : 'bg-white/10 text-white';
              return <span key={m} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${cls}`}>{m}</span>;
            })}
          </div>
        </div>
        <p className="relative text-xs text-[#6f8c8d]">Trusted by drivers across {country.name}.</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-[#f6f8f9] p-6 lg:p-10">
        <div className="w-full max-w-md">
          {/* Country selector */}
          {countries.length > 1 && (
            <div className="mb-4 flex justify-end">
              <div className="relative">
                <button onClick={() => setShowCountries(!showCountries)} className="flex items-center gap-2 rounded-xl border border-[#e1e9e9] bg-white px-3 py-2 text-xs font-semibold text-[#45656a] transition hover:bg-[#f5f8f8]">
                  <Globe size={14} /> {country.flag_emoji} {country.name} <ArrowRight size={12} className={`transition ${showCountries ? 'rotate-90' : ''}`} />
                </button>
                {showCountries && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-[#e1e9e9] bg-white shadow-lg">
                    {countries.map((c) => (
                      <button key={c.code} onClick={() => { setCountryCode(c.code); setShowCountries(false); }} className={`flex w-full items-center gap-2 border-b border-[#f0f4f4] px-3 py-2.5 text-left text-xs font-semibold transition last:border-0 hover:bg-[#f5f8f8] ${c.code === country.code ? 'text-[#0d7770]' : 'text-[#45656a]'}`}>
                        <span>{c.flag_emoji}</span> {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mb-6 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
            {(['signin', 'signup'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${mode === m ? 'bg-[#0d2f35] text-white' : 'text-[#759092] hover:text-[#0d2f35]'}`}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-[#e1e9e9] bg-white p-6 shadow-[0_8px_30px_rgba(20,60,65,0.06)] sm:p-7">
            {mode === 'signup' && (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#759092]">I am a...</p>
                <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {roles.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button key={r.id} type="button" onClick={() => setRole(r.id)} className={`rounded-xl border p-3 text-center transition ${role === r.id ? r.tint : 'border-[#e1e9e9] text-[#759092] hover:border-[#b5c9c9]'}`}>
                        <Icon size={20} className="mx-auto" />
                        <span className="mt-1.5 block text-xs font-semibold">{r.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <form onSubmit={submit} className="space-y-3">
              {mode === 'signup' && (
                <>
                  <Field icon={<User size={16} />} placeholder="Full name" value={fullName} onChange={setFullName} required />
                  <Field icon={<Phone size={16} />} placeholder="Phone number" value={phone} onChange={setPhone} required />
                </>
              )}
              <Field icon={<Mail size={16} />} placeholder="Email address" type="email" value={email} onChange={setEmail} required />
              <Field icon={<Lock size={16} />} placeholder="Password" type="password" value={password} onChange={setPassword} required />

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{error}</p>}

              <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <>{mode === 'signin' ? 'Sign in' : 'Create account'} <ArrowRight size={17} /></>}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-[#9aabad]">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }} className="font-semibold text-[#0d8179] hover:underline">
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon, placeholder, value, onChange, type = 'text', required }: { icon: React.ReactNode; placeholder: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aabad]">{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 pl-10 pr-3 text-sm outline-none transition focus:border-[#0d8179]"
      />
    </div>
  );
}
