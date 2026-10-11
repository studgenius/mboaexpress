import { useState, useEffect } from 'react';
import { Users, UserPlus, Star, Trash2, Phone, ShieldCheck, Heart, X, Loader2, CheckCircle2, AlertCircle, Share2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCountry } from '@/lib/country-config';
import { PageHeader, Card, EmptyState, Spinner, SectionHeader } from '@/components/ui';
import type { EmergencyContact } from '@/lib/types';

const RELATIONSHIPS = ['Family', 'Partner', 'Friend', 'Colleague', 'Neighbour', 'Other'];

export function NjangaCircle() {
  const { profile } = useAuth();
  const { country } = useCountry();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const { data, error: loadError } = await supabase
      .from('emergency_contacts')
      .select('*')
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (!loadError && data) setContacts(data as EmergencyContact[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => { setName(''); setRelationship(RELATIONSHIPS[0]); setPhone(''); setError(''); setShowForm(false); };

  const addContact = async () => {
    const digits = phone.replace(/\D/g, '');
    if (!name.trim() || digits.length < 8) { setError('Enter a name and a valid phone number.'); return; }
    setSaving(true);
    setError('');
    const fullPhone = phone.trim().startsWith('+') ? phone.trim() : `${country.dial_code} ${phone.trim()}`;
    const { error: insertError } = await supabase.from('emergency_contacts').insert({
      name: name.trim(), relationship, phone: fullPhone, is_primary: contacts.length === 0,
    });
    setSaving(false);
    if (insertError) { console.error('add contact failed', insertError); setError('Could not add this contact. Please try again.'); return; }
    resetForm();
    await load();
  };

  const makePrimary = async (id: string) => {
    setBusyId(id);
    const others = contacts.filter((c) => c.is_primary && c.id !== id);
    for (const c of others) {
      await supabase.from('emergency_contacts').update({ is_primary: false }).eq('id', c.id);
    }
    await supabase.from('emergency_contacts').update({ is_primary: true }).eq('id', id);
    setBusyId(null);
    await load();
  };

  const removeContact = async (id: string) => {
    setBusyId(id);
    await supabase.from('emergency_contacts').delete().eq('id', id);
    setBusyId(null);
    await load();
  };

  return (
    <>
      <PageHeader title="Njanga Circle" subtitle="Your circle of trusted people. They can follow your rides and are the first to be alerted if you ever need help." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-[#eef2f2] px-5 py-4">
              <SectionHeader title="Trusted contacts" subtitle="People we alert on your behalf in an emergency." />
              {!showForm && (
                <button onClick={() => setShowForm(true)} className="flex shrink-0 items-center gap-2 rounded-xl bg-[#0d2f35] px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#174850]"><UserPlus size={15} /> Add contact</button>
              )}
            </div>

            {showForm && (
              <div className="space-y-3 border-b border-[#eef2f2] bg-[#f7faf9] p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Full name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marie Ngono" className="w-full rounded-xl border border-[#dce7e6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Relationship</label>
                    <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]">
                      {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Phone number</label>
                  <div className="flex items-center gap-2 rounded-xl border border-[#dce7e6] bg-white px-3 focus-within:border-[#0d8179]">
                    <Phone size={15} className="text-[#9aabad]" />
                    <span className="text-sm font-medium text-[#45656a]">{country.dial_code}</span>
                    <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ''))} inputMode="tel" placeholder="6 12 34 56 78" className="flex-1 bg-transparent py-2.5 text-sm outline-none" />
                  </div>
                </div>
                {error && <p className="flex items-center gap-1.5 text-xs font-medium text-[#c9483a]"><AlertCircle size={13} /> {error}</p>}
                <div className="flex gap-2">
                  <button onClick={addContact} disabled={saving} className="flex items-center gap-2 rounded-xl bg-[#0d7770] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0b665f] disabled:opacity-60">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving...</> : <><CheckCircle2 size={15} /> Save contact</>}</button>
                  <button onClick={resetForm} className="rounded-xl border border-[#dce7e6] px-4 py-2.5 text-sm font-semibold text-[#45656a] transition hover:bg-white">Cancel</button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="p-8"><Spinner /></div>
            ) : contacts.length === 0 ? (
              <div className="p-6"><EmptyState icon={<Users size={22} />} title="Your circle is empty" subtitle="Add the people you trust so they can look out for you on every ride." /></div>
            ) : (
              <ul className="divide-y divide-[#eef2f2]">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e7f4f0] text-sm font-bold text-[#0d7770]">{c.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#0d2f35]">{c.name}</p>
                        {c.is_primary && <span className="flex items-center gap-1 rounded-full bg-[#fff7e0] px-2 py-0.5 text-[10px] font-bold text-[#b58a1a]"><Star size={10} fill="currentColor" /> Primary</span>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{c.relationship} · {c.phone}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {busyId === c.id ? <Loader2 size={16} className="animate-spin text-[#9aabad]" /> : (
                        <>
                          {!c.is_primary && <button onClick={() => makePrimary(c.id)} title="Make primary" className="rounded-lg p-2 text-[#9aabad] transition hover:bg-[#fff7e0] hover:text-[#b58a1a]"><Star size={16} /></button>}
                          <button onClick={() => removeContact(c.id)} title="Remove" className="rounded-lg p-2 text-[#9aabad] transition hover:bg-[#fdeeea] hover:text-[#c9483a]"><Trash2 size={16} /></button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="relative bg-[#0d2f35] p-5 text-white">
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#e9f55b]/10" />
              <div className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#a8c5c6]"><Heart size={14} /> How it works</div>
              <ul className="relative mt-3 space-y-3 text-xs leading-relaxed text-[#cfe0e0]">
                <li className="flex gap-2.5"><Share2 size={15} className="mt-0.5 shrink-0 text-[#e9f55b]" /> Share any active ride so your circle can follow your route live.</li>
                <li className="flex gap-2.5"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#e9f55b]" /> If you trigger an SOS, your circle is alerted alongside the authorities.</li>
                <li className="flex gap-2.5"><Star size={15} className="mt-0.5 shrink-0 text-[#e9f55b]" /> Your primary contact is reached first, then the rest of your circle.</li>
              </ul>
            </div>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-semibold text-[#0d2f35]">{contacts.length} {contacts.length === 1 ? 'person' : 'people'} in your circle</p>
            <p className="mt-1 text-xs leading-relaxed text-[#8ba0a2]">We recommend adding at least two trusted contacts. Only you can see and manage this list, and {profile?.full_name ?? 'you'} stay{profile?.full_name ? 's' : ''} in control at all times.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
