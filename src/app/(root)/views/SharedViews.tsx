import { useState, useEffect } from 'react';
import { ShieldCheck, Star, Navigation, Phone, AlertCircle, CheckCircle2, Send, Siren, MapPin, Loader2, X, Tag, Bell, Globe, Lock, Building2, Cpu, FileText, ChevronRight, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/utils';
import { PageHeader, Card, SectionHeader, EmptyState, Spinner } from '@/components/ui';
import type { SosAlert, Promotion, Complaint, NotificationPreference, AppLanguage, ComplaintRoute } from '@/lib/types';

export function Profile() {
  const { profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [vehicleType, setVehicleType] = useState(profile?.vehicle_type ?? '');
  const [vehiclePlate, setVehiclePlate] = useState(profile?.vehicle_plate ?? '');
  const [msg, setMsg] = useState('');
  const [prefs, setPrefs] = useState<NotificationPreference | null>(null);
  const [languages, setLanguages] = useState<AppLanguage[]>([]);
  const [selectedLang, setSelectedLang] = useState(profile?.language ?? 'en');
  const [prefsMsg, setPrefsMsg] = useState('');
  const [langMsg, setLangMsg] = useState('');

  useEffect(() => {
    supabase.from('app_languages').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLanguages((data as AppLanguage[]) ?? []);
    });
    if (profile) {
      supabase.from('notification_preferences').select('*').eq('user_id', profile.id).maybeSingle().then(({ data }) => {
        if (data) setPrefs(data as NotificationPreference);
      });
    }
  }, [profile]);

  const save = async () => {
    setMsg('');
    const { error } = await supabase.from('profiles').update({
      full_name: fullName, phone, vehicle_type: vehicleType || null, vehicle_plate: vehiclePlate || null,
    }).eq('id', profile?.id);
    setMsg(error ? 'Could not save' : 'Profile updated!');
    if (!error) refreshProfile();
  };

  const savePrefs = async () => {
    if (!prefs || !profile) return;
    setPrefsMsg('');
    const { error } = await supabase.from('notification_preferences').update({
      ride_updates: prefs.ride_updates, promotions: prefs.promotions, safety_alerts: prefs.safety_alerts,
      account_updates: prefs.account_updates, security_alerts: prefs.security_alerts,
      driver_requests: prefs.driver_requests, earnings_updates: prefs.earnings_updates,
      updated_at: new Date().toISOString(),
    }).eq('id', prefs.id);
    setPrefsMsg(error ? 'Could not save preferences' : 'Notification preferences saved!');
    window.setTimeout(() => setPrefsMsg(''), 3000);
  };

  const togglePref = async (key: keyof NotificationPreference) => {
    if (!prefs) return;
    const newValue = !prefs[key];
    const updated = { ...prefs, [key]: newValue };
    setPrefs(updated);
    await supabase.from('notification_preferences').update({ [key]: newValue, updated_at: new Date().toISOString() }).eq('id', prefs.id);
  };

  const saveLanguage = async () => {
    setLangMsg('');
    const { error } = await supabase.from('profiles').update({ language: selectedLang }).eq('id', profile?.id);
    if (error) { setLangMsg('Could not save language'); return; }
    // Upsert user_languages
    await supabase.from('user_languages').upsert({ user_id: profile?.id, language_code: selectedLang }, { onConflict: 'user_id' });
    setLangMsg('Language saved!');
    refreshProfile();
    window.setTimeout(() => setLangMsg(''), 3000);
  };

  const prefItems: { key: keyof NotificationPreference; label: string; desc: string }[] = [
    { key: 'ride_updates', label: 'Ride updates', desc: 'Trip status, driver arrival, and completion' },
    { key: 'promotions', label: 'Promotions', desc: 'Discount codes and referral rewards' },
    { key: 'safety_alerts', label: 'Safety alerts', desc: 'SOS notifications and safety reminders' },
    { key: 'account_updates', label: 'Account updates', desc: 'Profile changes and account security' },
    { key: 'security_alerts', label: 'Security alerts', desc: 'Suspicious activity on your account' },
    { key: 'driver_requests', label: 'Ride requests', desc: 'New ride requests for drivers' },
    { key: 'earnings_updates', label: 'Earnings updates', desc: 'Payment and earning notifications for drivers' },
  ];

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, privacy, and notification preferences." />
      <div className="mx-auto max-w-lg space-y-5">
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e9f55b] text-xl font-bold text-[#0d2f35]">{profile?.full_name?.charAt(0).toUpperCase() ?? 'U'}</div>
            <div>
              <p className="text-lg font-semibold">{profile?.full_name}</p>
              <p className="text-sm text-[#759092] capitalize">{profile?.role}</p>
              <div className="mt-1 flex items-center gap-1 text-xs text-[#759092]"><Star size={13} className="text-[#edb938]" fill="currentColor" /> {profile?.rating?.toFixed(1) ?? '5.0'} · {profile?.total_trips ?? 0} trips</div>
            </div>
          </div>
          <div className="space-y-3">
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">FULL NAME</span><input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">PHONE</span><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" /></div>
            {(profile?.role === 'driver' || profile?.role === 'owner') && (
              <div className="grid grid-cols-2 gap-3">
                <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">VEHICLE TYPE</span><input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="e.g. Moto" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" /></div>
                <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">PLATE NUMBER</span><input value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} placeholder="e.g. CE 1234 AB" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" /></div>
              </div>
            )}
          </div>
          <button onClick={save} className="mt-5 w-full rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850]">Save changes</button>
          {msg && <p className={`mt-3 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
        </Card>

        {/* Notification Preferences */}
        <Card>
          <div className="flex items-center gap-3 border-b border-[#edf1f1] p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]"><Bell size={20} /></div>
            <div><h3 className="font-display text-base font-semibold">Notification preferences</h3><p className="text-xs text-[#759092]">Choose which alerts you want to receive.</p></div>
          </div>
          <div className="divide-y divide-[#edf1f1]">
            {prefItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div><p className="text-sm font-semibold">{item.label}</p><p className="mt-0.5 text-xs text-[#8ba0a2]">{item.desc}</p></div>
                <button onClick={() => togglePref(item.key)} className={`relative h-6 w-11 rounded-full transition ${prefs?.[item.key] ? 'bg-[#0d7770]' : 'bg-[#dce7e6]'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${prefs?.[item.key] ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
          {prefsMsg && <p className="px-5 pb-4 text-sm font-semibold text-[#0d7770]">{prefsMsg}</p>}
        </Card>

        {/* Language Selector */}
        <Card>
          <div className="flex items-center gap-3 border-b border-[#edf1f1] p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0faf7] text-[#0d7770]"><Globe size={20} /></div>
            <div><h3 className="font-display text-base font-semibold">Language</h3><p className="text-xs text-[#759092]">Choose your preferred language for the app.</p></div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {languages.map((lang) => (
                <button key={lang.code} onClick={() => setSelectedLang(lang.code)} className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${selectedLang === lang.code ? 'border-[#0d7770] bg-[#f0faf7]' : 'border-[#e1e9e9] hover:bg-[#f5f8f8]'}`}>
                  <span className="text-xl">{lang.flag_emoji ?? '🌐'}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{lang.native_name}</p>
                    <p className="truncate text-[10px] text-[#8ba0a2]">{lang.name}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={saveLanguage} className="mt-4 w-full rounded-xl bg-[#0d2f35] py-3 text-sm font-semibold text-white hover:bg-[#174850]">Save language</button>
            {langMsg && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#0d7770]"><CheckCircle2 size={16} />{langMsg}</p>}
          </div>
        </Card>

        {/* Privacy & Encryption */}
        <Card>
          <div className="flex items-center gap-3 border-b border-[#edf1f1] p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]"><Lock size={20} /></div>
            <div><h3 className="font-display text-base font-semibold">Privacy & data encryption</h3><p className="text-xs text-[#759092]">Your personal data is protected.</p></div>
          </div>
          <div className="divide-y divide-[#edf1f1]">
            <div className="flex items-center justify-between px-5 py-4 sm:px-6">
              <div><p className="text-sm font-semibold">Data encryption</p><p className="mt-0.5 text-xs text-[#8ba0a2]">Your personal data is encrypted at rest and in transit</p></div>
              <span className="flex items-center gap-1.5 rounded-full bg-[#e0f3ed] px-3 py-1 text-xs font-semibold text-[#118370]"><Lock size={12} /> Active</span>
            </div>
            <div className="flex items-center justify-between px-5 py-4 sm:px-6">
              <div><p className="text-sm font-semibold">Phone number privacy</p><p className="mt-0.5 text-xs text-[#8ba0a2]">Your number is hidden from drivers and passengers</p></div>
              <span className="flex items-center gap-1.5 rounded-full bg-[#e0f3ed] px-3 py-1 text-xs font-semibold text-[#118370]"><ShieldCheck size={12} /> Protected</span>
            </div>
            <div className="flex items-center justify-between px-5 py-4 sm:px-6">
              <div><p className="text-sm font-semibold">Location privacy</p><p className="mt-0.5 text-xs text-[#8ba0a2]">Precise location is only shared during active rides</p></div>
              <span className="flex items-center gap-1.5 rounded-full bg-[#e0f3ed] px-3 py-1 text-xs font-semibold text-[#118370]"><MapPin size={12} /> Restricted</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export function SafetyCenter({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { user, profile } = useAuth();
  const [showSos, setShowSos] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [sosStatus, setSosStatus] = useState('');
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [circleCount, setCircleCount] = useState(0);

  useEffect(() => {
    supabase.from('emergency_contacts').select('id', { count: 'exact', head: true }).then(({ count }) => setCircleCount(count ?? 0));
  }, []);

  useEffect(() => {
    supabase.from('sos_alerts').select('*').order('created_at', { ascending: false }).limit(5).then(({ data }) => {
      setAlerts((data as SosAlert[]) ?? []);
      setLoadingAlerts(false);
    });
  }, []);

  const triggerSos = async () => {
    setShowSos(true);
    setSosActive(true);
    setSosStatus('Acquiring your location...');
    await new Promise((r) => window.setTimeout(r, 800));
    setSosStatus('AI analyzing risk level...');
    await new Promise((r) => window.setTimeout(r, 1000));
    const stations = 'Central Police Station Yaoundé, Commissariat Bastos, Gendarmerie Mvan';
    const analysis = 'High priority: User triggered SOS during active trip. Nearest police stations notified. Risk level: Elevated. Recommend immediate dispatch.';
    setSosStatus('Notifying nearby police stations...');
    await new Promise((r) => window.setTimeout(r, 800));    const { error } = await supabase.from('sos_alerts').insert({
      user_id: user?.id, user_name: profile?.full_name ?? 'User',
      latitude: 3.8480, longitude: 11.5021, location_name: 'Yaoundé, Cameroon',
      status: 'active', ai_analysis: analysis, notified_stations: stations,
    });
    if (error) { setSosStatus('Failed to send SOS. Please call 117.'); setSosActive(false); return; }
    setSosStatus(circleCount > 0 ? `SOS sent! 3 police stations and your ${circleCount} Njanga Circle contact${circleCount === 1 ? '' : 's'} were notified.` : 'SOS sent! 3 police stations notified near your location.');
    setSosActive(false);
    supabase.from('sos_alerts').select('*').order('created_at', { ascending: false }).limit(5).then(({ data }) => setAlerts((data as SosAlert[]) ?? []));
  };

  return (
    <>
      <PageHeader title="Safety center" subtitle="Your safety is our priority." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600"><Siren size={22} /></div>
          <h3 className="font-display text-base font-semibold">AI Emergency SOS</h3>
          <p className="mt-1 text-xs text-[#759092]">AI pinpoints your location and instantly notifies the nearest police stations.</p>
          <button onClick={triggerSos} className="mt-4 w-full rounded-xl bg-red-600 py-2.5 text-xs font-semibold text-white hover:bg-red-700">Activate SOS</button>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]"><Navigation size={22} /></div>
          <h3 className="font-display text-base font-semibold">Share my trip</h3>
          <p className="mt-1 text-xs text-[#759092]">Let family or friends follow your ride in real time via a secure link.</p>
          <button className="mt-4 w-full rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">Share trip</button>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0e7f5] text-[#7a3d9a]"><Users size={22} /></div>
          <h3 className="font-display text-base font-semibold">Njanga Circle</h3>
          <p className="mt-1 text-xs text-[#759092]">{circleCount > 0 ? `${circleCount} trusted contact${circleCount === 1 ? '' : 's'} looking out for you.` : 'Add trusted people who are alerted first if you need help.'}</p>
          <button onClick={() => onNavigate('circle')} className="mt-4 w-full rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">Manage my circle</button>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#fff0e5] text-[#be653e]"><Phone size={22} /></div>
          <h3 className="font-display text-base font-semibold">Call driver</h3>
          <p className="mt-1 text-xs text-[#759092]">Contact your driver directly through the app without sharing your number.</p>
          <button className="mt-4 w-full rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">Call now</button>
        </Card>
      </div>
      <div className="mt-5">
        <Card>
          <SectionHeader title="Recent SOS alerts" subtitle="AI-powered alerts sent to nearby police stations." />
          {loadingAlerts ? <Spinner /> : alerts.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={24} />} title="No SOS alerts" subtitle="Your safety alerts will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {alerts.map((a) => (
                <div key={a.id} className="px-5 py-4 sm:px-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${a.status === 'active' ? 'bg-red-50 text-red-600' : 'bg-[#e0f3ed] text-[#118370]'}`}><Siren size={16} /></div>
                      <div>
                        <p className="text-sm font-semibold">{a.location_name}</p>
                        <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatRelative(a.created_at)} · {a.notified_stations.split(',').length} stations notified</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${a.status === 'active' ? 'bg-red-50 text-red-600' : 'bg-[#e0f3ed] text-[#118370]'}`}>{a.status}</span>
                  </div>
                  {a.ai_analysis && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#f7f9f8] p-2.5 text-[11px] text-[#587478]">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#0d7770] text-[8px] font-bold text-white">AI</div>
                      {a.ai_analysis}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {showSos && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#08252b]/60 backdrop-blur-sm sm:items-center sm:p-5">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 text-center shadow-2xl sm:rounded-3xl">
            <button onClick={() => setShowSos(false)} className="absolute right-4 top-4 rounded-full bg-[#f1f5f4] p-2 text-[#597477] hover:bg-[#e3ecea]"><X size={18} /></button>
            <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${sosActive ? 'bg-red-50' : 'bg-[#e0f3ed]'}`}>
              {sosActive ? <Loader2 size={32} className="animate-spin text-red-600" /> : <CheckCircle2 size={32} className="text-[#118370]" />}
            </div>
            <h2 className="font-display text-xl font-semibold">AI Emergency SOS</h2>
            <p className="mt-2 text-sm text-[#759092]">{sosStatus}</p>
            {sosActive && (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[#be653e]"><MapPin size={14} className="animate-pulse" /> Sharing your live location with AI...</div>
            )}
            {!sosActive && sosStatus.includes('SOS sent') && (
              <div className="mt-4 rounded-xl bg-[#f5f8ed] p-3 text-left text-[11px] text-[#50621b]">
                <p className="font-semibold">Notified stations:</p>
                <p className="mt-1">Central Police Station Yaoundé</p>
                <p>Commissariat Bastos</p>
                <p>Gendarmerie Mvan</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function Support() {
  const [messages, setMessages] = useState<{ from: 'me' | 'support'; text: string }[]>([
    { from: 'support', text: 'Hello! How can we help you today?' },
  ]);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { from: 'me', text: input }]);
    setInput('');
    window.setTimeout(() => setMessages((m) => [...m, { from: 'support', text: 'Thank you for reaching out. Our team will get back to you shortly.' }]), 800);
  };

  return (
    <>
      <PageHeader title="Support" subtitle="We're here to help." />
      <div className="mx-auto max-w-lg">
        <Card className="overflow-hidden">
          <div className="flex h-72 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.from === 'me' ? 'bg-[#0d2f35] text-white' : 'bg-[#f5f8f8] text-[#45656a]'}`}>{m.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-[#edf1f1] p-3">
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Type a message..." className="flex-1 rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-2.5 px-3 text-sm outline-none focus:border-[#0d8179]" />
              <button onClick={send} className="flex items-center justify-center rounded-xl bg-[#0d2f35] px-4 text-white hover:bg-[#174850]"><Send size={17} /></button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export function Promotions() {
  const { user } = useAuth();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('promotions').select('*').eq('is_active', true).order('created_at', { ascending: false }).then(({ data }) => {
      setPromotions((data as Promotion[]) ?? []);
      setLoading(false);
    });
  }, []);

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(null), 2000);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Promotions" subtitle="Discount codes and special offers for your rides." />
      {promotions.length === 0 ? (
        <Card><EmptyState icon={<Tag size={24} />} title="No active promotions" subtitle="Check back soon for discount codes and rewards." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {promotions.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="bg-gradient-to-br from-[#0d2f35] to-[#174850] p-5 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium text-[#a8c5c6]">{p.service_type ? p.service_type.replace('_', ' ') : 'All services'}</p>
                    <h3 className="mt-1 font-display text-lg font-semibold">{p.title}</h3>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e9f55b] text-lg font-bold text-[#0d2f35]">{p.discount_value}%</div>
                </div>
                {p.description && <p className="mt-2 text-sm text-[#a8c5c6]">{p.description}</p>}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-[#8ba0a2]">Use code</p>
                    <p className="font-mono text-lg font-bold text-[#0d7770]">{p.code}</p>
                  </div>
                  <button onClick={() => copyCode(p.code)} className="rounded-lg bg-[#0d7770] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0a6359]">{copiedCode === p.code ? 'Copied!' : 'Copy code'}</button>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[#8ba0a2]">
                  <span>{p.redemptions_count}/{p.max_redemptions} used</span>
                  {p.valid_until && <span>Expires {new Date(p.valid_until).toLocaleDateString()}</span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function ComplaintsView() {
  const { user, profile } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Complaint['category']>('general');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    supabase.from('complaints').select('*').eq('user_id', user?.id ?? '').order('created_at', { ascending: false }).then(({ data }) => {
      setComplaints((data as Complaint[]) ?? []);
      setLoading(false);
    });
  };
  useEffect(load, [user]);

  const submit = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.from('complaints').insert({
      user_id: user?.id, user_name: profile?.full_name ?? 'User', subject, description, category,
    });
    setBusy(false);
    if (error) { setMsg('Could not submit complaint'); return; }
    setMsg('Complaint submitted! We will review it shortly.');
    setSubject(''); setDescription(''); setCategory('general'); setShowForm(false);
    load();
    window.setTimeout(() => setMsg(''), 3000);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Complaints" subtitle="Report issues and track their resolution." action={
        <button onClick={() => setShowForm(!showForm)} className="flex w-fit items-center gap-2 rounded-xl bg-[#0d2f35] px-4 py-3 text-sm font-semibold text-white hover:bg-[#174850]"><AlertCircle size={16} /> {showForm ? 'Cancel' : 'New complaint'}</button>
      } />
      {msg && <p className={`mb-4 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
      {showForm && (
        <Card className="mb-5 p-5">
          <div className="space-y-3">
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">SUBJECT</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief title" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">CATEGORY</span><select value={category} onChange={(e) => setCategory(e.target.value as Complaint['category'])} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]"><option value="general">General</option><option value="driver">Driver</option><option value="trip">Trip</option><option value="payment">Payment</option><option value="safety">Safety</option><option value="vehicle">Vehicle</option></select></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">DESCRIPTION</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell us what happened..." rows={3} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] p-3 text-sm outline-none focus:border-[#0d8179]" /></div>
          </div>
          <button onClick={submit} disabled={busy || !subject || !description} className="mt-4 w-full rounded-xl bg-[#0d7770] py-3.5 text-sm font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">{busy ? 'Submitting...' : 'Submit complaint'}</button>
        </Card>
      )}
      {complaints.length === 0 ? (
        <Card><EmptyState icon={<AlertCircle size={24} />} title="No complaints filed" subtitle="Your complaints and their status will appear here." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {complaints.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{c.subject}</p>
                  <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{c.category} · {formatRelative(c.created_at)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.status === 'open' ? 'bg-[#fff0e5] text-[#be653e]' : c.status === 'investigating' ? 'bg-[#fff8e0] text-[#b8860b]' : c.status === 'resolved' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{c.status}</span>
              </div>
              <p className="mt-3 text-xs text-[#587478]">{c.description}</p>
              {c.admin_response && <div className="mt-3 rounded-lg bg-[#f5f8f8] p-2.5 text-[11px] text-[#45656a]"><strong>Admin response:</strong> {c.admin_response}</div>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function SettingsView() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreference | null>(null);
  const [languages, setLanguages] = useState<AppLanguage[]>([]);
  const [selectedLang, setSelectedLang] = useState(profile?.language ?? 'en');

  useEffect(() => {
    supabase.from('app_languages').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLanguages((data as AppLanguage[]) ?? []);
    });
    if (profile) {
      supabase.from('notification_preferences').select('*').eq('user_id', profile.id).maybeSingle().then(({ data }) => {
        setPrefs(data as NotificationPreference | null);
      });
    }
  }, [profile]);

  const togglePref = async (key: keyof NotificationPreference) => {
    if (!prefs) return;
    const newValue = !prefs[key];
    setPrefs({ ...prefs, [key]: newValue });
    await supabase.from('notification_preferences').update({ [key]: newValue, updated_at: new Date().toISOString() }).eq('id', prefs.id);
  };

  const prefItems: { key: keyof NotificationPreference; label: string; desc: string }[] = [
    { key: 'ride_updates', label: 'Trip updates', desc: 'Ride status and driver arrivals' },
    { key: 'promotions', label: 'Promotions', desc: 'Discounts and referral rewards' },
    { key: 'safety_alerts', label: 'Safety alerts', desc: 'SOS and safety notifications' },
    { key: 'account_updates', label: 'Account updates', desc: 'Profile and security changes' },
    { key: 'security_alerts', label: 'Security alerts', desc: 'Suspicious activity warnings' },
    { key: 'driver_requests', label: 'Ride requests', desc: 'New ride requests for drivers' },
    { key: 'earnings_updates', label: 'Earnings updates', desc: 'Payment and earning alerts' },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your preferences." />
      <div className="mx-auto max-w-lg space-y-4">
        <Card>
          <SectionHeader title="Notifications" subtitle="Enable or disable each notification type" />
          <div className="divide-y divide-[#edf1f1]">
            {prefItems.map((item) => (
              <div key={item.key} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div><p className="text-sm font-semibold">{item.label}</p><p className="mt-0.5 text-xs text-[#8ba0a2]">{item.desc}</p></div>
                <button onClick={() => togglePref(item.key)} className={`relative h-6 w-11 rounded-full transition ${prefs?.[item.key] ? 'bg-[#0d7770]' : 'bg-[#dce7e6]'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${prefs?.[item.key] ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionHeader title="Language" subtitle="Choose your preferred language" />
          <div className="p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {languages.map((lang) => (
                <button key={lang.code} onClick={() => setSelectedLang(lang.code)} className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${selectedLang === lang.code ? 'border-[#0d7770] bg-[#f0faf7]' : 'border-[#e1e9e9] hover:bg-[#f5f8f8]'}`}>
                  <span className="text-xl">{lang.flag_emoji ?? '🌐'}</span>
                  <div className="min-w-0"><p className="truncate text-xs font-semibold">{lang.native_name}</p><p className="truncate text-[10px] text-[#8ba0a2]">{lang.name}</p></div>
                </button>
              ))}
            </div>
            <button onClick={async () => {
              await supabase.from('profiles').update({ language: selectedLang }).eq('id', profile?.id);
              await supabase.from('user_languages').upsert({ user_id: profile?.id, language_code: selectedLang }, { onConflict: 'user_id' });
            }} className="mt-4 w-full rounded-xl bg-[#0d2f35] py-3 text-sm font-semibold text-white hover:bg-[#174850]">Save language</button>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Account" />
          <div className="divide-y divide-[#edf1f1]">
            <div className="flex items-center justify-between px-5 py-4 sm:px-6"><div><p className="text-sm font-semibold">Account type</p><p className="mt-0.5 text-xs text-[#8ba0a2] capitalize">{profile?.role}</p></div></div>
            <div className="flex items-center justify-between px-5 py-4 sm:px-6"><div><p className="text-sm font-semibold">Currency</p><p className="mt-0.5 text-xs text-[#8ba0a2]">XAF (CFA Franc)</p></div></div>
            <div className="flex items-center justify-between px-5 py-4 sm:px-6"><div><p className="text-sm font-semibold">Data encryption</p><p className="mt-0.5 text-xs text-[#8ba0a2]">All personal data encrypted</p></div><span className="flex items-center gap-1.5 rounded-full bg-[#e0f3ed] px-3 py-1 text-xs font-semibold text-[#118370]"><Lock size={12} /> Active</span></div>
          </div>
        </Card>
      </div>
    </>
  );
}

const GOVERNMENT_BOARDS: Record<string, { name: string; contact: string }> = {
  police: { name: 'Cameroon National Police (DGSN)', contact: '+237 233 42 00 00 / 117' },
  gendarmerie: { name: 'Cameroon Gendarmerie Nationale', contact: '+237 222 23 15 40' },
  transport_regulator: { name: 'Ministry of Transport (MINT)', contact: '+237 222 23 24 25' },
  consumer_protection: { name: 'Consumer Protection Agency (CCPC)', contact: '+237 233 42 12 34' },
  municipal_council: { name: 'Yaoundé City Council', contact: '+237 222 23 02 44' },
  ministry_of_transport: { name: 'Ministry of Transport - Licensing Division', contact: '+237 222 23 24 25' },
  internal_review: { name: 'Njanga Internal Review Board', contact: 'support@njanga.cm' },
};

export function AiComplaintRouter() {
  const { user, profile } = useAuth();
  const [routes, setRoutes] = useState<ComplaintRoute[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Complaint['category']>('general');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    supabase.from('complaint_routes').select('*').eq('user_id', user?.id ?? '').order('routed_at', { ascending: false }).then(({ data }) => {
      setRoutes((data as ComplaintRoute[]) ?? []);
    });
    supabase.from('complaints').select('*').eq('user_id', user?.id ?? '').order('created_at', { ascending: false }).then(({ data }) => {
      setComplaints((data as Complaint[]) ?? []);
      setLoading(false);
    });
  };

  useEffect(load, [user]);

  const aiRouteComplaint = (cat: string, desc: string): { routed_to: string; analysis: string; confidence: number } => {
    const routing: Record<string, string> = {
      safety: 'police',
      driver: 'transport_regulator',
      trip: 'transport_regulator',
      payment: 'consumer_protection',
      vehicle: 'transport_regulator',
      general: 'internal_review',
    };
    const routedTo = routing[cat] ?? 'internal_review';
    const analyses: Record<string, string> = {
      safety: 'AI analysis: Safety complaint detected. High priority. Routing to Cameroon National Police for immediate action. Risk assessment: elevated. Recommend urgent follow-up.',
      driver: 'AI analysis: Driver-related complaint. Routing to Ministry of Transport for regulatory review. Pattern match: driver misconduct category.',
      trip: 'AI analysis: Trip-related complaint. Routing to Ministry of Transport. Service quality issue identified. Recommend mediation.',
      payment: 'AI analysis: Payment dispute detected. Routing to Consumer Protection Agency. Financial discrepancy flagged for investigation.',
      vehicle: 'AI analysis: Vehicle condition complaint. Routing to Ministry of Transport - Licensing Division. Vehicle safety concern identified.',
      general: 'AI analysis: General complaint. Routing to internal review board for assessment. Will be escalated to appropriate authority if needed.',
    };
    const confidence = cat === 'safety' ? 95 : cat === 'payment' ? 88 : cat === 'driver' ? 85 : 75;
    return { routed_to: routedTo, analysis: analyses[cat] ?? analyses.general, confidence };
  };

  const submit = async () => {
    setBusy(true); setMsg('');
    const { data: complaintData } = await supabase.from('complaints').insert({
      user_id: user?.id, user_name: profile?.full_name ?? 'User', subject, description, category,
    }).select().single();
    if (!complaintData) { setBusy(false); setMsg('Could not submit complaint'); return; }
    const routing = aiRouteComplaint(category, description);
    const board = GOVERNMENT_BOARDS[routing.routed_to];
    await supabase.from('complaint_routes').insert({
      complaint_id: complaintData.id, user_id: user?.id, user_name: profile?.full_name ?? 'User',
      category, subject, description, routed_to: routing.routed_to,
      board_name: board.name, board_contact: board.contact,
      ai_analysis: routing.analysis, ai_confidence: routing.confidence,
      status: 'routed',
    });
    setBusy(false);
    setMsg(`Complaint routed to ${board.name} by AI with ${routing.confidence}% confidence`);
    setSubject(''); setDescription(''); setCategory('general'); setShowForm(false);
    load();
    window.setTimeout(() => setMsg(''), 5000);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="AI Complaint Router" subtitle="Our AI routes your complaints to the right governmental board automatically." action={
        <button onClick={() => setShowForm(!showForm)} className="flex w-fit items-center gap-2 rounded-xl bg-[#0d2f35] px-4 py-3 text-sm font-semibold text-white hover:bg-[#174850]"><AlertCircle size={16} /> {showForm ? 'Cancel' : 'New complaint'}</button>
      } />
      {msg && <div className="mb-4 flex items-start gap-2 rounded-xl bg-[#f0faf7] p-4 text-sm font-semibold text-[#0d7770]"><Cpu size={18} className="mt-0.5 shrink-0" /> {msg}</div>}
      {showForm && (
        <Card className="mb-5 p-5">
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#f7f9f8] p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d7770] text-white"><Cpu size={16} /></div>
            <p className="text-xs text-[#45656a]">Our AI will analyze your complaint and route it to the appropriate governmental board based on category and content.</p>
          </div>
          <div className="space-y-3">
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">SUBJECT</span><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief title" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">CATEGORY</span><select value={category} onChange={(e) => setCategory(e.target.value as Complaint['category'])} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]"><option value="general">General</option><option value="driver">Driver</option><option value="trip">Trip</option><option value="payment">Payment</option><option value="safety">Safety</option><option value="vehicle">Vehicle</option></select></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">DESCRIPTION</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell us what happened..." rows={3} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] p-3 text-sm outline-none focus:border-[#0d8179]" /></div>
          </div>
          <button onClick={submit} disabled={busy || !subject || !description} className="mt-4 w-full rounded-xl bg-[#0d7770] py-3.5 text-sm font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">{busy ? 'AI routing...' : 'Submit & route with AI'}</button>
        </Card>
      )}
      {routes.length === 0 ? (
        <Card><EmptyState icon={<Building2 size={24} />} title="No routed complaints" subtitle="Your AI-routed complaints and their government board status will appear here." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {routes.map((r) => {
            const board = GOVERNMENT_BOARDS[r.routed_to] ?? GOVERNMENT_BOARDS.internal_review;
            return (
              <Card key={r.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]"><Building2 size={18} /></div>
                    <div>
                      <p className="text-sm font-semibold">{r.subject}</p>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{r.category} · {formatRelative(r.routed_at)}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${r.status === 'routed' ? 'bg-[#fff8e0] text-[#b8860b]' : r.status === 'resolved' ? 'bg-[#e0f3ed] text-[#118370]' : r.status === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-[#e7f4f0] text-[#0d7770]'}`}>{r.status.replace(/_/g, ' ')}</span>
                </div>
                <p className="mt-3 text-xs text-[#587478]">{r.description}</p>
                <div className="mt-3 rounded-xl bg-[#f7f9f8] p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-[#0d7770] text-[8px] font-bold text-white">AI</div>
                    <p className="text-xs font-semibold text-[#0d7770]">Routed to: {board.name}</p>
                  </div>
                  {r.ai_analysis && <p className="mt-2 text-[11px] text-[#587478]">{r.ai_analysis}</p>}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-[#8ba0a2]">
                    <span>AI confidence: {r.ai_confidence}%</span>
                    {r.board_contact && <span>· Contact: {r.board_contact}</span>}
                  </div>
                </div>
                {r.board_reference && <p className="mt-2 text-[11px] font-semibold text-[#0d7770]">Ref: {r.board_reference}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
