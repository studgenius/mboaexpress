import { useState, useEffect, useRef } from 'react';
import { Bike, CarFront, Navigation, TrendingUp, Wallet, Star, Power, Smartphone, ArrowDownRight, ArrowUpRight, Clock, Tag, CheckCircle2, AlertCircle, X, Send, MessageSquare, ShieldCheck, MapPin } from 'lucide-react';
import { buildJourneyInsights, estimateDistanceKm, type VehicleClass } from '@/lib/predictions';
import { JourneyInsightsPanel } from '@/components/JourneyInsights';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatXaf, formatRelative } from '@/lib/utils';
import { StatCard, PageHeader, Card, SectionHeader, EmptyState, Spinner } from '@/components/ui';
import type { RideRequest, DriverEarning, DriverHourlyRate } from '@/lib/types';

interface HourlyExtension {
  id: string;
  ride_id: string;
  customer_id: string;
  driver_id: string | null;
  requested_hours: number;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
}

interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'customer' | 'driver';
  body: string;
  read_at: string | null;
  created_at: string;
}

export function DriverHome({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { profile, refreshProfile } = useAuth();
  const [online, setOnline] = useState(profile?.is_online ?? false);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [tripsToday, setTripsToday] = useState(0);
  const [pending, setPending] = useState<RideRequest[]>([]);
  const [airportRegionMap, setAirportRegionMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setOnline(profile?.is_online ?? false);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    supabase.from('driver_earnings').select('amount').eq('driver_id', profile.id).gte('created_at', start.toISOString()).then(({ data }) => {
      setTodayEarnings((data ?? []).reduce((s, e) => s + e.amount, 0));
      setTripsToday(data?.length ?? 0);
    });
    supabase.from('ride_requests').select('*').eq('status', 'searching').order('created_at', { ascending: false }).limit(10).then(({ data }) => {
      const requests = (data as RideRequest[]) ?? [];
      // Fetch airport regions for airport transfer requests
      const airportIds = requests.filter((r) => r.service_type === 'airport' && r.airport_id).map((r) => r.airport_id!);
      if (airportIds.length > 0) {
        supabase.from('airports').select('id, region').in('id', airportIds).then(({ data: airports }) => {
          const regionMap: Record<string, string> = {};
          for (const a of airports ?? []) regionMap[a.id] = a.region;
          setAirportRegionMap(regionMap);
          // Filter airport requests: driver must be in same region as the airport
          const driverRegion = profile?.region;
          const filtered = driverRegion
            ? requests.filter((r) => r.service_type !== 'airport' || !r.airport_id || regionMap[r.airport_id] === driverRegion)
            : requests;
          setPending(filtered.slice(0, 5));
        });
      } else {
        setPending(requests.slice(0, 5));
      }
    });
  }, [profile]);

  const toggleOnline = async () => {
    const next = !online;
    setOnline(next);
    await supabase.from('profiles').update({ is_online: next }).eq('id', profile?.id);
    refreshProfile();
  };

  return (
    <>
      <PageHeader title={`Hello, ${profile?.full_name?.split(' ')[0] ?? 'Driver'}`} subtitle={profile?.vehicle_type ? `${profile.vehicle_type}${profile.vehicle_plate ? ` · ${profile.vehicle_plate}` : ''}` : 'Ready to drive?'} action={
        <button onClick={toggleOnline} className={`flex w-fit items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition ${online ? 'bg-[#ef754d] hover:bg-[#d9603a]' : 'bg-[#0d7770] hover:bg-[#0a6359]'}`}>
          <Power size={17} /> {online ? 'Go offline' : 'Go online'}
        </button>
      } />
      {profile?.provider_status && !['active', 'approved'].includes(profile.provider_status) && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#fff0e5] bg-[#fffaf6] p-4">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[#be653e]" />
          <div>
            <p className="text-sm font-semibold capitalize text-[#be653e]">Provider compliance: {profile.provider_status.replace(/_/g, ' ')}</p>
            <p className="mt-1 text-xs text-[#587478]">You must complete onboarding and receive admin approval before accepting rides. Visit Provider onboarding to continue.</p>
          </div>
        </div>
      )}
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Earnings today" value={formatXaf(todayEarnings).replace(' XAF', '')} suffix="XAF" change="12%" trend="up" icon={<TrendingUp size={18} />} tint="teal" />
        <StatCard label="Trips today" value={String(tripsToday)} change="8%" trend="up" icon={<Navigation size={18} />} tint="lime" />
        <StatCard label="Rating" value={profile?.rating?.toFixed(1) ?? '5.0'} change="0.1" trend="up" icon={<Star size={18} />} tint="orange" />
        <StatCard label="Status" value={online ? 'Online' : 'Offline'} change={online ? 'Active' : 'Idle'} trend={online ? 'up' : 'down'} icon={<Power size={18} />} tint="blue" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Incoming requests" subtitle={online ? 'Accept to start the ride' : 'Go online to receive requests'} action={pending.length > 0 ? <span className="rounded-full bg-[#fff0e5] px-2 py-1 text-[10px] font-bold text-[#be653e]">{pending.length}</span> : undefined} />
          {!online ? (
            <EmptyState icon={<Power size={24} />} title="You're offline" subtitle="Go online to start receiving ride requests." />
          ) : pending.length === 0 ? (
            <EmptyState icon={<Navigation size={24} />} title="No requests right now" subtitle="New requests will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {pending.map((req) => <RequestRow key={req.id} req={req} onAccept={() => onNavigate('requests')} />)}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="font-display text-base font-semibold">Today's earnings</h3>
          <p className="mt-0.5 text-xs text-[#8ba0a2]">Track your income in real time.</p>
          <div className="mt-5 flex h-36 items-end gap-2">
            {[32, 46, 38, 55, 68, 48, 76, 64, 89, 70, 82, 94].map((h, i) => <div key={i} className="flex-1 rounded-t-sm bg-[#c8e4dc] transition hover:bg-[#0d7770]" style={{ height: `${h}%` }} />)}
          </div>
          <div className="mt-3 flex justify-between text-[10px] text-[#9aabad]"><span>6AM</span><span>9AM</span><span>12PM</span><span>3PM</span><span>6PM</span></div>
          <button onClick={() => onNavigate('earnings')} className="mt-5 w-full rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">View full earnings →</button>
        </Card>
      </div>
    </>
  );
}

function RequestRow({ req, onAccept }: { req: RideRequest; onAccept: () => void }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  const checkEligibility = async (): Promise<string | null> => {
    if (!profile) return 'Profile not loaded';
    const status = profile.provider_status;
    if (status && !['active', 'approved'].includes(status)) {
      return `Provider compliance: ${status.replace(/_/g, ' ')}. Complete onboarding and admin approval before accepting rides.`;
    }
    const { data: app } = await supabase.from('provider_applications').select('compliance_status').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (app && !['active', 'approved'].includes(app.compliance_status)) {
      return `Application status: ${app.compliance_status.replace(/_/g, ' ')}. You must be approved before accepting rides.`;
    }
    const serviceType = req.service_type ?? 'standard';
    const { data: svc } = await supabase.from('provider_services').select('eligibility_status,is_active').eq('provider_id', profile.id).eq('service_type', serviceType).maybeSingle();
    if (svc && (!svc.is_active || svc.eligibility_status !== 'eligible')) {
      return `You are not eligible for ${serviceType.replace(/_/g, ' ')} rides. Check your provider onboarding.`;
    }
    return null;
  };

  const accept = async () => {
    setBusy(true); setBlockReason('');
    const blocked = await checkEligibility();
    if (blocked) { setBlockReason(blocked); setBusy(false); return; }
    await supabase.from('ride_requests').update({ status: 'accepted', driver_id: profile?.id, driver_name: profile?.full_name }).eq('id', req.id);
    await supabase.from('driver_earnings').insert({ driver_id: profile?.id, amount: req.fare, payment_method: req.payment_method, description: `${req.pickup} → ${req.destination}` });
    setBusy(false);
    onAccept();
  };
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f8f8] text-[#0d7770]">
            {req.vehicle_type === 'Moto' ? <Bike size={18} /> : <CarFront size={18} />}
          </div>
          <div>
            <p className="text-sm font-semibold">{req.pickup} → {req.destination}</p>
            <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{req.payment_method} · {formatRelative(req.created_at)}{req.service_type ? ` · ${req.service_type.replace(/_/g, ' ')}` : ''}</p>
            {(req.pickup_landmark || req.pickup_note) && <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-[#0d7770]"><MapPin size={12} className="mt-0.5 shrink-0" /><span>{[req.pickup_landmark, req.pickup_note].filter(Boolean).join(' · ')}</span></p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{formatXaf(req.fare)}</span>
          <button onClick={accept} disabled={busy} className="rounded-lg bg-[#0d7770] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">{busy ? '...' : 'Accept'}</button>
        </div>
      </div>
      {blockReason && <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff4ed] px-3 py-2 text-[11px] font-semibold text-[#be653e]"><ShieldCheck size={14} className="mt-0.5 shrink-0" />{blockReason}</div>}
    </div>
  );
}

export function DriverEarnings() {
  const { profile } = useAuth();
  const [earnings, setEarnings] = useState<DriverEarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!profile) return;
    supabase.from('driver_earnings').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      const list = (data as DriverEarning[]) ?? [];
      setEarnings(list);
      setTotal(list.reduce((s, e) => s + e.amount, 0));
      setLoading(false);
    });
  }, [profile]);

  return (
    <>
      <PageHeader title="Earnings" subtitle="Your trip income and payment breakdown." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total earnings" value={formatXaf(total).replace(' XAF', '')} suffix="XAF" change="14%" trend="up" icon={<TrendingUp size={18} />} tint="teal" />
        <StatCard label="Total trips" value={String(earnings.length)} change="8%" trend="up" icon={<Navigation size={18} />} tint="lime" />
        <StatCard label="Avg. per trip" value={earnings.length ? formatXaf(Math.round(total / earnings.length)).replace(' XAF', '') : '0'} suffix="XAF" change="3%" trend="up" icon={<Star size={18} />} tint="orange" />
      </div>
      <Card>
        <SectionHeader title="Transaction history" subtitle="Every earning entry." />
        {loading ? <Spinner /> : earnings.length === 0 ? (
          <EmptyState icon={<TrendingUp size={24} />} title="No earnings yet" subtitle="Accepted rides will show income here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {earnings.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e0f3ed] text-[#118370]"><ArrowUpRight size={16} /></div>
                  <div>
                    <p className="text-sm font-semibold">{e.description}</p>
                    <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatRelative(e.created_at)} · {e.payment_method}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-[#118370]">+{formatXaf(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function DriverWallet() {
  const { profile } = useAuth();
  const [earnings, setEarnings] = useState<DriverEarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('driver_earnings').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      setEarnings((data as DriverEarning[]) ?? []);
      setLoading(false);
    });
  }, [profile]);

  const total = earnings.reduce((s, e) => s + e.amount, 0);
  const momo = earnings.filter((e) => e.payment_method === 'MTN MoMo').reduce((s, e) => s + e.amount, 0);
  const orange = earnings.filter((e) => e.payment_method === 'Orange Money').reduce((s, e) => s + e.amount, 0);
  const cash = earnings.filter((e) => e.payment_method === 'Cash').reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <PageHeader title="Wallet" subtitle="Track your balance across payment methods." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-[#0d2f35] to-[#174850] p-6 text-white">
            <p className="text-xs text-[#a8c5c6]">Available balance</p>
            <p className="mt-2 font-display text-4xl font-semibold">{formatXaf(total)}</p>
            <div className="mt-6 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-[#a8c5c6]"><Wallet size={14} /> Driver wallet</span>
              <span className="text-xs text-[#a8c5c6]">{profile?.full_name}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[#edf1f1]">
            <WalletBreakdown label="MTN MoMo" amount={momo} color="bg-[#ffcc00]" textColor="text-[#1a1a1a]" />
            <WalletBreakdown label="Orange Money" amount={orange} color="bg-[#ff7900]" textColor="text-white" />
            <WalletBreakdown label="Cash" amount={cash} color="bg-[#e0f3ed]" textColor="text-[#118370]" />
          </div>
        </Card>
        <Card>
          <SectionHeader title="Recent activity" subtitle="Latest wallet movements." />
          {loading ? <Spinner /> : earnings.length === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="No activity" subtitle="Your wallet movements will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {earnings.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center justify-between px-5 py-3.5 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e0f3ed] text-[#118370]"><ArrowDownRight size={15} /></div>
                    <div>
                      <p className="text-xs font-semibold">{e.description}</p>
                      <p className="text-[10px] text-[#9aabad]">{formatRelative(e.created_at)} · {e.payment_method}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#118370]">+{formatXaf(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function WalletBreakdown({ label, amount, color, textColor }: { label: string; amount: number; color: string; textColor: string }) {
  return (
    <div className="p-4 text-center">
      <div className={`mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full ${color} ${textColor}`}><Smartphone size={15} /></div>
      <p className="text-[10px] text-[#8ba0a2]">{label}</p>
      <p className="mt-1 text-xs font-semibold">{formatXaf(amount)}</p>
    </div>
  );
}

export function DriverHourlyRates() {
  const { profile } = useAuth();
  const [rate, setRate] = useState<DriverHourlyRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseRate, setBaseRate] = useState(3000);
  const [disc2, setDisc2] = useState(5);
  const [disc4, setDisc4] = useState(10);
  const [disc8, setDisc8] = useState(15);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    supabase.from('driver_hourly_rates').select('*').eq('driver_id', profile.id).maybeSingle().then(({ data }) => {
      if (data) {
        const r = data as DriverHourlyRate;
        setRate(r);
        setBaseRate(r.base_hourly_rate);
        setDisc2(r.discount_2h);
        setDisc4(r.discount_4h);
        setDisc8(r.discount_8h);
      }
      setLoading(false);
    });
  }, [profile]);

  const save = async () => {
    setBusy(true); setMsg('');
    const payload = {
      driver_id: profile?.id, vehicle_type: profile?.vehicle_type ?? 'Moto',
      base_hourly_rate: baseRate, discount_2h: disc2, discount_4h: disc4, discount_8h: disc8,
    };
    let error;
    if (rate) {
      ({ error } = await supabase.from('driver_hourly_rates').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', rate.id));
    } else {
      ({ error } = await supabase.from('driver_hourly_rates').insert(payload));
    }
    setBusy(false);
    setMsg(error ? 'Could not save rates' : 'Rates saved! Customers will see your discounts.');
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Hourly rates & discounts" subtitle="Set your base rate and discounts for longer bookings." />
      <div className="mx-auto max-w-lg">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3 rounded-xl bg-[#f0faf7] p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d7770] text-white"><Clock size={16} /></div>
            <p className="text-xs text-[#45656a]">Customers can book you for 1-12 hours. Longer bookings get bigger discounts.</p>
          </div>
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">BASE HOURLY RATE (XAF)</span>
              <input type="number" min={500} step={100} value={baseRate} onChange={(e) => setBaseRate(Number(e.target.value))} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <DiscountField label="2h discount" value={disc2} onChange={setDisc2} />
              <DiscountField label="4h discount" value={disc4} onChange={setDisc4} />
              <DiscountField label="8h (½ day)" value={disc8} onChange={setDisc8} />
            </div>
          </div>
          <div className="mt-5 rounded-xl bg-[#f7f9f8] p-4">
            <p className="mb-2 text-[11px] font-semibold text-[#708b8e]">PREVIEW</p>
            {[1, 2, 4, 8].map((h) => {
              const disc = h >= 8 ? disc8 : h >= 4 ? disc4 : h >= 2 ? disc2 : 0;
              const total = Math.round(baseRate * h * (1 - disc / 100));
              return (
                <div key={h} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="text-[#759092]">{h}h booking{h >= 8 ? ' (½ day)' : ''}</span>
                  <span className="font-semibold">{formatXaf(total)}{disc > 0 && <span className="ml-1.5 rounded bg-[#e9f55b]/30 px-1.5 py-0.5 text-[10px] text-[#526213]">-{disc}%</span>}</span>
                </div>
              );
            })}
          </div>
          <button onClick={save} disabled={busy} className="mt-5 w-full rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white hover:bg-[#174850] disabled:opacity-60">{busy ? 'Saving...' : 'Save rates'}</button>
          {msg && <p className={`mt-3 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could') ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
        </Card>
      </div>
    </>
  );
}

function DiscountField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">{label.toUpperCase()} (%)</span>
      <input type="number" min={0} max={50} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" />
    </div>
  );
}

export function DriverExtensions() {
  const { profile } = useAuth();
  const [extensions, setExtensions] = useState<HourlyExtension[]>([]);
  const [rides, setRides] = useState<Record<string, RideRequest>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    if (!profile) return;
    supabase.from('hourly_booking_extensions').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      const list = (data as HourlyExtension[]) ?? [];
      setExtensions(list);
      if (list.length > 0) {
        supabase.from('ride_requests').select('*').in('id', list.map((item) => item.ride_id)).then(({ data: rideData }) => {
          const map: Record<string, RideRequest> = {};
          for (const ride of (rideData as RideRequest[]) ?? []) map[ride.id] = ride;
          setRides(map);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });
  };

  useEffect(load, [profile]);

  const respond = async (extension: HourlyExtension, accept: boolean) => {
    setBusyId(extension.id);
    const newStatus = accept ? 'accepted' : 'declined';
    await supabase.from('hourly_booking_extensions').update({ status: newStatus, responded_at: new Date().toISOString() }).eq('id', extension.id);
    const ride = rides[extension.ride_id];
    if (ride) {
      const newApproved = accept ? Math.min(12, (ride.approved_hours ?? 1) + extension.requested_hours) : (ride.approved_hours ?? 1);
      await supabase.from('ride_requests').update({ extension_status: newStatus, approved_hours: newApproved }).eq('id', extension.ride_id);
    }
    setBusyId(null);
    load();
  };

  return (
    <>
      <PageHeader title="Hourly extension requests" subtitle="Accept or decline customer requests to extend a booking." />
      <Card>
        {loading ? <Spinner /> : extensions.length === 0 ? (
          <EmptyState icon={<Clock size={24} />} title="No extension requests" subtitle="Customers can request extra hours from the active ride screen." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {extensions.map((ext) => {
              const ride = rides[ext.ride_id];
              return (
                <div key={ext.id} className="px-5 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff8e0] text-[#b8860b]"><Clock size={18} /></div>
                      <div>
                        <p className="text-sm font-semibold">+{ext.requested_hours}h extension</p>
                        <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{ride ? `${ride.pickup} · ${ride.payment_method}` : 'Hourly booking'} · {formatRelative(ext.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ext.status === 'pending' ? (
                        <>
                          <button onClick={() => respond(ext, true)} disabled={busyId === ext.id} className="rounded-lg bg-[#0d7770] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60"><CheckCircle2 size={14} className="mr-1 inline" /> Accept</button>
                          <button onClick={() => respond(ext, false)} disabled={busyId === ext.id} className="rounded-lg border border-[#e1e9e9] px-3 py-2 text-xs font-semibold text-[#be653e] hover:bg-[#fff0e5] disabled:opacity-60"><X size={14} className="mr-1 inline" /> Decline</button>
                        </>
                      ) : (
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${ext.status === 'accepted' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#fff0e5] text-[#be653e]'}`}>{ext.status}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

export function DriverMessages() {
  const { profile } = useAuth();
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [selectedRide, setSelectedRide] = useState<RideRequest | null>(null);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!profile) return;
    supabase.from('ride_requests').select('*').eq('driver_id', profile.id).in('status', ['accepted', 'in_progress', 'completed']).order('created_at', { ascending: false }).then(({ data }) => {
      setRides((data as RideRequest[]) ?? []);
      setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (!selectedRide) return;
    const load = () => supabase.from('ride_messages').select('*').eq('ride_id', selectedRide.id).order('created_at', { ascending: true }).then(({ data }) => {
      setMessages((data as RideMessage[]) ?? []);
    });
    load();
    const channel = supabase.channel(`driver-messages-${selectedRide.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${selectedRide.id}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedRide]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!body.trim() || !profile || !selectedRide) return;
    setBusy(true);
    const { error } = await supabase.from('ride_messages').insert({ ride_id: selectedRide.id, sender_id: profile.id, sender_role: 'driver', body: body.trim() });
    if (!error) setBody('');
    setBusy(false);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Messages" subtitle="Chat with customers on your accepted rides." />
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto">
          <SectionHeader title="Active rides" subtitle="Tap to open chat" />
          {rides.length === 0 ? (
            <EmptyState icon={<MessageSquare size={24} />} title="No active chats" subtitle="Accepted rides will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {rides.map((ride) => (
                <button key={ride.id} onClick={() => setSelectedRide(ride)} className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-[#f5f8f8] ${selectedRide?.id === ride.id ? 'bg-[#f0faf7]' : ''}`}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9f55b] text-sm font-bold text-[#0d2f35]">{ride.pickup.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{ride.pickup}</p>
                    <p className="truncate text-[11px] text-[#8ba0a2]">{formatRelative(ride.created_at)} · {ride.payment_method}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ride.status === 'completed' ? 'bg-[#f0eeee] text-[#8a7272]' : 'bg-[#e0f3ed] text-[#118370]'}`}>{ride.status}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card className="flex h-[70vh] flex-col">
          {!selectedRide ? (
            <EmptyState icon={<MessageSquare size={24} />} title="Select a ride" subtitle="Choose a ride to start messaging the customer." />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-[#edf1f1] p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9f55b] text-sm font-bold text-[#0d2f35]">{selectedRide.pickup.charAt(0)}</div>
                <div>
                  <p className="text-sm font-semibold">{selectedRide.pickup} → {selectedRide.destination}</p>
                  <p className="text-[11px] text-[#8ba0a2]">{formatXaf(selectedRide.fare)} · {selectedRide.payment_method}</p>
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f8f8] text-[#9aabad]"><MessageSquare size={22} /></div>
                    <p className="text-sm font-semibold text-[#45656a]">No messages yet</p>
                    <p className="mt-1 text-xs text-[#9aabad]">Start the conversation with your customer.</p>
                  </div>
                ) : messages.map((msg) => {
                  const mine = msg.sender_role === 'driver';
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? 'bg-[#0d7770] text-white' : 'bg-[#f0f4f4] text-[#102b32]'}`}>
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className={`mt-1 text-[10px] ${mine ? 'text-[#a8c5c6]' : 'text-[#9aabad]'}`}>{new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 border-t border-[#edf1f1] p-3">
                <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Type a message..." className="flex-1 rounded-full border border-[#dce7e6] bg-[#fbfcfc] px-4 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
                <button onClick={send} disabled={busy || !body.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0d7770] text-white transition hover:bg-[#0a6359] disabled:opacity-50"><Send size={17} /></button>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export function DriverTripHistory() {
  const { profile } = useAuth();
  const [trips, setTrips] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('ride_requests').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      setTrips((data as RideRequest[]) ?? []);
      setLoading(false);
    });
  }, [profile]);

  return (
    <>
      <PageHeader title="Trip history" subtitle="All rides you have completed." />
      <Card>
        {loading ? <Spinner /> : trips.length === 0 ? (
          <EmptyState icon={<Navigation size={24} />} title="No trips yet" subtitle="Your completed rides will appear here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {trips.map((trip) => (
              <div key={trip.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f8f8] text-[#0d7770]">
                    {trip.vehicle_type === 'Moto' ? <Bike size={18} /> : <CarFront size={18} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{trip.pickup} → {trip.destination}</p>
                    <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatRelative(trip.created_at)} · {trip.service_type ?? 'standard'} · {trip.payment_method}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatXaf(trip.fare)}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${trip.status === 'completed' ? 'bg-[#e0f3ed] text-[#118370]' : trip.status === 'searching' ? 'bg-[#fff0e5] text-[#be653e]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{trip.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function DriverRatings() {
  const { profile } = useAuth();
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('ride_reviews').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      setReviews(data ?? []);
      setLoading(false);
    });
  }, [profile]);

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : (profile?.rating?.toFixed(1) ?? '5.0');

  return (
    <>
      <PageHeader title="Ratings & reviews" subtitle="What passengers say about your service." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Average rating" value={avgRating} change="0.1" trend="up" icon={<Star size={18} />} tint="orange" />
        <StatCard label="Total reviews" value={String(reviews.length)} change="5" trend="up" icon={<MessageSquare size={18} />} tint="teal" />
        <StatCard label="Total trips" value={String(profile?.total_trips ?? 0)} change="8" trend="up" icon={<Navigation size={18} />} tint="blue" />
      </div>
      <Card>
        <SectionHeader title="Passenger reviews" subtitle="Recent feedback from your riders" />
        {loading ? <Spinner /> : reviews.length === 0 ? (
          <EmptyState icon={<Star size={24} />} title="No reviews yet" subtitle="Passenger reviews will appear here after completed trips." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {reviews.map((r) => (
              <div key={r.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold">{r.reviewer_name}</p>
                    <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatRelative(r.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} size={14} className={i < r.rating ? 'text-[#edb938]' : 'text-[#dce7e6]'} fill="currentColor" />
                    ))}
                  </div>
                </div>
                {r.comment && <p className="mt-2 text-xs text-[#587478]">{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function DriverNavigation() {
  const { profile } = useAuth();
  const [activeRide, setActiveRide] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('ride_requests').select('*').eq('driver_id', profile.id).in('status', ['accepted', 'in_progress']).order('created_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      setActiveRide((data as RideRequest) ?? null);
      setLoading(false);
    });
  }, [profile]);

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Navigation" subtitle="Turn-by-turn directions to your passenger." />
      {!activeRide ? (
        <Card><EmptyState icon={<Navigation size={24} />} title="No active ride" subtitle="Accept a ride request to start navigation." /></Card>
      ) : (
        <div className="mx-auto max-w-lg">
          <Card className="overflow-hidden">
            <div className="relative h-[280px] bg-[#e6efeb]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(125,175,150,.28),transparent_21%),radial-gradient(circle_at_75%_65%,rgba(125,175,150,.24),transparent_20%)]" />
              <div className="absolute left-[5%] top-[48%] h-[3px] w-[90%] rotate-[17deg] bg-white/70" />
              <div className="absolute left-[40%] top-[-10%] h-[120%] w-[4px] rotate-[31deg] bg-white/70" />
              <div className="absolute left-[20%] top-[30%] flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#0c8179] text-white shadow-lg">
                <div className="h-2 w-2 animate-ping rounded-full bg-white" />
              </div>
              <div className="absolute right-[15%] bottom-[25%] flex h-7 w-7 items-center justify-center rounded-full bg-[#ef754d] text-white shadow-lg">
                <Navigation size={14} />
              </div>
              <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-[10px] font-medium text-[#486568] shadow-sm">
                <p className="font-semibold">Estimated arrival</p>
                <p className="text-[#0d7770]">12 min · 3.4 km</p>
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{activeRide.pickup} → {activeRide.destination}</p>
                  <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{activeRide.service_type ?? 'standard'} · {activeRide.payment_method} · {formatXaf(activeRide.fare)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${activeRide.status === 'in_progress' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#fff8e0] text-[#b8860b]'}`}>{activeRide.status.replace('_', ' ')}</span>
              </div>
              <div className="mt-4">
                {(() => {
                  const st = activeRide.service_type ?? 'standard';
                  const isIntercity = st.includes('intercity') || st === 'airport';
                  const vehicle: VehicleClass = st.startsWith('moto') || activeRide.vehicle_type === 'Moto' ? 'moto' : st.includes('shared') || st === 'coride' ? 'shared' : 'car';
                  const distanceKm = estimateDistanceKm(activeRide.pickup, activeRide.destination, isIntercity);
                  const durationMin = Math.round((distanceKm / (isIntercity ? 60 : 25)) * 60);
                  const insights = buildJourneyInsights({ pickup: activeRide.pickup, destination: activeRide.destination, distanceKm, durationMin, isIntercity, vehicle, seed: activeRide.destination });
                  return <JourneyInsightsPanel insights={insights} audience="driver" />;
                })()}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button className="flex items-center justify-center gap-2 rounded-xl bg-[#0d7770] py-3 text-sm font-semibold text-white hover:bg-[#0a6359]">
                  <Navigation size={16} /> Open in maps
                </button>
                <button onClick={async () => {
                  await supabase.from('ride_requests').update({ status: 'completed' }).eq('id', activeRide.id);
                  setActiveRide(null);
                }} className="flex items-center justify-center gap-2 rounded-xl border border-[#e1e9e9] py-3 text-sm font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">
                  <CheckCircle2 size={16} /> Complete trip
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}