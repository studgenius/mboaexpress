import { useState, useEffect } from 'react';
import { CarFront, Plus, Users, Clock3, CheckCircle2, X, TrendingUp, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatXaf, formatTime, formatRelative, timeUntil } from '@/lib/utils';
import { StatCard, PageHeader, Card, SectionHeader, EmptyState, Spinner } from '@/components/ui';
import type { CoRide, CoRideBooking } from '@/lib/types';

export function OwnerHome({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { profile } = useAuth();
  const [corides, setCorides] = useState<CoRide[]>([]);
  const [bookings, setBookings] = useState<CoRideBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('corides').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false }).then(({ data: cd }) => {
      const cl = (cd as CoRide[]) ?? [];
      setCorides(cl);
      if (cl.length > 0) {
        supabase.from('coride_bookings').select('*').in('coride_id', cl.map((c) => c.id)).order('created_at', { ascending: false }).then(({ data: bd }) => {
          setBookings((bd as CoRideBooking[]) ?? []);
          setLoading(false);
        });
      } else { setLoading(false); }
    });
  }, [profile]);

  const totalSeats = bookings.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.seats_booked, 0);
  const revenue = corides.reduce((s, c) => s + (c.total_seats - c.available_seats) * c.price_per_seat, 0);

  return (
    <>
      <PageHeader title={`Hello, ${profile?.full_name?.split(' ')[0] ?? 'Owner'}`} subtitle="Manage your co-riding services." action={
        <button onClick={() => onNavigate('create')} className="flex w-fit items-center gap-2 rounded-xl bg-[#0d2f35] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(13,47,53,0.14)] transition hover:-translate-y-0.5 hover:bg-[#174850]"><Plus size={17} /> Create co-ride</button>
      } />
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active co-rides" value={String(corides.filter((c) => c.status === 'open').length)} change="2" trend="up" icon={<CarFront size={18} />} tint="teal" />
        <StatCard label="Seats booked" value={String(totalSeats)} change="5" trend="up" icon={<Users size={18} />} tint="lime" />
        <StatCard label="Revenue" value={formatXaf(revenue).replace(' XAF', '')} suffix="XAF" change="12%" trend="up" icon={<TrendingUp size={18} />} tint="orange" />
        <StatCard label="Rating" value={profile?.rating?.toFixed(1) ?? '5.0'} change="0.1" trend="up" icon={<Star size={18} />} tint="blue" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Your active co-rides" subtitle="Open offers" action={<button onClick={() => onNavigate('corides')} className="text-xs font-semibold text-[#0d7770]">View all →</button>} />
          {loading ? <Spinner /> : corides.filter((c) => c.status === 'open').length === 0 ? (
            <EmptyState icon={<CarFront size={24} />} title="No active co-rides" subtitle="Create one to start offering seats." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {corides.filter((c) => c.status === 'open').slice(0, 4).map((cr) => (
                <div key={cr.id} className="px-5 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{cr.pickup} → {cr.destination}</p>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]"><Clock3 size={11} className="mr-1 inline" />{timeUntil(cr.departure_time)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold">{formatXaf(cr.price_per_seat)}/seat</p>
                      <p className="mt-0.5 text-[10px] text-[#8ba0a2]">{cr.available_seats}/{cr.total_seats} available</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionHeader title="Recent bookings" subtitle="Passengers who reserved seats" action={<button onClick={() => onNavigate('bookings')} className="text-xs font-semibold text-[#0d7770]">View all →</button>} />
          {loading ? <Spinner /> : bookings.length === 0 ? (
            <EmptyState icon={<Users size={24} />} title="No bookings yet" subtitle="Passenger reservations will appear here." />
          ) : (
            <div className="divide-y divide-[#edf1f1]">
              {bookings.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between px-5 py-3.5 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f1f6d2] text-[#68791f]"><Users size={15} /></div>
                    <div>
                      <p className="text-xs font-semibold">{b.passenger_name}</p>
                      <p className="text-[10px] text-[#9aabad]">{b.seats_booked} seat(s) · {b.payment_method} · {formatRelative(b.created_at)}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.status === 'confirmed' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export function MyCoRides() {
  const { profile } = useAuth();
  const [corides, setCorides] = useState<CoRide[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!profile) return;
    supabase.from('corides').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      setCorides((data as CoRide[]) ?? []);
      setLoading(false);
    });
  };
  useEffect(load, [profile]);

  const cancel = async (id: string) => {
    await supabase.from('corides').update({ status: 'cancelled' }).eq('id', id);
    load();
  };

  return (
    <>
      <PageHeader title="My co-rides" subtitle="All your co-riding offers." />
      <Card>
        {loading ? <Spinner /> : corides.length === 0 ? (
          <EmptyState icon={<CarFront size={24} />} title="No co-rides yet" subtitle="Create your first co-ride to offer seats." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {corides.map((cr) => (
              <div key={cr.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e7f4f0] text-[#0d7770]"><CarFront size={18} /></div>
                    <div>
                      <p className="text-sm font-semibold">{cr.pickup} → {cr.destination}</p>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatTime(cr.departure_time)} · {cr.vehicle_info}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatXaf(cr.price_per_seat)}<span className="text-[11px] font-normal text-[#9aabad]"> /seat</span></p>
                    <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{cr.available_seats}/{cr.total_seats} available</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cr.status === 'open' ? 'bg-[#e0f3ed] text-[#118370]' : cr.status === 'full' ? 'bg-[#fff0e5] text-[#be653e]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{cr.status}</span>
                  {cr.status === 'open' && <button onClick={() => cancel(cr.id)} className="text-xs font-semibold text-[#be653e] hover:underline">Cancel offer</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function CreateCoRide() {
  const { profile } = useAuth();
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [departure, setDeparture] = useState('');
  const [seats, setSeats] = useState(4);
  const [price, setPrice] = useState(2000);
  const [vehicleInfo, setVehicleInfo] = useState(profile?.vehicle_type ? `${profile.vehicle_type}${profile.vehicle_plate ? `, ${profile.vehicle_plate}` : ''}` : '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg('');
    const { error } = await supabase.from('corides').insert({
      owner_id: profile?.id, owner_name: profile?.full_name ?? 'Owner',
      pickup, destination, departure_time: new Date(departure).toISOString(),
      total_seats: seats, available_seats: seats, price_per_seat: price, vehicle_info: vehicleInfo, status: 'open',
    });
    setBusy(false);
    if (error) { setMsg('Could not create co-ride'); return; }
    setMsg('Co-ride published! Passengers can now book.');
    setPickup(''); setDestination(''); setDeparture('');
  };

  return (
    <>
      <PageHeader title="Create a co-ride" subtitle="Offer seats in your private vehicle." />
      <div className="mx-auto max-w-lg">
        <Card className="p-6">
          <div className="space-y-3">
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">PICKUP LOCATION</span>
              <input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Bastos" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">DESTINATION</span>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Douala (Akwa)" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">DEPARTURE TIME</span>
              <input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">TOTAL SEATS</span>
                <input type="number" min={1} max={8} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
              </div>
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">PRICE / SEAT (XAF)</span>
                <input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
              </div>
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">VEHICLE INFO</span>
              <input value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="e.g. Toyota Corolla, grey" className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 px-3 text-sm outline-none transition focus:border-[#0d8179]" />
            </div>
          </div>
          <button onClick={submit} disabled={busy || !pickup || !destination || !departure} className="mt-5 w-full rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">
            {busy ? 'Publishing...' : 'Publish co-ride'}
          </button>
          {msg && <p className={`mt-3 flex items-center gap-2 text-sm font-semibold ${msg.includes('Could not') ? 'text-red-600' : 'text-[#0d7770]'}`}>{msg.includes('Could not') ? <X size={16} /> : <CheckCircle2 size={16} />}{msg}</p>}
        </Card>
      </div>
    </>
  );
}

export function OwnerBookings() {
  const { profile } = useAuth();
  const [corides, setCorides] = useState<CoRide[]>([]);
  const [bookings, setBookings] = useState<CoRideBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('corides').select('*').eq('owner_id', profile.id).order('created_at', { ascending: false }).then(({ data: cd }) => {
      const cl = (cd as CoRide[]) ?? [];
      setCorides(cl);
      if (cl.length > 0) {
        supabase.from('coride_bookings').select('*').in('coride_id', cl.map((c) => c.id)).order('created_at', { ascending: false }).then(({ data: bd }) => {
          setBookings((bd as CoRideBooking[]) ?? []);
          setLoading(false);
        });
      } else { setLoading(false); }
    });
  }, [profile]);

  const corideMap = new Map(corides.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Bookings" subtitle="Passengers who reserved seats on your co-rides." />
      <Card>
        {loading ? <Spinner /> : bookings.length === 0 ? (
          <EmptyState icon={<Users size={24} />} title="No bookings yet" subtitle="When passengers book your co-rides, they'll appear here." />
        ) : (
          <div className="divide-y divide-[#edf1f1]">
            {bookings.map((b) => {
              const cr = corideMap.get(b.coride_id);
              return (
                <div key={b.id} className="flex items-center justify-between px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f6d2] text-[#68791f]"><Users size={18} /></div>
                    <div>
                      <p className="text-sm font-semibold">{b.passenger_name}</p>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{cr ? `${cr.pickup} → ${cr.destination}` : 'Co-ride'} · {b.seats_booked} seat(s) · {b.payment_method} · {formatRelative(b.created_at)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{cr ? formatXaf(cr.price_per_seat * b.seats_booked) : '--'}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.status === 'confirmed' ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#f0eeee] text-[#8a7272]'}`}>{b.status}</span>
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
