import { useState, useEffect } from 'react';
import { Map, Users, CarFront, TrendingUp, DollarSign, Star, ShieldCheck, AlertTriangle, CheckCircle2, X, BarChart3, Tag, Navigation, Bike, Plane, Route, Package, Briefcase, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatXaf, formatRelative } from '@/lib/utils';
import { StatCard, PageHeader, Card, SectionHeader, EmptyState, Spinner } from '@/components/ui';
import { SERVICES, getService, calculateCommission } from '@/lib/services';
import type { RideRequest, Profile, Complaint, Promotion, ServiceConfig, ServiceType } from '@/lib/types';

export function AdminHome() {
  const [stats, setStats] = useState({ trips: 0, drivers: 0, passengers: 0, revenue: 0, activeRides: 0, complaints: 0 });
  const [recentTrips, setRecentTrips] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('ride_requests').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('profiles').select('*'),
      supabase.from('complaints').select('*').eq('status', 'open'),
    ]).then(([tripsRes, profilesRes, complaintsRes]) => {
      const trips = (tripsRes.data as RideRequest[]) ?? [];
      const profiles = (profilesRes.data as Profile[]) ?? [];
      const drivers = profiles.filter((p) => p.role === 'driver');
      const passengers = profiles.filter((p) => p.role === 'customer');
      const activeRides = trips.filter((t) => t.status === 'searching' || t.status === 'accepted' || t.status === 'in_progress');
      const revenue = trips.filter((t) => t.status === 'completed').reduce((s, t) => s + t.fare, 0);
      setRecentTrips(trips);
      setStats({ trips: trips.length, drivers: drivers.length, passengers: passengers.length, revenue, activeRides: activeRides.length, complaints: (complaintsRes.data ?? []).length });
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Admin Dashboard" subtitle="Platform overview and live operations." />
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total trips" value={String(stats.trips)} change="12%" trend="up" icon={<Navigation size={18} />} tint="teal" />
        <StatCard label="Active drivers" value={String(stats.drivers)} change="8%" trend="up" icon={<CarFront size={18} />} tint="lime" />
        <StatCard label="Passengers" value={String(stats.passengers)} change="15%" trend="up" icon={<Users size={18} />} tint="blue" />
        <StatCard label="Revenue" value={formatXaf(stats.revenue).replace(' XAF', '')} suffix="XAF" change="20%" trend="up" icon={<TrendingUp size={18} />} tint="orange" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Live operations map" subtitle="Active rides across Cameroon" />
          <div className="relative h-[300px] overflow-hidden rounded-xl bg-[#e6efeb]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(125,175,150,.28),transparent_21%),radial-gradient(circle_at_75%_65%,rgba(125,175,150,.24),transparent_20%)]" />
            <div className="absolute left-[5%] top-[48%] h-[3px] w-[90%] rotate-[17deg] bg-white/70" />
            <div className="absolute left-[40%] top-[-10%] h-[120%] w-[4px] rotate-[31deg] bg-white/70" />
            {recentTrips.filter((t) => t.status === 'accepted' || t.status === 'in_progress').slice(0, 5).map((trip, i) => (
              <div key={trip.id} className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-white bg-[#0c8179] text-[9px] font-bold text-white shadow-md" style={{ left: `${20 + i * 15}%`, top: `${25 + i * 12}%` }}>
                {trip.vehicle_type === 'Moto' ? <Bike size={11} /> : <CarFront size={11} />}
              </div>
            ))}
            <div className="absolute bottom-3 left-3 flex gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-[#486568] shadow-sm">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#0c8179]" /> {stats.activeRides} active</span>
            </div>
          </div>
        </Card>
        <Card>
          <SectionHeader title="Recent trips" subtitle="Latest bookings across all services" />
          {recentTrips.length === 0 ? (
            <EmptyState icon={<Navigation size={24} />} title="No trips yet" subtitle="Trips will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {recentTrips.slice(0, 6).map((trip) => (
                <div key={trip.id} className="flex items-center justify-between px-5 py-3 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f8f8] text-[#0d7770]">
                      {trip.vehicle_type === 'Moto' ? <Bike size={16} /> : <CarFront size={16} />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold">{trip.pickup} → {trip.destination}</p>
                      <p className="text-[10px] text-[#9aabad]">{formatRelative(trip.created_at)} · {trip.service_type ?? 'standard'} · {trip.payment_method}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold">{formatXaf(trip.fare)}</p>
                    <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${trip.status === 'completed' ? 'bg-[#e0f3ed] text-[#118370]' : trip.status === 'searching' ? 'bg-[#fff0e5] text-[#be653e]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{trip.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export function AdminDrivers() {
  const [drivers, setDrivers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'driver').order('created_at', { ascending: false }).then(({ data }) => {
      setDrivers((data as Profile[]) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;
  const filtered = filter === 'all' ? drivers : filter === 'online' ? drivers.filter((d) => d.is_online) : drivers.filter((d) => !d.is_online);

  return (
    <>
      <PageHeader title="Drivers" subtitle="Manage all registered drivers on the platform." />
      <div className="mb-5 flex gap-2">
        {(['all', 'online', 'offline'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${filter === f ? 'border-[#0d7770] bg-[#0d7770] text-white' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}>{f}</button>
        ))}
      </div>
      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={<CarFront size={24} />} title="No drivers found" subtitle="Registered drivers will appear here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {filtered.map((driver) => (
              <div key={driver.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9f55b] text-sm font-bold text-[#0d2f35]">{driver.full_name?.charAt(0).toUpperCase() ?? '?'}</div>
                  <div>
                    <p className="text-sm font-semibold">{driver.full_name}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{driver.vehicle_type ?? 'No vehicle'} · {driver.vehicle_plate ?? 'No plate'} · {driver.total_trips ?? 0} trips</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs text-[#759092]"><Star size={12} className="text-[#edb938]" fill="currentColor" /> {driver.rating?.toFixed(1) ?? '5.0'}</div>
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${driver.is_online ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${driver.is_online ? 'bg-[#118370]' : 'bg-[#8a7272]'}`} /> {driver.is_online ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function AdminPassengers() {
  const [passengers, setPassengers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'customer').order('created_at', { ascending: false }).then(({ data }) => {
      setPassengers((data as Profile[]) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Passengers" subtitle="All registered passengers on the platform." />
      <Card>
        {passengers.length === 0 ? (
          <EmptyState icon={<Users size={24} />} title="No passengers yet" subtitle="Registered passengers will appear here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {passengers.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9f55b] text-sm font-bold text-[#0d2f35]">{p.full_name?.charAt(0).toUpperCase() ?? '?'}</div>
                  <div>
                    <p className="text-sm font-semibold">{p.full_name}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{p.phone ?? 'No phone'} · {p.total_trips ?? 0} trips</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-[#759092]"><Star size={12} className="text-[#edb938]" fill="currentColor" /> {p.rating?.toFixed(1) ?? '5.0'}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function AdminTrips() {
  const [trips, setTrips] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ServiceType>('all');

  useEffect(() => {
    supabase.from('ride_requests').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
      setTrips((data as RideRequest[]) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;
  const filtered = filter === 'all' ? trips : trips.filter((t) => (t.service_type ?? 'standard') === filter);

  return (
    <>
      <PageHeader title="All trips" subtitle="Every booking across all service types." />
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setFilter('all')} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${filter === 'all' ? 'border-[#0d7770] bg-[#0d7770] text-white' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}>All</button>
        {SERVICES.map((svc) => (
          <button key={svc.id} onClick={() => setFilter(svc.id)} className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${filter === svc.id ? 'border-[#0d7770] bg-[#0d7770] text-white' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}>{svc.label}</button>
        ))}
      </div>
      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={<Navigation size={24} />} title="No trips found" subtitle="Bookings will appear here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {filtered.map((trip) => (
              <div key={trip.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f8f8] text-[#0d7770]">{trip.vehicle_type === 'Moto' ? <Bike size={16} /> : <CarFront size={16} />}</div>
                  <div>
                    <p className="text-sm font-semibold">{trip.pickup} → {trip.destination}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{formatRelative(trip.created_at)} · {trip.service_type ?? 'standard'} · {trip.payment_method}{trip.driver_name ? ` · ${trip.driver_name}` : ''}</p>
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

export function AdminPricing() {
  const [configs, setConfigs] = useState<ServiceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, { baseFare: number; commissionRate: number; isActive: boolean }>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.from('service_config').select('*').order('base_fare').then(({ data }) => {
      setConfigs((data as ServiceConfig[]) ?? []);
      setLoading(false);
    });
  }, []);

  const save = async (config: ServiceConfig) => {
    const val = values[config.service_type];
    if (!val) return;
    const { error } = await supabase.from('service_config').update({ base_fare: val.baseFare, commission_rate: val.commissionRate, is_active: val.isActive, updated_at: new Date().toISOString() }).eq('id', config.id);
    setMsg(error ? 'Could not update pricing' : `${config.label} pricing updated!`);
    if (!error) {
      setConfigs((prev) => prev.map((c) => c.id === config.id ? { ...c, base_fare: val.baseFare, commission_rate: val.commissionRate, is_active: val.isActive } : c));
      setEditing(null);
    }
    window.setTimeout(() => setMsg(''), 2500);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Pricing & commissions" subtitle="Configure base fares and commission rates per service." />
      {msg && <p className={`mb-4 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could') ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {configs.map((config) => {
          const svc = getService(config.service_type);
          const isEditing = editing === config.id;
          const val = values[config.service_type] ?? { baseFare: config.base_fare, commissionRate: config.commission_rate, isActive: config.is_active };
          return (
            <Card key={config.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${svc.tint}`}>{getService(config.service_type).label.charAt(0)}</div>
                  <div>
                    <p className="text-sm font-semibold">{config.label}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{config.service_type}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.is_active ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{config.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#8ba0a2]">Base fare</span>
                  {isEditing ? (
                    <input type="number" value={val.baseFare} onChange={(e) => setValues((prev) => ({ ...prev, [config.service_type]: { ...val, baseFare: Number(e.target.value) } }))} className="w-24 rounded-lg border border-[#dce7e6] px-2 py-1 text-sm outline-none focus:border-[#0d8179]" />
                  ) : (
                    <span className="font-semibold">{formatXaf(config.base_fare)}</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#8ba0a2]">Commission rate</span>
                  {isEditing ? (
                    <input type="number" value={val.commissionRate} onChange={(e) => setValues((prev) => ({ ...prev, [config.service_type]: { ...val, commissionRate: Number(e.target.value) } }))} className="w-24 rounded-lg border border-[#dce7e6] px-2 py-1 text-sm outline-none focus:border-[#0d8179]" />
                  ) : (
                    <span className="font-semibold">{config.commission_rate}%</span>
                  )}
                </div>
                {isEditing && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={val.isActive} onChange={(e) => setValues((prev) => ({ ...prev, [config.service_type]: { ...val, isActive: e.target.checked } }))} className="h-4 w-4 accent-[#08ae7a]" />
                    <span className="text-[#45656a]">Service active</span>
                  </label>
                )}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                {isEditing ? (
                  <>
                    <button onClick={() => setEditing(null)} className="rounded-lg border border-[#e1e9e9] px-3 py-1.5 text-xs font-semibold text-[#759092] hover:bg-[#f5f8f8]">Cancel</button>
                    <button onClick={() => save(config)} className="rounded-lg bg-[#0d7770] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a6359]">Save</button>
                  </>
                ) : (
                  <button onClick={() => { setEditing(config.id); setValues((prev) => ({ ...prev, [config.service_type]: { baseFare: config.base_fare, commissionRate: config.commission_rate, isActive: config.is_active } })); }} className="rounded-lg border border-[#e1e9e9] px-3 py-1.5 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">Edit pricing</button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

export function AdminComplaints() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('complaints').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setComplaints((data as Complaint[]) ?? []);
      setLoading(false);
    });
  }, []);

  const resolve = async (complaint: Complaint, status: 'resolved' | 'closed') => {
    setBusy(complaint.id);
    const adminResponse = response[complaint.id] ?? '';
    await supabase.from('complaints').update({ status, admin_response: adminResponse || null, resolved_at: new Date().toISOString() }).eq('id', complaint.id);
    setBusy(null);
    setComplaints((prev) => prev.map((c) => c.id === complaint.id ? { ...c, status, admin_response: adminResponse || null, resolved_at: new Date().toISOString() } : c));
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Complaints" subtitle="Review and resolve user complaints." />
      {complaints.length === 0 ? (
        <Card><EmptyState icon={<AlertTriangle size={24} />} title="No complaints" subtitle="User complaints will appear here." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {complaints.map((c) => (
            <Card key={c.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{c.subject}</p>
                  <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{c.user_name} · {c.category} · {formatRelative(c.created_at)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.status === 'open' ? 'bg-[#fff0e5] text-[#be653e]' : c.status === 'investigating' ? 'bg-[#fff8e0] text-[#b8860b]' : c.status === 'resolved' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{c.status}</span>
              </div>
              <p className="mt-3 text-xs text-[#587478]">{c.description}</p>
              {c.admin_response && <div className="mt-3 rounded-lg bg-[#f5f8f8] p-2.5 text-[11px] text-[#45656a]"><strong>Admin response:</strong> {c.admin_response}</div>}
              {c.status === 'open' && (
                <>
                  <textarea value={response[c.id] ?? ''} onChange={(e) => setResponse((prev) => ({ ...prev, [c.id]: e.target.value }))} placeholder="Add a response..." rows={2} className="mt-3 w-full rounded-lg border border-[#dce7e6] bg-[#fbfcfc] p-2.5 text-sm outline-none focus:border-[#0d8179]" />
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => resolve(c, 'closed')} disabled={busy === c.id} className="rounded-lg border border-[#e1e9e9] px-3 py-1.5 text-xs font-semibold text-[#759092] hover:bg-[#f5f8f8]">Close</button>
                    <button onClick={() => resolve(c, 'resolved')} disabled={busy === c.id} className="rounded-lg bg-[#0d7770] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">Resolve</button>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function AdminVerification() {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('driver_applications').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setApplications(data ?? []);
      setLoading(false);
    });
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setBusy(id);
    await supabase.from('driver_applications').update({ status }).eq('id', id);
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
    setBusy(null);
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Driver verification" subtitle="Review and approve driver applications." />
      {applications.length === 0 ? (
        <Card><EmptyState icon={<ShieldCheck size={24} />} title="No applications" subtitle="Driver applications will appear here." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {applications.map((app) => (
            <Card key={app.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{app.full_name}</p>
                  <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{app.vehicle_type} · {app.vehicle_model} · {app.license_plate}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${app.status === 'approved' ? 'bg-[#e0f3ed] text-[#118370]' : app.status === 'rejected' ? 'bg-[#fff0e5] text-[#be653e]' : 'bg-[#fff8e0] text-[#b8860b]'}`}>{app.status.replace('_', ' ')}</span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-[#8ba0a2]">License</span><span className="font-medium">{app.license_number}</span></div>
                <div className="flex justify-between"><span className="text-[#8ba0a2]">Insurance</span><span className="font-medium">{app.insurance_provider}</span></div>
                <div className="flex justify-between"><span className="text-[#8ba0a2]">AI photos</span><span className="font-medium capitalize">{app.ai_photo_status?.replace('_', ' ') ?? 'not started'}</span></div>
                <div className="flex justify-between"><span className="text-[#8ba0a2]">Gov. verification</span><span className="font-medium capitalize">{app.government_verification_status?.replace('_', ' ') ?? 'not started'}</span></div>
                <div className="flex justify-between"><span className="text-[#8ba0a2]">Plan</span><span className="font-medium capitalize">{app.subscription_plan}</span></div>
              </div>
              {app.status === 'pending_review' || app.status === 'under_review' ? (
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => updateStatus(app.id, 'rejected')} disabled={busy === app.id} className="rounded-lg border border-[#e1e9e9] px-3 py-1.5 text-xs font-semibold text-[#be653e] hover:bg-[#fff0e5]">Reject</button>
                  <button onClick={() => updateStatus(app.id, 'approved')} disabled={busy === app.id} className="rounded-lg bg-[#0d7770] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">Approve</button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function AdminPromotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [discount, setDiscount] = useState(10);
  const [serviceType, setServiceType] = useState('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    supabase.from('promotions').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      setPromotions((data as Promotion[]) ?? []);
      setLoading(false);
    });
  };
  useEffect(load, []);

  const create = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.from('promotions').insert({
      code: code.toUpperCase(), title, discount_type: 'percentage', discount_value: discount,
      service_type: serviceType === 'all' ? null : serviceType, max_redemptions: 100, is_active: true,
    });
    setBusy(false);
    if (error) { setMsg('Could not create promotion'); return; }
    setMsg('Promotion created!'); setShowForm(false); setCode(''); setTitle(''); setDiscount(10);
    load();
    window.setTimeout(() => setMsg(''), 2500);
  };

  const toggle = async (promo: Promotion) => {
    await supabase.from('promotions').update({ is_active: !promo.is_active }).eq('id', promo.id);
    load();
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Promotions" subtitle="Create and manage discount codes." action={
        <button onClick={() => setShowForm(!showForm)} className="flex w-fit items-center gap-2 rounded-xl bg-[#0d2f35] px-4 py-3 text-sm font-semibold text-white hover:bg-[#174850]"><Tag size={16} /> {showForm ? 'Cancel' : 'New promotion'}</button>
      } />
      {msg && <p className={`mb-4 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could') ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
      {showForm && (
        <Card className="mb-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">CODE</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER25" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">TITLE</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer 25% off" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">DISCOUNT (%)</span><input type="number" min={1} max={100} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]" /></div>
            <div><span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">SERVICE</span><select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none focus:border-[#0d8179]"><option value="all">All services</option>{SERVICES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          </div>
          <button onClick={create} disabled={busy || !code || !title} className="mt-4 w-full rounded-xl bg-[#0d7770] py-3.5 text-sm font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60">{busy ? 'Creating...' : 'Create promotion'}</button>
        </Card>
      )}
      {promotions.length === 0 ? (
        <Card><EmptyState icon={<Tag size={24} />} title="No promotions yet" subtitle="Create discount codes for your passengers." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {promotions.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold">{p.title}</p>
                  <p className="mt-0.5 text-[11px] text-[#8ba0a2]">Code: <span className="font-mono font-bold text-[#0d7770]">{p.code}</span> · {p.discount_value}% off</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.is_active ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-[#8ba0a2]">
                <span>{p.redemptions_count}/{p.max_redemptions} redeemed</span>
                {p.service_type && <span className="capitalize">For: {p.service_type.replace('_', ' ')}</span>}
              </div>
              <button onClick={() => toggle(p)} className="mt-3 w-full rounded-lg border border-[#e1e9e9] py-2 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">{p.is_active ? 'Deactivate' : 'Activate'}</button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function AdminAnalytics() {
  const [trips, setTrips] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('ride_requests').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => {
      setTrips((data as RideRequest[]) ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  const byService = SERVICES.map((svc) => {
    const svcTrips = trips.filter((t) => (t.service_type ?? 'standard') === svc.id);
    const revenue = svcTrips.filter((t) => t.status === 'completed').reduce((s, t) => s + t.fare, 0);
    const { commission } = calculateCommission(revenue, svc.id);
    return { ...svc, trips: svcTrips.length, revenue, commission };
  });
  const totalRevenue = byService.reduce((s, x) => s + x.revenue, 0);
  const totalCommission = byService.reduce((s, x) => s + x.commission, 0);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Platform performance by service type." />
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total revenue" value={formatXaf(totalRevenue).replace(' XAF', '')} suffix="XAF" change="18%" trend="up" icon={<DollarSign size={18} />} tint="teal" />
        <StatCard label="Platform commission" value={formatXaf(totalCommission).replace(' XAF', '')} suffix="XAF" change="15%" trend="up" icon={<TrendingUp size={18} />} tint="orange" />
        <StatCard label="Total trips" value={String(trips.length)} change="12%" trend="up" icon={<BarChart3 size={18} />} tint="blue" />
      </div>
      <Card>
        <SectionHeader title="Performance by service" subtitle="Trips, revenue, and commission breakdown" />
        <div className="divide-y divide-[#edf1f1]">
          {byService.map((svc) => (
            <div key={svc.id} className="px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${svc.tint}`}>
                    {svc.id === 'standard' || svc.id === 'coride' ? <CarFront size={16} /> : svc.id === 'moto' ? <Bike size={16} /> : svc.id === 'private_driver_city' || svc.id === 'private_driver_intercity' ? <Briefcase size={16} /> : svc.id === 'airport' ? <Plane size={16} /> : svc.id === 'intercity' ? <Route size={16} /> : <Package size={16} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{svc.label}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{svc.trips} trips · {svc.commissionRate}% commission rate</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatXaf(svc.revenue)}</p>
                  <p className="text-[11px] text-[#0d7770]">{formatXaf(svc.commission)} commission</p>
                </div>
              </div>
              {totalRevenue > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf1f1]">
                  <div className="h-full rounded-full bg-[#0d7770]" style={{ width: `${(svc.revenue / totalRevenue) * 100}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
