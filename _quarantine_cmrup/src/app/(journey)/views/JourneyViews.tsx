import { useState, useEffect, useRef } from 'react';
import { Navigation, Bike, CarFront, Phone, Share2, ShieldCheck, Star, X, CheckCircle2, MessageSquare, Users, Clock, Plus, AlertCircle, Send, Lock, Ban, RefreshCw, SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatXaf, formatRelative } from '@/lib/utils';
import { PageHeader, Card, EmptyState, Spinner } from '@/components/ui';
import type { RideRequest, RideReview, AiDriverRanking, RideMessage, Profile } from '@/lib/types';

type JourneyPhase = 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';

const NO_DRIVER_SECS = 75;

const phaseLabels: Record<JourneyPhase, string> = {
  searching: 'Finding your driver...',
  accepted: 'Driver assigned — on the way to you',
  arriving: 'Driver is arriving at your pickup',
  in_progress: 'On the way to your destination',
  completed: 'Trip completed',
  cancelled: 'Trip cancelled',
};

const phaseProgress: Record<JourneyPhase, number> = {
  searching: 0,
  accepted: 20,
  arriving: 40,
  in_progress: 70,
  completed: 100,
  cancelled: 0,
};

function statusToPhase(status: string): JourneyPhase {
  if (status === 'searching') return 'searching';
  if (status === 'accepted') return 'accepted';
  if (status === 'arriving' || status === 'driver_arrived') return 'arriving';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'in_progress';
}

function PaymentStatusChip({ status }: { status?: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Paid', cls: 'bg-[#eef7ee] text-[#2f7d32]' },
    pay_on_arrival: { label: 'Pay on arrival', cls: 'bg-[#f0f4f4] text-[#45656a]' },
    pending: { label: 'Awaiting payment', cls: 'bg-[#fdf6e8] text-[#b8860b]' },
    failed: { label: 'Payment failed', cls: 'bg-[#fdeeea] text-[#c9483a]' },
    refunded: { label: 'Refunded', cls: 'bg-[#f0f4f4] text-[#45656a]' },
    cancelled: { label: 'Cancelled', cls: 'bg-[#fdeeea] text-[#c9483a]' },
  };
  const s = map[status ?? ''];
  if (!s) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>;
}

export function ActiveJourney({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { user } = useAuth();
  const [ride, setRide] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<JourneyPhase>('searching');
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewMsg, setReviewMsg] = useState('');
  const [extensionHours, setExtensionHours] = useState(1);
  const [extensionMsg, setExtensionMsg] = useState('');
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [driverProfile, setDriverProfile] = useState<Profile | null>(null);
  const [searchSecs, setSearchSecs] = useState(0);
  const [keepLookingKey, setKeepLookingKey] = useState(0);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const searchTickRef = useRef<number | null>(null);

  useEffect(() => {
    const loadLatest = () => supabase.from('ride_requests').select('*').eq('user_id', user?.id).order('created_at', { ascending: false }).limit(1).then(({ data }) => {
      const latest = (data as RideRequest[])?.[0] ?? null;
      setRide(latest);
      if (latest) setPhase(statusToPhase(latest.status));
      setLoading(false);
    });
    loadLatest();
    const channel = supabase.channel('active-ride').on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `user_id=eq.${user?.id}` }, loadLatest).subscribe();
    const onFocus = () => loadLatest();
    window.addEventListener('focus', onFocus);
    return () => { supabase.removeChannel(channel); window.removeEventListener('focus', onFocus); };
  }, [user]);

  useEffect(() => {
    if (!ride?.driver_id) { setDriverProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', ride.driver_id).maybeSingle().then(({ data }) => {
      if (data) setDriverProfile(data as Profile);
    });
  }, [ride?.driver_id]);

  useEffect(() => {
    if (phase !== 'searching') { setSearchSecs(0); if (searchTickRef.current) window.clearInterval(searchTickRef.current); return; }
    setSearchSecs(0);
    searchTickRef.current = window.setInterval(() => setSearchSecs((s) => s + 1), 1000);
    return () => { if (searchTickRef.current) window.clearInterval(searchTickRef.current); };
  }, [phase, ride?.id, keepLookingKey]);

  const cancelRide = async (reason: string) => {
    if (!ride) return;
    setCancelBusy(true); setCancelError('');
    const { error } = await supabase.rpc('cancel_ride', { p_ride_id: ride.id, p_reason: reason });
    setCancelBusy(false);
    if (error) { setCancelError('Could not cancel your ride. Please try again.'); return; }
    setRide({ ...ride, status: 'cancelled' });
    setPhase('cancelled');
  };

  const submitReview = async () => {
    if (!ride) return;
    setReviewMsg('');
    const { error } = await supabase.from('ride_reviews').insert({
      ride_id: ride.id,
      driver_id: ride.driver_id,
      driver_name: ride.driver_name ?? 'Driver',
      reviewer_name: user?.email ?? 'Passenger',
      rating: reviewRating,
      comment: reviewComment || null,
    });
    if (error) { setReviewMsg('Could not submit review'); return; }
    setReviewMsg('Thank you for your review!');
    window.setTimeout(() => { setShowReview(false); setReviewMsg(''); }, 1500);
  };

  const requestExtension = async () => {
    if (!ride || !user) return;
    const currentApproved = ride.approved_hours ?? 1;
    const requestedTotal = currentApproved + extensionHours;
    if (requestedTotal > 12) { setExtensionMsg(`You can only extend up to 12 hours per day. You currently have ${currentApproved}h approved.`); return; }
    setExtensionBusy(true); setExtensionMsg('');
    const { error } = await supabase.from('hourly_booking_extensions').insert({ ride_id: ride.id, customer_id: user.id, driver_id: ride.driver_id, requested_hours: extensionHours });
    if (error) { setExtensionBusy(false); setExtensionMsg('Could not request extension.'); return; }
    await supabase.from('ride_requests').update({ extension_requested_hours: extensionHours, extension_status: 'pending', extension_requested_at: new Date().toISOString() }).eq('id', ride.id);
    setExtensionBusy(false); setExtensionMsg(`Extension request sent. Driver will accept or decline the extra ${extensionHours}h.`);
  };

  if (loading) return <Spinner />;
  if (!ride) {
    return (
      <>
        <PageHeader title="Active ride" subtitle="Track your driver in real time." />
        <Card><EmptyState icon={<Navigation size={24} />} title="No active ride" subtitle="Book a ride to see your driver's journey here." /></Card>
      </>
    );
  }

  if (phase === 'cancelled') {
    return (
      <>
        <PageHeader title="Active ride" subtitle="Track your driver in real time." />
        <Card className="p-8">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fdeeea] text-[#c9483a]"><Ban size={26} /></div>
            <h2 className="mt-4 font-display text-xl font-semibold text-[#0d2f35]">Ride cancelled</h2>
            <p className="mt-1.5 text-sm text-[#8ba0a2]">{ride.pickup} → {ride.destination}</p>
            <p className="mt-3 text-xs text-[#9aabad]">This ride has been cancelled. You can book another ride whenever you're ready.</p>
            <button onClick={() => onNavigate?.('book')} className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#0d2f35] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#174850]"><RefreshCw size={16} /> Book another ride</button>
          </div>
        </Card>
      </>
    );
  }

  const driverName = ride.driver_name ?? 'Finding driver...';
  const driverInitial = ride.driver_name?.charAt(0).toUpperCase() ?? '?';
  const driverAssigned = Boolean(ride.driver_id) && ride.status !== 'searching';
  const progress = phaseProgress[phase];
  const noDriver = phase === 'searching' && searchSecs >= NO_DRIVER_SECS;

  return (
    <>
      <PageHeader title="Active ride" subtitle="Track your driver's journey in real time." />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <div className="relative h-[400px] overflow-hidden bg-[#e6efeb]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(125,175,150,.28),transparent_21%),radial-gradient(circle_at_75%_65%,rgba(125,175,150,.24),transparent_20%)]" />
            <div className="absolute left-[5%] top-[48%] h-[3px] w-[90%] rotate-[17deg] bg-white/70" />
            <div className="absolute left-[40%] top-[-10%] h-[120%] w-[4px] rotate-[31deg] bg-white/70" />
            <div className="absolute left-[53%] top-[8%] h-[95%] w-[3px] rotate-[-54deg] bg-white/70" />
            <span className="absolute text-[10px] font-semibold text-[#6f8e85]" style={{ top: '17%', left: '18%' }}>{ride.pickup}</span>
            <span className="absolute text-[10px] font-semibold text-[#6f8e85]" style={{ top: '66%', left: '69%' }}>{ride.destination}</span>
            <div className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-white bg-[#0c8179] text-[10px] font-bold text-white shadow-md transition-all duration-1000" style={{ left: `${15 + progress * 0.7}%`, top: `${30 + progress * 0.4}%` }}>
              {ride.vehicle_type === 'Moto' ? <Bike size={14} /> : <CarFront size={14} />}
            </div>
            <div className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ef754d] bg-[#ef754d] shadow-md" style={{ top: '17%', left: '18%' }} />
            <div className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0c8179] bg-white shadow-md" style={{ top: '66%', left: '69%' }} />
            <div className="absolute bottom-4 left-4 flex gap-3 rounded-xl bg-white/90 px-3 py-2 text-[10px] font-medium text-[#486568] shadow-sm backdrop-blur">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#ef754d]" /> Pickup</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#0c8179]" /> Driver</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-white border border-[#0c8179]" /> Destination</span>
            </div>
          </div>
          <div className="p-5">
            {noDriver ? (
              <div className="flex items-start gap-3 rounded-xl border border-[#f0d8a8] bg-[#fdf6e8] p-3.5" role="status" aria-live="polite">
                <SearchX size={18} className="mt-0.5 shrink-0 text-[#b8860b]" />
                <div>
                  <p className="text-sm font-semibold text-[#8a6d1f]">No drivers available nearby</p>
                  <p className="mt-0.5 text-xs text-[#a07f2a]">We couldn't reach a driver right now. You can keep looking, or cancel and try a different option.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0d7770]" role="status" aria-live="polite">
                  {phase === 'completed' ? <CheckCircle2 size={18} /> : <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d9e8e5] border-t-[#0d8179]" />}
                  {phaseLabels[phase]}{phase === 'searching' && searchSecs > 0 ? ` (${searchSecs}s)` : ''}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#edf1f1]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#0d7770] to-[#15947c] transition-all duration-1000" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-[#9aabad]">
                  <span>Pickup</span><span>{progress < 50 ? 'Driver en route' : 'In trip'}</span><span>Destination</span>
                </div>
              </>
            )}
            {(phase === 'searching' || phase === 'accepted' || phase === 'arriving') && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {noDriver && (
                  <button onClick={() => setKeepLookingKey((k) => k + 1)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#dce7e6] py-2.5 text-xs font-semibold text-[#45656a] transition hover:bg-[#f5f8f8]"><RefreshCw size={14} /> Keep looking</button>
                )}
                <button onClick={() => cancelRide(noDriver ? 'no_driver_found' : 'customer_cancelled')} disabled={cancelBusy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#f0c8bd] bg-[#fdeeea] py-2.5 text-xs font-semibold text-[#c9483a] transition hover:bg-[#fbe4dd] disabled:opacity-60"><Ban size={14} /> {cancelBusy ? 'Cancelling…' : 'Cancel ride'}</button>
              </div>
            )}
            {cancelError && <p className="mt-2 text-xs text-[#c9483a]">{cancelError}</p>}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e9f55b] text-lg font-bold text-[#0d2f35]">{driverInitial}</div>
              <div className="flex-1">
                <p className="text-base font-semibold">{driverName}</p>
                <p className="mt-0.5 text-xs text-[#8ba0a2]">{ride.vehicle_type} · {ride.payment_method}</p>
                {driverAssigned && driverProfile ? (
                  <div className="mt-1 flex items-center gap-1 text-xs text-[#759092]"><Star size={12} className="text-[#edb938]" fill="currentColor" /> {driverProfile.rating?.toFixed(1) ?? '5.0'} · {driverProfile.total_trips ?? 0} trips</div>
                ) : (
                  <div className="mt-1 flex items-center gap-1 text-xs text-[#9aabad]"><Lock size={11} /> Contact unlocked once a driver accepts</div>
                )}
              </div>
            </div>
            {driverAssigned && driverProfile && (
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-[#f5f8f8] p-3 text-xs">
                <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">Vehicle</span><span className="mt-0.5 block font-semibold text-[#45656a]">{driverProfile.vehicle_type ?? ride.vehicle_type}</span></div>
                <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">Plate</span><span className="mt-0.5 block font-semibold text-[#45656a]">{driverProfile.vehicle_plate ?? '—'}</span></div>
                <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">Phone</span><span className="mt-0.5 block font-semibold text-[#45656a]">{driverProfile.phone ?? '—'}</span></div>
                <div><span className="block text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">Status</span><span className="mt-0.5 block font-semibold text-[#0d7770]">{driverProfile.is_online ? 'Online' : 'Offline'}</span></div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button disabled={!driverAssigned} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#45656a] transition hover:bg-[#f5f8f8] disabled:cursor-not-allowed disabled:opacity-40"><Phone size={14} /> Call</button>
              <button onClick={() => setShowMessages(true)} disabled={!driverAssigned} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#45656a] transition hover:bg-[#f5f8f8] disabled:cursor-not-allowed disabled:opacity-40"><MessageSquare size={14} /> Message</button>
              <button disabled={!driverAssigned} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#e1e9e9] py-2.5 text-xs font-semibold text-[#45656a] transition hover:bg-[#f5f8f8] disabled:cursor-not-allowed disabled:opacity-40"><Share2 size={14} /> Share</button>
            </div>
          </Card>
          <Card className="p-5">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-[#8ba0a2]">Route</span><span className="font-semibold">{ride.pickup} → {ride.destination}</span></div>
              <div className="flex items-center justify-between"><span className="text-[#8ba0a2]">Fare</span><span className="font-semibold">{formatXaf(ride.fare)}</span></div>
              <div className="flex items-center justify-between"><span className="text-[#8ba0a2]">Payment</span><span className="flex items-center gap-2 font-semibold">{ride.payment_method}<PaymentStatusChip status={ride.payment_status} /></span></div>
              <div className="flex items-center justify-between"><span className="text-[#8ba0a2]">Booked</span><span className="font-semibold">{formatRelative(ride.created_at)}</span></div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#f5f8ed] p-3 text-[11px] text-[#50621b]">
              <ShieldCheck size={15} className="shrink-0 text-[#68791f]" /> Your trip is protected with Njanga Safety. SOS available anytime.
            </div>
          </Card>
          {ride.booking_mode === 'hourly' && phase !== 'completed' && (
            <Card className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0d7770]"><Clock size={16} /> Hourly booking controls</div>
              <p className="mt-1 text-xs text-[#8ba0a2]">Approved duration: <strong className="text-[#45656a]">{ride.approved_hours ?? ride.requested_hours ?? 1}h</strong>. You can request more time up to 12h per day.</p>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => setExtensionHours(Math.max(1, extensionHours - 1))} className="rounded-lg border border-[#dce7e6] px-3 py-1.5 text-xs font-semibold text-[#45656a] hover:bg-[#f5f8f8]">−1h</button>
                <span className="text-xs font-semibold text-[#0d7770]">+{extensionHours}h</span>
                <button onClick={() => setExtensionHours(Math.min(12, extensionHours + 1))} className="rounded-lg border border-[#dce7e6] px-3 py-1.5 text-xs font-semibold text-[#45656a] hover:bg-[#f5f8f8]">+1h</button>
                <button onClick={requestExtension} disabled={extensionBusy || ride.extension_status === 'pending'} className="ml-auto flex items-center gap-1 rounded-lg bg-[#0d7770] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0a6359] disabled:opacity-60"><Plus size={14} /> {ride.extension_status === 'pending' ? 'Pending driver' : 'Request extension'}</button>
              </div>
              {ride.extension_status === 'accepted' && <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#e0f3ed] px-3 py-2 text-[11px] font-semibold text-[#118370]"><CheckCircle2 size={14} /> Driver accepted your extension. New total: {(ride.approved_hours ?? 1) + (ride.extension_requested_hours ?? 0)}h.</div>}
              {ride.extension_status === 'declined' && <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#fff0e5] px-3 py-2 text-[11px] font-semibold text-[#be653e]"><AlertCircle size={14} /> Driver declined the extension request.</div>}
              {extensionMsg && <p className="mt-3 text-[11px] text-[#587478]">{extensionMsg}</p>}
            </Card>
          )}
          {phase === 'completed' && !showReview && (
            <button onClick={() => setShowReview(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white hover:bg-[#174850]">
              <MessageSquare size={17} /> Rate your driver
            </button>
          )}
        </div>
      </div>

      {showReview && (
        <ReviewModal
          driverName={driverName}
          rating={reviewRating}
          setRating={setReviewRating}
          comment={reviewComment}
          setComment={setReviewComment}
          msg={reviewMsg}
          onSubmit={submitReview}
          onClose={() => setShowReview(false)}
        />
      )}

      {showMessages && ride && (
        <MessageModal rideId={ride.id} driverName={driverName} onClose={() => setShowMessages(false)} />
      )}
    </>
  );
}

function ReviewModal({ driverName, rating, setRating, comment, setComment, msg, onSubmit, onClose }: {
  driverName: string; rating: number; setRating: (n: number) => void; comment: string; setComment: (s: string) => void; msg: string; onSubmit: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#08252b]/50 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0d8179]">Rate your ride</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">How was your trip with {driverName}?</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-[#f1f5f4] p-2 text-[#597477] hover:bg-[#e3ecea]"><X size={18} /></button>
        </div>
        <div className="mb-5 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(n)} className="transition hover:scale-110">
              <Star size={36} className={n <= rating ? 'text-[#edb938]' : 'text-[#dce7e6]'} fill={n <= rating ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Leave a comment (optional)..."
          rows={3}
          className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] p-3 text-sm outline-none transition focus:border-[#0d8179]"
        />
        <button onClick={onSubmit} className="mt-4 w-full rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white hover:bg-[#174850]">
          {msg || 'Submit review'}
        </button>
      </div>
    </div>
  );
}

function MessageModal({ rideId, driverName, onClose }: { rideId: string; driverName: string; onClose: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = () => supabase.from('ride_messages').select('*').eq('ride_id', rideId).order('created_at', { ascending: true }).then(({ data }) => {
      setMessages((data as RideMessage[]) ?? []);
    });
    load();
    const channel = supabase.channel(`ride-messages-${rideId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rideId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!body.trim() || !user) return;
    setBusy(true); setError('');
    const { error } = await supabase.from('ride_messages').insert({ ride_id: rideId, sender_id: user.id, sender_role: 'customer', body: body.trim() });
    if (error) { setError('Could not send message.'); setBusy(false); return; }
    setBody(''); setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#08252b]/50 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="flex h-[80vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl sm:h-[70vh] sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-[#edf1f1] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9f55b] text-sm font-bold text-[#0d2f35]">{driverName.charAt(0)}</div>
            <div>
              <p className="text-sm font-semibold">Message {driverName}</p>
              <p className="text-[11px] text-[#8ba0a2]">Your driver can reply in real time</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-[#f1f5f4] p-2 text-[#597477] hover:bg-[#e3ecea]"><X size={18} /></button>
        </div>
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f8f8] text-[#9aabad]"><MessageSquare size={22} /></div>
              <p className="text-sm font-semibold text-[#45656a]">No messages yet</p>
              <p className="mt-1 text-xs text-[#9aabad]">Say hello to your driver.</p>
            </div>
          ) : messages.map((msg) => {
            const mine = msg.sender_id === user?.id;
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
        {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2 border-t border-[#edf1f1] p-3">
          <input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Type a message..." className="flex-1 rounded-full border border-[#dce7e6] bg-[#fbfcfc] px-4 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
          <button onClick={send} disabled={busy || !body.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0d7770] text-white transition hover:bg-[#0a6359] disabled:opacity-50"><Send size={17} /></button>
        </div>
      </div>
    </div>
  );
}

export function TopDrivers() {
  const [rankings, setRankings] = useState<AiDriverRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'Moto' | 'Taxi' | 'Car' | 'coride'>('all');

  useEffect(() => {
    Promise.all([
      supabase.from('ride_reviews').select('*'),
      supabase.from('profiles').select('*').eq('role', 'driver'),
    ]).then(([reviewRes, driverRes]) => {
      const reviews = (reviewRes.data as RideReview[]) ?? [];
      const drivers = ((driverRes as { data: { id: string; full_name: string; total_trips: number; rating: number; vehicle_type?: string }[] })?.data) ?? [];
      const driverMap = new globalThis.Map(drivers.map((d) => [d.full_name, d]));

      const byDriver = new globalThis.Map<string, RideReview[]>();
      for (const r of reviews) {
        const arr = byDriver.get(r.driver_name) ?? [];
        arr.push(r);
        byDriver.set(r.driver_name, arr);
      }

      const ranked: AiDriverRanking[] = [];
      for (const [name, revs] of byDriver) {
        const avgRating = revs.reduce((s, r) => s + r.rating, 0) / revs.length;
        const profile = driverMap.get(name);
        const totalTrips = profile?.total_trips ?? revs.length * 3;
        const positiveRevs = revs.filter((r) => r.rating >= 4).length;
        const sentimentRatio = positiveRevs / revs.length;
        const aiScore = Math.round((avgRating * 20 + totalTrips * 0.5 + sentimentRatio * 15) * 10) / 10;
        const tier = aiScore >= 95 ? 'Platinum' : aiScore >= 85 ? 'Gold' : aiScore >= 70 ? 'Silver' : 'Bronze';
        const sentiment = sentimentRatio >= 0.8 ? 'Excellent' : sentimentRatio >= 0.6 ? 'Good' : 'Average';
        const bestComment = revs.filter((r) => r.rating === 5).sort((a, b) => b.rating - a.rating)[0]?.comment ?? revs[0]?.comment ?? null;
        const vehicleType = profile?.vehicle_type ?? 'Moto';
        ranked.push({ driver_name: name, driver_id: profile?.id ?? null, avg_rating: Math.round(avgRating * 10) / 10, review_count: revs.length, total_trips: totalTrips, ai_score: aiScore, tier, sentiment, best_comment: bestComment, vehicle_type: vehicleType });
      }
      ranked.sort((a, b) => b.ai_score - a.ai_score);
      setRankings(ranked);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  const tierColors: Record<string, string> = {
    Platinum: 'bg-gradient-to-r from-[#e0e0e0] to-[#c0c0c0] text-[#555]',
    Gold: 'bg-gradient-to-r from-[#f4d03f] to-[#e8b823] text-[#6b5300]',
    Silver: 'bg-gradient-to-r from-[#d5d8dc] to-[#b0b4ba] text-[#4a4f55]',
    Bronze: 'bg-gradient-to-r from-[#e8a87c] to-[#d4936a] text-[#6b3a1a]',
  };

  return (
    <>
      <PageHeader title="Top drivers" subtitle="AI-ranked drivers based on ratings, trips, and review sentiment." />
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#e7f4f0] bg-[#f0faf7] p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d7770] text-white text-sm font-bold">AI</div>
        <p className="text-xs text-[#45656a]">Our AI analyzes <strong>rating averages</strong>, <strong>trip volume</strong>, and <strong>review sentiment</strong> to classify drivers into tiers. Book with confidence.</p>
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {([['all', 'All', <Star key="a" size={15} />], ['Moto', 'Bikes', <Bike key="b" size={15} />], ['Taxi', 'Taxis', <CarFront key="c" size={15} />], ['Car', 'Cars', <CarFront key="d" size={15} />], ['coride', 'Co-rides', <Users key="e" size={15} />]] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setFilter(id as typeof filter)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition ${filter === id ? 'border-[#0d7770] bg-[#0d7770] text-white' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}>
            {icon} {label}
          </button>
        ))}
      </div>
      {rankings.length === 0 ? (
        <Card><EmptyState icon={<Star size={24} />} title="No driver rankings yet" subtitle="Reviews will power the AI classification." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rankings.filter((d) => filter === 'all' || filter === 'coride' || d.vehicle_type === filter).map((d) => (
            <Card key={d.driver_name} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e9f55b] text-lg font-bold text-[#0d2f35]">{d.driver_name.charAt(0)}</div>
                  <div>
                    <p className="text-sm font-semibold">{d.driver_name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#759092]"><Star size={12} className="text-[#edb938]" fill="currentColor" /> {d.avg_rating} · {d.total_trips} trips · <span className="flex items-center gap-0.5">{d.vehicle_type === 'Moto' ? <Bike size={11} /> : <CarFront size={11} />}{d.vehicle_type}</span></div>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${tierColors[d.tier] ?? 'bg-[#f0eeee] text-[#8a7272]'}`}>{d.tier}</span>
                  <p className="mt-1.5 font-display text-lg font-semibold text-[#0d7770]">{d.ai_score}</p>
                </div>
              </div>
              {d.best_comment && (
                <div className="mt-3 rounded-xl bg-[#f7f9f8] p-3 text-xs italic text-[#587478]">"{d.best_comment}"</div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-[#edf1f1] pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">AI sentiment: <span className="text-[#0d7770]">{d.sentiment}</span></span>
                <span className="text-[10px] text-[#9aabad]">{d.review_count} reviews</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
