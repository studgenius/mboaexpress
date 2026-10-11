import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Bike, CarFront, Smartphone, ShieldCheck, Map, Search, Clock3, Users, CheckCircle2, Route, Clock, Plane, Package, UserRound, Briefcase, ChevronRight, PlaneTakeoff, PlaneLanding, MapPin, Loader2, ArrowRight, ArrowLeftRight, CalendarDays, Repeat, Shield, Building2, Sparkles, Wand2, TrendingUp, AlertTriangle, Home, Check, MessageCircle, ArrowLeft, X, ChevronDown } from 'lucide-react';
import { buildJourneyInsights, type VehicleClass } from '@/lib/predictions';
import { JourneyInsightsPanel } from '@/components/JourneyInsights';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCountry } from '@/lib/country-config';
import { formatXaf, formatRelative, timeUntil } from '@/lib/utils';
import { PageHeader, Card, EmptyState, Spinner } from '@/components/ui';
import { assessJourney, matchCoRides } from '@/lib/journey-ai';
import type { CoRideMatch } from '@/lib/journey-ai';
import type { RideRequest, CoRide, VehicleType, ServiceType, TripType, Airport, JourneyAssessment } from '@/lib/types';
import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { BookingMap } from '@/components/BookingMap';
import { useSavedPlaces } from '@/lib/use-saved-places';
import { getEligibleRides, type EligibleRide } from '@/lib/services';

type Category = 'daily' | 'private_driver' | 'airport' | 'travel_delivery';

const CITY_TRIP_TYPES: { id: TripType; label: string; icon: React.ReactNode }[] = [
  { id: 'one_way', label: 'One-way', icon: <ArrowRight size={16} /> },
  { id: 'round_trip', label: 'Round trip', icon: <ArrowLeftRight size={16} /> },
  { id: 'hourly', label: 'By the hour', icon: <Clock size={16} /> },
  { id: 'full_day', label: 'Full day', icon: <CalendarDays size={16} /> },
];

const INTERCITY_TRIP_TYPES: { id: TripType; label: string; icon: React.ReactNode }[] = [
  { id: 'one_way', label: 'One-way', icon: <ArrowRight size={16} /> },
  { id: 'round_trip', label: 'Round trip', icon: <ArrowLeftRight size={16} /> },
  { id: 'return_later', label: 'Return later', icon: <Repeat size={16} /> },
  { id: 'multi_day', label: 'Multi-day', icon: <CalendarDays size={16} /> },
];

const RIDE_ICONS = { Bike, CarFront, Users, Briefcase };

const TIME_SLOTS = ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

function paymentDotColor(method: string): string {
  const m = method.toLowerCase();
  if (m.includes('mtn')) return 'bg-[#ffcc00]';
  if (m.includes('orange')) return 'bg-[#ff7900]';
  if (m.includes('wave')) return 'bg-[#1dc4e9]';
  if (m.includes('airtel')) return 'bg-[#e40000]';
  if (m.includes('moov')) return 'bg-[#0a5cb8]';
  if (m.includes('free')) return 'bg-[#c8102e]';
  if (m.includes('wallet')) return 'bg-[#0d7770]';
  if (m.includes('cash')) return 'bg-[#5a7d5a]';
  return 'bg-[#9aabad]';
}

function paymentHint(method: string): string {
  const m = method.toLowerCase();
  if (m.includes('wallet')) return 'Pay instantly from your Njanga balance';
  if (m.includes('cash')) return 'Pay the driver directly at drop-off';
  return 'Approve the charge from your mobile money';
}

function AiJourneyPanel({ assessment, onApply, formatCurrency }: { assessment: JourneyAssessment; onApply: () => void; formatCurrency: (v: number) => string }) {
  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-[#e7f0f5] bg-gradient-to-br from-[#f8fbff] to-[#eef5fb]">
      <div className="flex items-center gap-2.5 bg-[#e7f0f5] px-4 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c6f9a] text-white"><Sparkles size={15} /></div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#2c6f9a]">AI Journey Assessment</p>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#2c6f9a]">{Math.round(assessment.confidence * 100)}% confidence</span>
      </div>
      <div className="p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <span className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${assessment.isIntercity ? 'bg-[#f5ede0] text-[#8a6520]' : 'bg-[#e7f4f0] text-[#0d7770]'}`}>
            {assessment.isIntercity ? <Route size={13} /> : <Building2 size={13} />}
            {assessment.isIntercity ? 'Intercity journey' : 'City journey'}
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#45656a]"><Map size={13} /> ~{assessment.estimatedDistanceKm} km</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#45656a]"><Clock size={13} /> ~{assessment.estimatedDurationMin} min</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#45656a]"><TrendingUp size={13} /> {formatCurrency(assessment.fareRange.min)}–{formatCurrency(assessment.fareRange.max)}</span>
        </div>
        <div className="mb-3 space-y-1.5">
          {assessment.aiReasoning.map((reason, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-[#45656a]"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#2c6f9a]" /><span>{reason}</span></div>
          ))}
        </div>
        {assessment.safetyNotes.length > 0 && (
          <div className="mb-3 rounded-lg bg-[#fffaf6] p-3">
            {assessment.safetyNotes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-[#be653e]"><AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{note}</span></div>
            ))}
          </div>
        )}
        <button onClick={onApply} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2c6f9a] py-2.5 text-xs font-semibold text-white transition hover:bg-[#245a80]"><Wand2 size={14} /> Apply AI recommendation</button>
      </div>
    </div>
  );
}



export function CustomerHome({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { profile } = useAuth();
  const { places } = useSavedPlaces();
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  const quickOptions = [
    { label: 'Ride', sub: 'Ride now', icon: <CarFront size={22} />, view: 'book', tint: 'bg-[#0d2f35] text-[#e9f55b]' },
    { label: 'Schedule', sub: 'Book for later', icon: <Clock size={22} />, view: 'book', tint: 'bg-[#2c6f9a] text-white' },
    { label: 'Airport / Intercity', sub: 'Airport & long distance', icon: <Plane size={22} />, view: 'book', tint: 'bg-[#0d7770] text-white' },
    { label: 'Delivery', sub: 'Send a package', icon: <Package size={22} />, view: 'book', tint: 'bg-[#be653e] text-white' },
    { label: 'Co-Ride', sub: 'Share a ride', icon: <Users size={22} />, view: 'coride', tint: 'bg-[#526213] text-[#e9f55b]' },
  ];

  return (
    <>
      <PageHeader title={`Hello, ${firstName} 👋`} subtitle="Where are you going today?" />

      {/* Dominant search card */}
      <button
        onClick={() => onNavigate('book')}
        className="group mb-7 flex w-full items-center gap-4 rounded-2xl border border-[#dce7e6] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9fbdbc] hover:shadow-md sm:p-6"
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#e9f55b] text-[#0d2f35]">
          <Search size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold text-[#0d2f35]">Where are you going?</p>
          <p className="mt-0.5 text-xs text-[#8ba0a2]">Enter a destination to see available rides</p>
        </div>
        <ChevronRight size={22} className="shrink-0 text-[#9aabad] transition group-hover:translate-x-0.5 group-hover:text-[#0d7770]" />
      </button>

      {/* Quick options */}
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9aabad]">Quick options</p>
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {quickOptions.map((qo) => (
          <button
            key={qo.label}
            onClick={() => onNavigate(qo.view)}
            className="flex flex-col gap-3 rounded-2xl border border-[#e1e9e9] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#9fbdbc] hover:shadow-md"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${qo.tint}`}>{qo.icon}</div>
            <div>
              <p className="text-sm font-semibold text-[#0d2f35]">{qo.label}</p>
              <p className="text-[11px] text-[#8ba0a2]">{qo.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Recent places */}
      <div className="mb-7">
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9aabad]">Recent places</p>
        {places.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-[#e1e9e9] bg-white">
            {places.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onNavigate('book')}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#f5f8f8] ${i > 0 ? 'border-t border-[#eef2f1]' : ''}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f4f4] text-[#0d7770]">
                  {p.type === 'home' ? <Home size={16} /> : p.type === 'work' ? <Briefcase size={16} /> : <MapPin size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#0d2f35]">{p.label}</p>
                  <p className="truncate text-[11px] text-[#9aabad]">{p.address}</p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-[#c3d0cf]" />
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => onNavigate('book')}
            className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[#d6e2e0] bg-[#f7faf9] px-4 py-5 text-left transition hover:border-[#9fbdbc]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#9aabad]"><MapPin size={16} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#45656a]">No recent places yet</p>
              <p className="text-[11px] text-[#8ba0a2]">Places you save or book will show up here for quick access.</p>
            </div>
          </button>
        )}
      </div>

      {/* Book with WhatsApp */}
      <div className="flex items-center gap-4 rounded-2xl border border-[#cdead7] bg-[#f2fbf5] p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#25d366] text-white">
          <MessageCircle size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#0d2f35]">Book with WhatsApp</p>
          <p className="mt-0.5 text-xs text-[#5a8a70]">Book your Njanga ride directly through WhatsApp.</p>
        </div>
        <button
          onClick={() => onNavigate('channels')}
          className="shrink-0 rounded-xl bg-[#0d2f35] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#174850]"
        >
          Continue on WhatsApp
        </button>
      </div>
    </>
  );
}

export function BookRide({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { user, profile, refreshProfile } = useAuth();
  const { country, formatCurrency } = useCountry();
  const { places, addPlace } = useSavedPlaces();
  const [category, setCategory] = useState<Category>('daily');
  const [vehicle, setVehicle] = useState<'Car' | 'Moto'>('Car');
  const [motoPro, setMotoPro] = useState(false);
  const [helmetConfirmed, setHelmetConfirmed] = useState(false);
  const [pickup, setPickup] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pickupNote, setPickupNote] = useState('');
  const [showLandmark, setShowLandmark] = useState(false);
  const [destination, setDestination] = useState('');
  const [payment, setPayment] = useState(country.payment_methods[0] ?? 'Cash');  const [cashChangeFor, setCashChangeFor] = useState('');
  const [status, setStatus] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [detecting, setDetecting] = useState(false);
  const [selectedRideId, setSelectedRideId] = useState<'moto' | 'standard' | 'coride' | 'private_driver' | ''>('');
  const [rideChosen, setRideChosen] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleSlot, setScheduleSlot] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, { quote_id: string; total: number; capacity: number; expires_at: string }>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [quotesExpiresAt, setQuotesExpiresAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const quoteReqRef = useRef(0);
  const submittingRef = useRef(false);
  const [showSavePlace, setShowSavePlace] = useState(false);
  const [savePlaceLabel, setSavePlaceLabel] = useState('');
  const [savePlaceType, setSavePlaceType] = useState<'home' | 'work' | 'other'>('home');

  const [tripType, setTripType] = useState<TripType | null>(null);
  const [hours, setHours] = useState(1);
  const [driverOption, setDriverOption] = useState<'driver_only' | 'driver_and_vehicle'>('driver_and_vehicle');
  const [aiApplied, setAiApplied] = useState(false);
  const [privateScope, setPrivateScope] = useState<'city' | 'intercity' | null>(null);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportDirection, setAirportDirection] = useState<'pickup' | 'dropoff' | null>(null);
  const [selectedAirport, setSelectedAirport] = useState<Airport | null>(null);
  const [airportSearch, setAirportSearch] = useState('');
  const [userRegion, setUserRegion] = useState<string | null>(null);
  const [airportsLoading, setAirportsLoading] = useState(false);
  const [flightNumber, setFlightNumber] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [packageDesc, setPackageDesc] = useState('');
  const [deliveryVehicle, setDeliveryVehicle] = useState<'moto' | 'car'>('moto');

  const isDaily = category === 'daily';
  const isPrivateDriver = category === 'private_driver';
  const isAirport = category === 'airport';
  const isDelivery = category === 'travel_delivery';
  const isMoto = isDaily && selectedRideId === 'moto';
  const isMotoPro = isMoto && motoPro;
  const isHourly = isPrivateDriver && tripType === 'hourly';
  const isFullDay = isPrivateDriver && tripType === 'full_day';
  const isMultiDay = isPrivateDriver && tripType === 'multi_day';
  const destinationDisabled = isHourly || isFullDay;
  const isPrivateDriverCity = isPrivateDriver && privateScope === 'city';
  const isPrivateDriverIntercity = isPrivateDriver && privateScope === 'intercity';

  const aiAssessment = useMemo(() => {
    if (!isPrivateDriver || !destination.trim()) return null;
    return assessJourney(pickup, destination, passengers);
  }, [isPrivateDriver, pickup, destination, passengers]);

  const routeInfo = useMemo(
    () => (pickup.trim() && destination.trim() ? assessJourney(pickup, destination, passengers) : null),
    [pickup, destination, passengers],
  );

  const journeyInsights = useMemo(() => {
    if (!isDaily || !routeInfo) return null;
    const vehicle: VehicleClass = selectedRideId === 'moto' ? 'moto' : selectedRideId === 'coride' ? 'shared' : 'car';
    return buildJourneyInsights({
      pickup, destination,
      distanceKm: routeInfo.estimatedDistanceKm,
      durationMin: routeInfo.estimatedDurationMin,
      isIntercity: routeInfo.isIntercity,
      vehicle,
      seed: country.name,
    });
  }, [isDaily, routeInfo, selectedRideId, pickup, destination, country.name]);

  const eligibleRides = useMemo(
    () => (isDaily && pickup.trim() && destination.trim()
      ? getEligibleRides({
          distanceKm: routeInfo?.estimatedDistanceKm ?? 0,
          passengers,
          isIntercity: routeInfo?.isIntercity ?? false,
          fares: { baseMoto: country.base_fare_moto, perKmMoto: country.per_km_moto, baseCar: country.base_fare_car, perKmCar: country.per_km_car, basePrivate: country.base_fare_private_driver, perKmPrivate: country.per_km_private_driver },
        })
      : []),
    [isDaily, pickup, destination, routeInfo, passengers, country],
  );
  const selectedEligible = eligibleRides.find((r) => r.id === selectedRideId) ?? null;

  useEffect(() => {
    if (selectedRideId && !eligibleRides.some((r) => r.id === selectedRideId)) { setSelectedRideId(''); setRideChosen(false); }
  }, [eligibleRides, selectedRideId]);

  const fetchQuotes = useCallback(async () => {
    if (!isDaily || !routeInfo) { setQuotes({}); setQuotesExpiresAt(null); setQuotesError(null); return; }
    const reqId = ++quoteReqRef.current;
    setQuotesLoading(true); setQuotesError(null);
    const { data, error } = await supabase.rpc('quote_rides', {
      p_country_code: country.code,
      p_distance_km: routeInfo.estimatedDistanceKm,
      p_duration_min: routeInfo.estimatedDurationMin,
      p_passengers: passengers,
      p_is_intercity: routeInfo.isIntercity,
    });
    if (reqId !== quoteReqRef.current) return;
    setQuotesLoading(false);
    if (error || !Array.isArray(data)) { setQuotesError('We could not get live fares. Please try again.'); setQuotes({}); setQuotesExpiresAt(null); return; }
    const map: Record<string, { quote_id: string; total: number; capacity: number; expires_at: string }> = {};
    let minExp = Infinity;
    for (const row of data as { quote_id: string; service_type: string; total: number; capacity: number; expires_at: string }[]) {
      map[row.service_type] = { quote_id: row.quote_id, total: row.total, capacity: row.capacity, expires_at: row.expires_at };
      const t = new Date(row.expires_at).getTime();
      if (t < minExp) minExp = t;
    }
    setQuotes(map); setQuotesExpiresAt(Number.isFinite(minExp) ? minExp : null);
  }, [isDaily, routeInfo, country.code, passengers]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  useEffect(() => {
    if (!quotesExpiresAt) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [quotesExpiresAt]);

  const selectedQuote = selectedEligible ? quotes[selectedEligible.serviceType] : undefined;
  const quotesExpired = quotesExpiresAt != null && nowTick > quotesExpiresAt;

  useEffect(() => {
    if (aiAssessment && !privateScope && !aiApplied) setPrivateScope(aiAssessment.recommendedScope);
  }, [aiAssessment, privateScope, aiApplied]);

  useEffect(() => {
    if (!isAirport || airports.length > 0) return;
    setAirportsLoading(true);
    supabase.from('airports').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setAirports((data as Airport[]) ?? []);
      setAirportsLoading(false);
    });
  }, [isAirport, airports.length]);

  useEffect(() => {
    if (isAirport && !userRegion && profile?.region) setUserRegion(profile.region);
  }, [isAirport, userRegion, profile]);

  useEffect(() => {
    if (country.payment_methods.length > 0 && !country.payment_methods.includes(payment)) setPayment(country.payment_methods[0]);
  }, [country, payment]);

  const detectLocation = () => {
    setDetecting(true);
    if (!navigator.geolocation) { setDetecting(false); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      await supabase.from('user_locations').upsert({ user_id: user?.id, latitude, longitude, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      let nearest: Airport | null = null;
      let minDist = Infinity;
      for (const airport of airports) {
        const distance = Math.sqrt(Math.pow(airport.latitude - latitude, 2) + Math.pow(airport.longitude - longitude, 2));
        if (distance < minDist) { minDist = distance; nearest = airport; }
      }
      if (nearest) { setUserRegion(nearest.region); setPickup(`${nearest.city}, ${nearest.region}`); }
      setDetecting(false);
    }, () => setDetecting(false), { timeout: 10000 });
  };

  const sortedAirports = useMemo(() => {
    const filtered = airportSearch ? airports.filter((a) => `${a.name} ${a.city} ${a.iata_code}`.toLowerCase().includes(airportSearch.toLowerCase())) : airports;
    return userRegion ? [...filtered].sort((a, b) => (a.region === userRegion ? 0 : 1) - (b.region === userRegion ? 0 : 1)) : filtered;
  }, [airports, airportSearch, userRegion]);

  const baseFare = isMotoPro ? country.base_fare_moto_pro : isMoto ? country.base_fare_moto : isPrivateDriver ? country.base_fare_private_driver : isAirport ? country.base_fare_airport : country.base_fare_car;
  const hourlyRate = vehicle === 'Moto' ? country.hourly_rate_moto : country.hourly_rate_car;
  const discount = hours >= 8 ? 15 : hours >= 4 ? 10 : hours >= 2 ? 5 : 0;
  const fare = isDaily ? (selectedQuote?.total ?? selectedEligible?.fare ?? 0) : isHourly ? Math.round(hourlyRate * hours * (1 - discount / 100)) : isFullDay ? Math.round(hourlyRate * 12 * 0.75) : isMultiDay ? country.daily_rate * Math.max(1, Math.ceil(hours / 24)) : baseFare;
  const maxPassengers = selectedRideId === 'moto' ? 1 : selectedRideId === 'coride' ? 2 : 4;

  const dbServiceType: string = isDaily ? (selectedEligible?.serviceType ?? 'standard') : isPrivateDriver ? (privateScope === 'intercity' ? 'private_driver_intercity' : 'private_driver_city') : isAirport ? 'airport' : isDelivery ? 'delivery' : 'standard';

  const selectCategory = (cat: Category) => {
    setCategory(cat); setStatus(''); setTripType(null); setPrivateScope(null); setSelectedAirport(null); setAirportDirection(null); setAiApplied(false);
    setScheduledTime(''); setScheduleDate(''); setScheduleSlot('');
    setSelectedRideId(''); setRideChosen(false);
    if (cat === 'daily') setVehicle('Car');
  };

  const selectRide = (ride: EligibleRide) => {
    setSelectedRideId(ride.id);
    setRideChosen(true);
    if (ride.id === 'moto') { setVehicle('Moto'); setPassengers(1); }
    else { setVehicle('Car'); setMotoPro(false); setHelmetConfirmed(false); if (ride.id === 'coride' && passengers > 2) setPassengers(2); }
    if (ride.id === 'private_driver') setPrivateScope(routeInfo?.isIntercity ? 'intercity' : 'city');
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const pickDate = (d: string) => { setScheduleDate(d); setScheduledTime(scheduleSlot ? `${d}T${scheduleSlot}` : ''); };
  const pickSlot = (s: string) => { setScheduleSlot(s); setScheduledTime(scheduleDate ? `${scheduleDate}T${s}` : ''); };

  const closePayment = () => {
    if (submittingRef.current) return;
    setShowPayment(false);
    if (status && !status.startsWith('Ride request sent')) setStatus('');
  };

  const applyAiRecommendation = () => {
    if (!aiAssessment) return;
    setPrivateScope(aiAssessment.recommendedScope); setTripType(aiAssessment.recommendedTripType);
    if (aiAssessment.recommendedTripType === 'hourly') setHours(1);
    if (aiAssessment.recommendedTripType === 'full_day') setHours(12);
    if (aiAssessment.recommendedTripType === 'multi_day') setHours(24);
    setAiApplied(true);
  };

  const savePlace = async () => {
    if (!savePlaceLabel.trim() || !pickup.trim()) return;
    await addPlace(savePlaceLabel.trim(), pickup.trim(), savePlaceType, landmark, pickupNote);
    setSavePlaceLabel(''); setShowSavePlace(false);
  };

  const submit = async () => {
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setStatus('Sending request...');
    const finalVehicle = isMoto ? 'Moto' : isDelivery ? (deliveryVehicle === 'moto' ? 'Moto' : 'Car') : vehicle;
    const finalDestination = destinationDisabled ? 'Driver at your disposal' : isAirport && airportDirection === 'pickup' && selectedAirport ? selectedAirport.name : destination;
    const finalPickup = isAirport && airportDirection === 'dropoff' && selectedAirport ? selectedAirport.name : pickup;
    if (isDaily) {
      if (!selectedQuote) { setStatus('Please choose a ride'); submittingRef.current = false; return; }
      const { data, error } = await supabase.rpc('book_ride_from_quote', {
        p_quote_id: selectedQuote.quote_id,
        p_pickup: finalPickup,
        p_destination: finalDestination,
        p_payment_method: payment,
        p_passenger_count: passengers,
        p_scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
        p_pickup_landmark: landmark.trim() || null,
        p_pickup_note: pickupNote.trim() || null,
        p_cash_change_for: isCash && cashChangeFor ? parseInt(cashChangeFor, 10) : null,
        p_driver_service_option: selectedRideId === 'private_driver' ? driverOption : null,
        p_private_driver_scope: selectedRideId === 'private_driver' ? privateScope : null,
        p_moto_pro: isMotoPro,
      });
      if (error) {
        const m = error.message || '';
        if (m.includes('QUOTE_EXPIRED')) { setStatus(''); setShowPayment(false); fetchQuotes(); }
        else if (m.includes('INSUFFICIENT_WALLET_BALANCE')) { setStatus('Your wallet balance is too low. Top up or pick another payment method.'); }
        else { setStatus(m.includes('QUOTE_ALREADY_USED') ? 'This ride was already booked' : m.includes('TOO_MANY_PASSENGERS') ? 'Too many passengers for this ride' : 'Could not send request'); }
        submittingRef.current = false;
        return;
      }
      void data;
      if (isWallet) await refreshProfile();
      setStatus('Ride request sent! Finding your driver...');
      window.setTimeout(() => onNavigate('journey'), 1200);
      return;
    }
    const { data: inserted, error } = await supabase.from('ride_requests').insert({
      pickup: finalPickup, destination: finalDestination, vehicle_type: finalVehicle, payment_method: payment, fare, status: 'searching', user_id: user?.id, service_type: dbServiceType,
      payment_status: isCash ? 'pay_on_arrival' : 'pending',
      booking_mode: isHourly || isFullDay ? 'hourly' : 'single', requested_hours: isHourly || isFullDay ? hours : null, approved_hours: isHourly || isFullDay ? hours : null,
      hourly_rate: isHourly || isFullDay ? hourlyRate : null, passenger_count: passengers, flight_number: isAirport ? flightNumber || null : null,
      scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null, package_description: isDelivery ? packageDesc || null : null,
      driver_service_option: (isPrivateDriver || selectedRideId === 'private_driver') ? driverOption : null, airport_id: isAirport && selectedAirport ? selectedAirport.id : null,
      airport_direction: isAirport ? airportDirection : null, trip_type: isPrivateDriver ? tripType : null, intercity_mode: isPrivateDriverIntercity ? 'private' : null,
      delivery_vehicle: isDelivery ? deliveryVehicle : null, moto_pro: isMotoPro, private_driver_scope: (isPrivateDriver || selectedRideId === 'private_driver') ? privateScope : null,
      pickup_landmark: landmark.trim() || null, pickup_note: pickupNote.trim() || null,
      cash_change_for: isCash && cashChangeFor ? parseInt(cashChangeFor, 10) : null,
    }).select('id').maybeSingle();
    if (error || !inserted) { setStatus('Could not send request'); submittingRef.current = false; return; }
    if (isWallet) {
      const { error: payError } = await supabase.rpc('wallet_pay', { p_amount: fare, p_description: `Ride: ${finalPickup} → ${finalDestination}` });
      if (payError) {
        const short = /insufficient/i.test(payError.message || '');
        setStatus(short ? 'Your wallet balance is too low. Top up or pick another payment method.' : 'Could not charge your wallet');
        submittingRef.current = false;
        return;
      }
      await supabase.from('ride_requests').update({ payment_status: 'paid' }).eq('id', inserted.id);
      await refreshProfile();
    }
    setStatus('Ride request sent! Finding your driver...');
    window.setTimeout(() => onNavigate('journey'), 1200);
  };

  const paymentOptions = useMemo(() => Array.from(new Set([...country.payment_methods, 'Njanga Wallet'])), [country]);
  const isCash = /cash/i.test(payment);
  const isWallet = /wallet/i.test(payment);
  const walletBalance = profile?.wallet_balance ?? 0;
  const walletShort = isWallet && walletBalance < fare;

  const routeReady = isAirport
    ? Boolean(selectedAirport && airportDirection && (airportDirection === 'pickup' ? destination.trim() : pickup.trim()))
    : Boolean(pickup.trim() && (destination.trim() || destinationDisabled));
  const rideReady = isPrivateDriver ? Boolean(tripType) : isMotoPro ? helmetConfirmed : true;
  const privateVehicleReady = !(isDaily && selectedRideId === 'private_driver') || Boolean(driverOption);
  const scheduleReady = !scheduled || Boolean(scheduledTime);
  const rideStepDone = rideReady && (!isDaily || (rideChosen && Boolean(selectedQuote))) && privateVehicleReady && scheduleReady;
  const paymentReady = Boolean(payment) && !walletShort;

  const stage: 'route' | 'ride' | 'payment' | 'ready' =
    !routeReady ? 'route' : !rideStepDone ? 'ride' : !paymentReady ? 'payment' : 'ready';

  const revealRide = isDaily ? routeReady : true;
  const revealPayment = stage === 'payment' || stage === 'ready';
  const canSubmit = stage === 'ready' && (!isDaily || (Boolean(selectedQuote) && !quotesExpired));
  const canOpenPayment = routeReady && rideStepDone;

  const bookingModes: { key: string; label: string; sub: string; icon: React.ReactNode; tint: string; active: boolean; onClick: () => void }[] = [
    { key: 'ride', label: 'Ride', sub: 'Ride now', icon: <CarFront size={22} />, tint: 'bg-[#0d2f35] text-[#e9f55b]', active: isDaily && !scheduled, onClick: () => { selectCategory('daily'); setScheduled(false); } },
    { key: 'schedule', label: 'Schedule', sub: 'Book for later', icon: <Clock size={22} />, tint: 'bg-[#2c6f9a] text-white', active: isDaily && scheduled, onClick: () => { selectCategory('daily'); setScheduled(true); } },
    { key: 'airport', label: 'Airport / Intercity', sub: 'Airport & long distance', icon: <Plane size={22} />, tint: 'bg-[#0d7770] text-white', active: isAirport, onClick: () => { selectCategory('airport'); setScheduled(false); } },
    { key: 'delivery', label: 'Delivery', sub: 'Send a package', icon: <Package size={22} />, tint: 'bg-[#be653e] text-white', active: isDelivery, onClick: () => { selectCategory('travel_delivery'); setScheduled(false); } },
    { key: 'coride', label: 'Co-Ride', sub: 'Share a ride', icon: <Users size={22} />, tint: 'bg-[#526213] text-[#e9f55b]', active: false, onClick: () => onNavigate('coride') },
  ];
  const blockingReason =
    isDaily && quotesExpired ? 'Your fare has expired. Refresh to continue'
    : isDaily && quotesError ? quotesError
    : stage === 'route' ? 'Enter your pickup and destination to continue'
    : stage === 'ride' ? (isDaily && quotesLoading ? 'Getting live fares...' : scheduled && !scheduledTime ? 'Choose a pickup date and time slot to continue' : isMotoPro && !helmetConfirmed ? 'Confirm the helmet requirement to continue' : isAirport ? 'Select your airport and trip details to continue' : isPrivateDriver && !tripType ? 'Choose a trip type to continue' : 'Choose your ride to continue')
    : stage === 'payment' ? (walletShort ? 'Top up your wallet or pick another payment method' : 'Choose how you want to pay')
    : '';

  const rawSteps = [
    { label: 'Route', done: routeReady },
    { label: 'Ride', done: routeReady && rideStepDone },
    { label: 'Payment', done: revealPayment && paymentReady },
    { label: 'Confirm', done: false },
  ];
  const firstIncomplete = rawSteps.findIndex((s) => !s.done);
  const flowSteps = rawSteps.map((s, i) => ({ ...s, current: i === firstIncomplete }));
  const vehicleLabel = isDelivery ? (deliveryVehicle === 'moto' ? 'Moto delivery' : 'Car delivery') : isDaily ? (selectedEligible ? (isMotoPro ? 'Moto Pro' : selectedEligible.label) : 'Select a ride') : vehicle;
  const routeLabel = isAirport && selectedAirport ? `${airportDirection === 'dropoff' ? pickup : selectedAirport.name} → ${airportDirection === 'dropoff' ? selectedAirport.name : destination}` : `${pickup || 'Pickup'} → ${destination || (destinationDisabled ? 'Driver at disposal' : 'Destination')}`;

  return (
    <>
      <button onClick={() => onNavigate('home')} className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-[#e1e9e9] px-3 py-2 text-xs font-semibold text-[#45656a] transition hover:border-[#9fbdbc] hover:bg-[#fafcfc]"><ArrowLeft size={14} /> Back to home</button>
      <PageHeader title="Book a ride" subtitle="Tell us where you are going. We will find the right way to get you there." />

      <div className="mb-5 flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
        {flowSteps.map((s, i) => (
          <div key={s.label} className="flex shrink-0 items-center gap-1">
            <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${s.done ? 'bg-[#0d7770] text-white' : s.current ? 'bg-[#0d2f35] text-white' : 'bg-[#eef3f2] text-[#8ba0a2]'}`}>
              {s.done ? <Check size={12} strokeWidth={3} /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[9px]">{i + 1}</span>}
              {s.label}
            </span>
            {i < flowSteps.length - 1 && <span className={`h-px w-4 shrink-0 ${s.done ? 'bg-[#0d7770]' : 'bg-[#dce7e6]'}`} />}
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="order-1 space-y-4">
          <div className="xl:sticky xl:top-24">
            <BookingMap pickup={pickup} destination={destination} stage={stage} distanceKm={routeInfo?.estimatedDistanceKm} durationMin={routeInfo?.estimatedDurationMin} detecting={detecting} onUseCurrentLocation={detectLocation} />
          </div>
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9aabad]">Choose a service</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {bookingModes.map((m) => (
                <button key={m.key} onClick={m.onClick} className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${m.active ? 'border-[#0d2f35] shadow-[0_6px_20px_rgba(13,47,53,0.12)]' : 'border-[#e1e9e9] hover:border-[#9fbdbc]'}`}>
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${m.tint}`}>{m.icon}</div>
                  <div>
                    <p className="text-sm font-semibold text-[#0d2f35]">{m.label}</p>
                    <p className="text-[11px] text-[#8ba0a2]">{m.sub}</p>
                  </div>
                  {m.active && <span className="flex items-center gap-1 text-[10px] font-semibold text-[#0d7770]"><Check size={11} strokeWidth={3} /> Selected</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="order-2 space-y-5">
          {/* Step 1: route first */}
          <Card className="overflow-visible p-5 sm:p-6">
            <SectionHeader step={1} title="Where are you going?" icon={<Map size={16} />} />
            <div className="space-y-3">
              <LocationAutocomplete label="PICKUP LOCATION" value={pickup} onChange={setPickup} icon="pickup" placeholder="Carrefour, market, station or landmark" showGeolocate onGeolocate={detectLocation} detecting={detecting} excludeValue={destination} />
              <LocationAutocomplete label="DESTINATION" value={destination} onChange={setDestination} icon="destination" placeholder="Where should we take you?" excludeValue={pickup} />
              {scheduled && (
                <div className="space-y-3 rounded-xl border border-[#e8efee] bg-[#f7faf9] p-3.5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[#0d7770]"><CalendarDays size={14} /> When should we pick you up?</div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aabad]">Date</span>
                    <input type="date" value={scheduleDate} min={todayStr} onChange={(e) => pickDate(e.target.value)} className="w-full rounded-lg border border-[#dce7e6] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#0d8179]" />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#9aabad]">Time slot</span>
                    <div className="relative">
                      <Clock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aabad]" />
                      <select value={scheduleSlot} onChange={(e) => pickSlot(e.target.value)} className="w-full appearance-none rounded-lg border border-[#dce7e6] bg-white py-2.5 pl-9 pr-9 text-sm font-semibold text-[#0d2f35] outline-none transition focus:border-[#0d8179]">
                        <option value="">Select a pickup time</option>
                        {TIME_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>{slot}</option>
                        ))}
                      </select>
                      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9aabad]" />
                    </div>
                  </div>
                  {scheduleDate && scheduleSlot && <p className="text-[10px] font-semibold text-[#5a8a84]">Pickup set for {new Date(`${scheduleDate}T${scheduleSlot}`).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
                </div>
              )}
            </div>
            {!isAirport && (
              <div className="mt-3">
                {!showLandmark && !landmark && !pickupNote ? (
                  <button onClick={() => setShowLandmark(true)} className="flex items-center gap-1.5 text-xs font-semibold text-[#0d7770] hover:underline"><MapPin size={13} /> No exact address? Add a landmark</button>
                ) : (
                  <div className="space-y-2.5 rounded-xl border border-[#e8efee] bg-[#f7faf9] p-3.5">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#0d7770]"><MapPin size={14} /> Help your driver find you</div>
                    <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Nearby landmark (e.g. behind Total Station)" className="w-full rounded-lg border border-[#dce7e6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
                    <textarea value={pickupNote} onChange={(e) => setPickupNote(e.target.value)} rows={2} placeholder="Extra instructions (e.g. yellow gate, beside the pharmacy)" className="w-full rounded-lg border border-[#dce7e6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
                    <p className="text-[10px] text-[#9aabad]">Your driver sees this along with your pickup pin.</p>
                  </div>
                )}
              </div>
            )}
            {places.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9aabad]">Saved spots</p>
                <div className="flex flex-wrap gap-2">
                {places.map((place) => {
                  const usePlace = () => {
                    setPickup(place.address);
                    if (place.landmark || place.note) {
                      setLandmark(place.landmark ?? '');
                      setPickupNote(place.note ?? '');
                      setShowLandmark(true);
                    }
                  };
                  return <button key={place.id} onClick={usePlace} title={place.landmark ? `Landmark: ${place.landmark}` : undefined} className="flex items-center gap-1.5 rounded-lg border border-[#e1e9e9] px-2.5 py-2 text-[11px] font-semibold text-[#45656a] transition hover:border-[#0d8179] hover:bg-[#f0faf7]"><Home size={13} className="text-[#0d7770]" /> {place.label}{place.landmark && <MapPin size={11} className="text-[#9aabad]" />}</button>;
                })}
                </div>
              </div>
            )}
            {pickup && (
              <div className="mt-4">
                {!showSavePlace ? <button onClick={() => setShowSavePlace(true)} className="text-xs font-semibold text-[#0d7770] hover:underline">+ Save this pickup location</button> : (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#f5f8f8] p-3">
                    <input value={savePlaceLabel} onChange={(e) => setSavePlaceLabel(e.target.value)} placeholder="Name this place" className="min-w-[130px] flex-1 rounded-lg border border-[#dce7e6] bg-white px-3 py-2 text-xs outline-none focus:border-[#0d8179]" />
                    <select value={savePlaceType} onChange={(e) => setSavePlaceType(e.target.value as 'home' | 'work' | 'other')} className="rounded-lg border border-[#dce7e6] bg-white px-2 py-2 text-xs"><option value="home">Home</option><option value="work">Work</option><option value="other">Other</option></select>
                    <button onClick={savePlace} className="rounded-lg bg-[#0d7770] px-3 py-2 text-xs font-semibold text-white">Save</button>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Step 2: choose ride */}
          {revealRide && (
          <Card className="p-5 sm:p-6">
            <SectionHeader step={2} title="Choose your ride" icon={<CarFront size={16} />} />
            {isDaily && (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-[#0d2f35] px-4 py-3 text-white">
                  <div className="flex min-w-0 items-center gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1 truncate"><span className="h-2 w-2 shrink-0 rounded-full bg-[#e9f55b]" /><span className="truncate">{pickup || 'Pickup'}</span></span>
                    <ChevronRight size={13} className="shrink-0 text-[#7fa0a2]" />
                    <span className="flex min-w-0 items-center gap-1 truncate"><MapPin size={12} className="shrink-0 text-[#ef754d]" /><span className="truncate">{destination || 'Destination'}</span></span>
                  </div>
                  {routeInfo && <span className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold">~{routeInfo.estimatedDistanceKm} km · {routeInfo.estimatedDurationMin} min</span>}
                </div>
                <p className="text-[11px] font-semibold text-[#708b8e]">{eligibleRides.length} ride option{eligibleRides.length === 1 ? '' : 's'} available for this route</p>
                {journeyInsights && <JourneyInsightsPanel insights={journeyInsights} audience="customer" />}
                {quotesError && (
                  <div className="flex items-center justify-between rounded-xl border border-[#f0c8bd] bg-[#fdeeea] px-3.5 py-2.5 text-[11px] text-[#c9483a]"><span>{quotesError}</span><button onClick={fetchQuotes} className="rounded-lg bg-[#0d2f35] px-2.5 py-1 text-[10px] font-semibold text-white">Retry</button></div>
                )}
                {!quotesError && quotesExpiresAt && (quotesExpired
                  ? <div className="flex items-center justify-between rounded-xl border border-[#f0d8a8] bg-[#fdf6e8] px-3.5 py-2.5 text-[11px] text-[#8a6d1f]"><span>Your fares have expired.</span><button onClick={fetchQuotes} className="rounded-lg bg-[#0d2f35] px-2.5 py-1 text-[10px] font-semibold text-white">Refresh fares</button></div>
                  : <p className="text-[10px] text-[#9aabad]">Live fares from Njanga · valid for {Math.max(0, Math.ceil((quotesExpiresAt - nowTick) / 1000))}s</p>)}
                <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1 no-scrollbar">
                {eligibleRides.map((option) => {
                  const active = selectedRideId === option.id;
                  const Icon = RIDE_ICONS[option.iconName];
                  const q = quotes[option.serviceType];
                  const priced = Boolean(q);
                  return <button key={option.id} onClick={() => selectRide(option)} disabled={!priced} className={`relative flex w-full items-center gap-3.5 rounded-2xl border-2 p-4 text-left transition ${active ? 'border-[#0d8179] bg-[#f0faf7] shadow-[0_6px_20px_rgba(13,119,112,0.12)]' : 'border-[#e1e9e9] hover:border-[#9fbdbc] hover:bg-[#fafcfc]'} ${!priced ? 'cursor-not-allowed opacity-60' : ''}`}>
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-[#0d7770] text-white' : 'bg-[#f0f4f4] text-[#0d7770]'}`}><Icon size={21} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="text-sm font-semibold text-[#0d2f35]">{option.label}</p>{option.badge && <span className="rounded-full bg-[#fff0e5] px-2 py-0.5 text-[9px] font-bold text-[#be653e]">{option.badge}</span>}</div>
                      <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{option.description}</p>
                      <div className="mt-1.5 flex items-center gap-2.5 text-[10px] font-semibold">
                        <span className="flex items-center gap-1 text-[#5a9a72]"><span className="h-1.5 w-1.5 rounded-full bg-[#5fd08a]" /> {option.etaText}</span>
                        <span className="flex items-center gap-1 text-[#708b8e]"><Users size={11} /> {option.capacity} {option.capacity === 1 ? 'seat' : 'seats'}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-right">{priced ? <><strong className="block text-lg font-bold leading-none text-[#0d2f35]">{formatCurrency(q.total)}</strong><small className="text-[10px] text-[#9aabad]">total fare</small></> : <span className="text-[11px] text-[#9aabad]">{quotesLoading ? 'Getting fare...' : '—'}</span>}</span>
                    {active && <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#0d7770] text-white"><Check size={12} strokeWidth={3} /></span>}
                  </button>;
                })}
                </div>
                {selectedRideId === 'private_driver' && (
                  <div className="rounded-xl border border-[#e1e9e9] bg-[#f7faf9] p-3.5">
                    <p className="mb-2 text-xs font-semibold text-[#0d2f35]">Professional driver for your trip</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setDriverOption('driver_and_vehicle')} className={`rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition ${driverOption === 'driver_and_vehicle' ? 'border-[#0d8179] bg-[#f0faf7] text-[#0d7770]' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}><CarFront size={15} className="mb-1 block" />Njanga vehicle</button>
                      <button onClick={() => setDriverOption('driver_only')} className={`rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition ${driverOption === 'driver_only' ? 'border-[#0d8179] bg-[#f0faf7] text-[#0d7770]' : 'border-[#e1e9e9] text-[#759092] hover:border-[#9fbdbc]'}`}><UserRound size={15} className="mb-1 block" />My vehicle</button>
                    </div>
                    <p className="mt-2 text-[10px] text-[#9aabad]">{driverOption === 'driver_only' ? 'A professional Njanga driver will drive your own vehicle.' : 'Njanga provides both the professional driver and the vehicle.'}</p>
                  </div>
                )}
                {selectedRideId === 'coride' && (
                  <div className="flex items-start gap-2 rounded-xl border border-[#e6efc9] bg-[#f8fbe9] p-3.5 text-[11px] text-[#526213]"><Users size={14} className="mt-0.5 shrink-0" /><span>You will be matched with compatible passengers heading the same way. The fare is shared, saving you up to 30%.</span></div>
                )}
                {isMoto && <div className="rounded-xl border border-[#e1e9e9] bg-[#fffaf6] px-4 py-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2.5"><Shield size={16} className="text-[#2c6f9a]" /><div><p className="text-xs font-semibold">Moto Pro</p><p className="text-[10px] text-[#8ba0a2]">Verified driver · helmets required for driver and passenger</p></div></div><button onClick={() => { const next = !motoPro; setMotoPro(next); if (!next) setHelmetConfirmed(false); }} className={`relative h-6 w-11 rounded-full ${motoPro ? 'bg-[#2c6f9a]' : 'bg-[#dce7e6]'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${motoPro ? 'left-[22px]' : 'left-0.5'}`} /></button></div>{motoPro && <button onClick={() => setHelmetConfirmed(!helmetConfirmed)} className="mt-3 flex w-full items-center gap-2.5 rounded-lg border border-[#dce7e6] bg-white px-3 py-2.5 text-left"><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${helmetConfirmed ? 'border-[#2c6f9a] bg-[#2c6f9a]' : 'border-[#9aabad]'}`}>{helmetConfirmed && <Check size={11} className="text-white" strokeWidth={3} />}</span><span className="text-[11px] font-medium text-[#45656a]">I understand the driver will provide a helmet and I will wear one for the whole trip.</span></button>}</div>}
                <div className="flex items-center gap-3 pt-2"><span className="text-[11px] font-semibold text-[#708b8e]">PASSENGERS</span><button onClick={() => setPassengers(Math.max(1, passengers - 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#dce7e6] disabled:opacity-40" disabled={passengers <= 1}>−</button><span className="min-w-[20px] text-center text-sm font-semibold">{passengers}</span><button onClick={() => setPassengers(Math.min(maxPassengers, passengers + 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#dce7e6] disabled:opacity-40" disabled={passengers >= maxPassengers}>+</button><span className="text-[10px] text-[#9aabad]">{isMoto ? 'Moto carries 1 passenger only' : selectedRideId === 'coride' ? 'Co-Ride seats up to 2' : 'Up to 4 · fare adjusts to distance'}</span></div>
              </div>
            )}
            {isPrivateDriver && <div className="space-y-4">{aiAssessment && <AiJourneyPanel assessment={aiAssessment} onApply={applyAiRecommendation} formatCurrency={formatCurrency} />}<div className="flex gap-2"><button onClick={() => setDriverOption('driver_and_vehicle')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${driverOption === 'driver_and_vehicle' ? 'bg-[#f0e7f5] text-[#7a3d9a]' : 'bg-[#f5f8f8] text-[#759092]'}`}><CarFront size={14} className="mr-1 inline" />Driver + vehicle</button><button onClick={() => setDriverOption('driver_only')} className={`rounded-lg px-3 py-2 text-xs font-semibold ${driverOption === 'driver_only' ? 'bg-[#f0e7f5] text-[#7a3d9a]' : 'bg-[#f5f8f8] text-[#759092]'}`}><UserRound size={14} className="mr-1 inline" />Driver only</button></div><div className="flex flex-wrap gap-2">{(isPrivateDriverCity ? CITY_TRIP_TYPES : INTERCITY_TRIP_TYPES).map((tt) => <button key={tt.id} onClick={() => { setTripType(tt.id); if (tt.id === 'hourly') setHours(1); if (tt.id === 'full_day') setHours(12); if (tt.id === 'multi_day') setHours(24); }} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${tripType === tt.id ? 'border-[#7a3d9a] bg-[#f0e7f5] text-[#7a3d9a]' : 'border-[#e1e9e9] text-[#759092]'}`}>{tt.icon}{tt.label}</button>)}</div></div>}
            {isAirport && <div className="space-y-3">{!airportDirection ? <div className="grid grid-cols-2 gap-3"><button onClick={() => setAirportDirection('pickup')} className="rounded-xl border-2 border-[#e1e9e9] p-4 text-center hover:border-[#2c6f9a]"><PlaneLanding size={25} className="mx-auto mb-2 text-[#2c6f9a]" /><p className="text-xs font-semibold">Pickup from airport</p></button><button onClick={() => setAirportDirection('dropoff')} className="rounded-xl border-2 border-[#e1e9e9] p-4 text-center hover:border-[#2c6f9a]"><PlaneTakeoff size={25} className="mx-auto mb-2 text-[#2c6f9a]" /><p className="text-xs font-semibold">Dropoff at airport</p></button></div> : !selectedAirport ? <><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aabad]" /><input value={airportSearch} onChange={(e) => setAirportSearch(e.target.value)} placeholder="Search airport" className="w-full rounded-xl border border-[#dce7e6] py-3 pl-9 text-sm outline-none focus:border-[#0d8179]" /></div>{airportsLoading ? <Spinner /> : <div className="max-h-48 space-y-2 overflow-y-auto">{sortedAirports.map((airport) => <button key={airport.id} onClick={() => setSelectedAirport(airport)} className="flex w-full items-center gap-3 rounded-xl border border-[#e1e9e9] p-3 text-left hover:border-[#0d8179]"><Plane size={17} className="text-[#2c6f9a]" /><div><p className="text-xs font-semibold">{airport.name}</p><p className="text-[10px] text-[#9aabad]">{airport.city} · {airport.iata_code}</p></div></button>)}</div>}</> : <div className="rounded-xl bg-[#e7f0f5] p-3 text-xs font-semibold text-[#2c6f9a]"><Plane size={15} className="mr-2 inline" />{selectedAirport.name} · {selectedAirport.iata_code}</div>}</div>}
            {isDelivery && <div className="space-y-3"><textarea value={packageDesc} onChange={(e) => setPackageDesc(e.target.value)} placeholder="What are you sending? Size, weight, contents..." rows={2} className="w-full rounded-xl border border-[#dce7e6] p-3 text-sm outline-none focus:border-[#0d8179]" /><div className="grid grid-cols-2 gap-2"><button onClick={() => setDeliveryVehicle('moto')} className={`rounded-xl border p-3 text-left ${deliveryVehicle === 'moto' ? 'border-[#0d8179] bg-[#e7f4f0]' : 'border-[#e1e9e9]'}`}><Bike size={18} className="text-[#0d7770]" /><p className="mt-1 text-xs font-semibold">Moto delivery</p><p className="text-[10px] text-[#9aabad]">Small packages</p></button><button onClick={() => setDeliveryVehicle('car')} className={`rounded-xl border p-3 text-left ${deliveryVehicle === 'car' ? 'border-[#0d8179] bg-[#e7f4f0]' : 'border-[#e1e9e9]'}`}><CarFront size={18} className="text-[#0d7770]" /><p className="mt-1 text-xs font-semibold">Car delivery</p><p className="text-[10px] text-[#9aabad]">Larger items</p></button></div></div>}
          </Card>
          )}

          {/* Airport route details */}
          {isAirport && selectedAirport && <Card className="p-5 sm:p-6"><SectionHeader step={3} title="Trip details" icon={<Plane size={16} />} />{airportDirection === 'pickup' ? <LocationAutocomplete label="DESTINATION" value={destination} onChange={setDestination} icon="destination" placeholder="Where are you going?" /> : <LocationAutocomplete label="PICKUP LOCATION" value={pickup} onChange={setPickup} icon="pickup" placeholder="Where should we pick you up?" />}<div className="mt-3 grid gap-3 sm:grid-cols-2"><input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)} placeholder="Flight number (optional)" className="rounded-xl border border-[#dce7e6] p-3 text-sm outline-none focus:border-[#0d8179]" /><input type="datetime-local" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="rounded-xl border border-[#dce7e6] p-3 text-sm outline-none focus:border-[#0d8179]" /></div></Card>}

          {/* Review & confirm */}
          {revealPayment && (
          <Card className="p-5 sm:p-6">
            <SectionHeader step={isAirport && selectedAirport ? 4 : 3} title="Review & confirm" icon={<CheckCircle2 size={16} />} />
            <div className="space-y-2.5">
              <SummaryRow label="Route" value={routeLabel} />
              {landmark.trim() && <SummaryRow label="Landmark" value={landmark.trim()} />}
              {pickupNote.trim() && <SummaryRow label="Instructions" value={pickupNote.trim()} />}
              <SummaryRow label="Ride" value={vehicleLabel} />
              {scheduled && scheduledTime && <SummaryRow label="Pickup time" value={new Date(scheduledTime).toLocaleString()} />}
              {!isDelivery && <SummaryRow label="Passengers" value={String(passengers)} />}
              <div className="mt-1 space-y-2 rounded-xl bg-[#f7f9f8] p-3.5">
                {isDaily
                  ? <div className="flex items-center justify-between text-[11px] text-[#708b8e]"><span>Distance & time</span><span className="font-semibold text-[#45656a]">~{routeInfo?.estimatedDistanceKm ?? '—'} km · {routeInfo?.estimatedDurationMin ?? '—'} min</span></div>
                  : <><div className="flex items-center justify-between text-[11px] text-[#708b8e]"><span>Base fare</span><span className="font-semibold text-[#45656a]">{formatCurrency(baseFare)}</span></div><div className="flex items-center justify-between text-[11px] text-[#708b8e]"><span>Distance & time</span><span className="font-semibold text-[#45656a]">Included</span></div></>}
                {discount > 0 && <div className="flex items-center justify-between text-[11px] text-[#526213]"><span>Duration discount</span><span className="font-semibold">−{discount}%</span></div>}
                <div className="flex items-center justify-between border-t border-[#e6ecec] pt-2"><span className="text-xs font-semibold text-[#0d2f35]">Total {isDaily ? 'fixed fare' : 'estimate'}</span><span className="font-display text-lg font-semibold text-[#0d2f35]">{formatCurrency(fare)}</span></div>
              </div>
            </div>
            <button onClick={() => setShowPayment(true)} disabled={!canOpenPayment} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">
              <Smartphone size={16} /> Choose payment · {formatCurrency(fare)}
            </button>
            <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-[#8ba0a2]"><ShieldCheck size={13} className="text-[#0d8179]" /> Protected with Njanga Safety · Driver PIN verified before your trip starts</div>
          </Card>
          )}

          {!routeReady && (
            <div className="rounded-2xl border border-dashed border-[#d6e2e0] bg-[#f7faf9] p-5 text-center">
              <p className="text-sm font-semibold text-[#45656a]">Enter your pickup and destination</p>
              <p className="mt-1 text-xs text-[#8ba0a2]">The next steps unlock once we know where you are heading.</p>
            </div>
          )}
          {routeReady && !revealPayment && (
            <div className="rounded-2xl border border-dashed border-[#d6e2e0] bg-[#f7faf9] p-5 text-center">
              <p className="text-sm font-semibold text-[#45656a]">Choose your ride to continue</p>
              <p className="mt-1 text-xs text-[#8ba0a2]">Pick an option above and payment will appear next.</p>
            </div>
          )}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dfe9e7] bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(13,47,53,0.10)] backdrop-blur-md safe-bottom xl:hidden"><div className="mx-auto flex max-w-lg items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#9aabad]">{vehicleLabel}</p><p className="font-display text-xl font-semibold text-[#0d2f35]">{formatCurrency(fare)}</p></div><button onClick={() => setShowPayment(true)} disabled={!!status || !canOpenPayment} className="flex-1 rounded-xl bg-[#0d2f35] py-3 text-sm font-semibold text-white disabled:opacity-60">{status || 'Choose payment'}</button></div></div><div className="h-20 xl:hidden" />
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0d2f35]/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={closePayment}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-[#eef2f1] px-5 py-4">
              <div className="flex items-center gap-2.5"><span className="text-[#0d7770]"><Smartphone size={18} /></span><h3 className="text-base font-semibold text-[#0d2f35]">How would you like to pay?</h3></div>
              <button onClick={closePayment} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aabad] transition hover:bg-[#f0f4f4]"><X size={18} /></button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
              <div className="mb-4 flex items-center justify-between rounded-xl border border-[#dbeeea] bg-[#f0faf7] px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5a8a84]">Total to pay</span>
                <span className="text-lg font-bold text-[#0d2f35]">{formatCurrency(fare)}</span>
              </div>
              <div className="space-y-2">
                {paymentOptions.map((method) => {
                  const selected = payment === method;
                  return (
                    <button key={method} onClick={() => setPayment(method)} className={`flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition ${selected ? 'border-[#0d8179] bg-[#f0faf7] shadow-[0_4px_14px_rgba(13,119,112,0.1)]' : 'border-[#e1e9e9] hover:border-[#9fbdbc] hover:bg-[#fafcfc]'}`}>
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-white' : 'bg-[#f5f8f8]'}`}><span className={`h-3 w-3 rounded-full ${paymentDotColor(method)}`} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#0d2f35]">{method}</p>
                        <p className="text-[10px] text-[#9aabad]">{paymentHint(method)}</p>
                      </div>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-[#0d7770] bg-[#0d7770]' : 'border-[#cdd9d8]'}`}>{selected && <Check size={12} className="text-white" strokeWidth={3} />}</span>
                    </button>
                  );
                })}
              </div>
              {isCash && (
                <div className="mt-3 rounded-xl border border-[#e8efee] bg-[#f7faf9] p-3.5">
                  <p className="text-[11px] font-semibold text-[#0d7770]">Need change?</p>
                  <p className="mt-0.5 text-[10px] text-[#8ba0a2]">Tell your driver which note you'll pay with so they bring the right change.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[1000, 2000, 5000, 10000].map((n) => (
                      <button key={n} onClick={() => setCashChangeFor(cashChangeFor === String(n) ? '' : String(n))} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${cashChangeFor === String(n) ? 'border-[#0d8179] bg-[#f0faf7] text-[#0d2f35]' : 'border-[#dce7e6] text-[#45656a] hover:border-[#9fbdbc]'}`}>{formatCurrency(n)}</button>
                    ))}
                  </div>
                </div>
              )}
              {isWallet && (
                <div className={`mt-3 flex items-center justify-between rounded-xl border p-3.5 ${walletShort ? 'border-[#f0c8bd] bg-[#fdeeea]' : 'border-[#e8efee] bg-[#f0faf7]'}`}>
                  <div>
                    <p className="text-[11px] font-semibold text-[#0d2f35]">Njanga Wallet balance</p>
                    <p className="text-sm font-semibold text-[#0d7770]">{formatCurrency(walletBalance)}</p>
                  </div>
                  {walletShort
                    ? <button onClick={() => onNavigate('wallet')} className="rounded-lg bg-[#0d2f35] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#174850]">Top up</button>
                    : <span className="flex items-center gap-1 text-[10px] font-semibold text-[#3f8f5f]"><CheckCircle2 size={13} /> Covers this ride</span>}
                </div>
              )}
              {walletShort && <p className="mt-1.5 text-[11px] text-[#c9483a]">Your balance is too low for this ride. Add money to pay with your wallet.</p>}
            </div>
            <div className="border-t border-[#eef2f1] px-5 py-4">
              <button onClick={submit} disabled={!!status || !canSubmit} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">
                {status ? <><Loader2 size={16} className="animate-spin" /> {status}</> : <>Confirm ride · {formatCurrency(fare)}</>}
              </button>
              {!canSubmit && !status && <p className="mt-2 text-center text-[11px] text-[#be653e]">{blockingReason}</p>}
              <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-[#8ba0a2]"><ShieldCheck size={13} className="text-[#0d8179]" /> Protected with Njanga Safety · Driver PIN verified before your trip starts</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SectionHeader({ step, title, icon }: { step: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0d2f35] text-[11px] font-bold text-white">{step}</span>
      <span className="text-[#0d7770]">{icon}</span>
      <h3 className="text-sm font-semibold text-[#0d2f35]">{title}</h3>
    </div>
  );
}

function SummaryRow({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] font-medium text-[#9aabad]">{label}</span>
      <span className={`max-w-[60%] truncate text-right text-xs font-semibold text-[#0d2f35] ${valueClass}`}>{value}</span>
    </div>
  );
}

export function FindCoRides() {
  const { user } = useAuth();
  const { country, formatCurrency } = useCountry();
  const [allCorides, setAllCorides] = useState<CoRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  const [payment, setPayment] = useState('MTN MoMo');
  const [msg, setMsg] = useState('');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    supabase.from('corides').select('*').eq('status', 'open').order('departure_time').then(({ data }) => {
      setAllCorides((data as CoRide[]) ?? []);
      setLoading(false);
    });
  }, []);

  const matches: CoRideMatch[] = useMemo(() => {
    if (!searched) return [];
    return matchCoRides(pickup, destination, allCorides);
  }, [searched, pickup, destination, allCorides]);

  const handleSearch = () => {
    if (!pickup.trim() && !destination.trim()) return;
    setSearched(true);
  };

  const resetSearch = () => {
    setSearched(false);
    setPickup('');
    setDestination('');
  };

  const book = async (coride: CoRide) => {
    setMsg('');
    const { error } = await supabase.from('coride_bookings').insert({
      coride_id: coride.id, passenger_id: user?.id, passenger_name: user?.email ?? 'Passenger', seats_booked: seats, payment_method: payment, status: 'confirmed',
    });
    if (error) { setMsg('Booking failed'); return; }
    await supabase.from('corides').update({ available_seats: Math.max(0, coride.available_seats - seats) }).eq('id', coride.id);
    if (coride.available_seats - seats <= 0) await supabase.from('corides').update({ status: 'full' }).eq('id', coride.id);
    setMsg('Seat reserved!');
    setBookingId(null);
    setAllCorides((prev) => prev.map((c) => c.id === coride.id ? { ...c, available_seats: Math.max(0, c.available_seats - seats) } : c).filter((c) => c.available_seats > 0 && c.status === 'open'));
  };

  if (loading) return <Spinner />;
  return (
    <>
      <PageHeader title="Find a co-ride" subtitle="Enter your route — AI matches you with private vehicles going your way." />
      <Card className="mb-5 p-5">
        <div className="space-y-3">
          <LocationAutocomplete
            label="YOUR PICKUP"
            value={pickup}
            onChange={(v) => { setPickup(v); setSearched(false); }}
            icon="pickup"
            placeholder="e.g. Bastos, Yaoundé"
          />
          <LocationAutocomplete
            label="YOUR DESTINATION"
            value={destination}
            onChange={(v) => { setDestination(v); setSearched(false); }}
            icon="destination"
            placeholder="e.g. Akwa, Douala"
          />
          <div className="flex gap-2">
            <button onClick={handleSearch} disabled={!pickup.trim() && !destination.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">
              <Search size={16} /> Find matching co-rides
            </button>
            {searched && (
              <button onClick={resetSearch} className="rounded-xl border border-[#dce7e6] px-4 py-3 text-sm font-semibold text-[#759092] transition hover:bg-[#f5f8f8]">Reset</button>
            )}
          </div>
        </div>
      </Card>

      {!searched ? (
        <Card>
          <EmptyState icon={<Search size={24} />} title="Enter your route to find co-rides" subtitle="AI will match you with private vehicles traveling along your route." />
        </Card>
      ) : matches.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={24} />} title="No matching co-rides found" subtitle="No private vehicles match your route right now. Try broadening your search or check back later." />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#e7f4f0] px-4 py-3 text-xs font-semibold text-[#0d7770]">
            <Sparkles size={15} />
            AI found {matches.length} co-ride{matches.length > 1 ? 's' : ''} matching your route
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {matches.map((match) => {
              const cr = match.coride;
              return (
                <Card key={cr.id} className="p-5">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{cr.pickup} → {cr.destination}</p>
                      <p className="mt-1 text-xs text-[#8ba0a2]">by {cr.owner_name} · {cr.vehicle_info}</p>
                    </div>
                    <span className="rounded-lg bg-[#e7f4f0] px-2 py-1 text-[10px] font-semibold text-[#0d7770]">{cr.available_seats} seats left</span>
                  </div>
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#f5f8f8] px-3 py-2 text-[10px] font-medium text-[#0d7770]">
                    <Sparkles size={12} className="shrink-0" />
                    {match.reason}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#759092]">
                    <span className="flex items-center gap-1"><Clock3 size={13} /> {timeUntil(cr.departure_time)}</span>
                    <span className="flex items-center gap-1"><Users size={13} /> {cr.total_seats} total</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-[#edf1f1] pt-4">
                    <span className="font-display text-lg font-semibold">{formatCurrency(cr.price_per_seat)}<span className="text-[11px] font-normal text-[#9aabad]"> /seat</span></span>
                    {bookingId === cr.id ? (
                      <div className="flex items-center gap-2">
                        <select value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="rounded-lg border border-[#dce7e6] px-2 py-1.5 text-xs outline-none">
                          {Array.from({ length: cr.available_seats }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                        </select>
                        <select value={payment} onChange={(e) => setPayment(e.target.value)} className="rounded-lg border border-[#dce7e6] px-2 py-1.5 text-xs outline-none">
                          {country.payment_methods.map((m) => <option key={m}>{m}</option>)}
                        </select>
                        <button onClick={() => book(cr)} className="rounded-lg bg-[#0d7770] px-3 py-1.5 text-xs font-semibold text-white">Confirm</button>
                        <button onClick={() => setBookingId(null)} className="text-xs text-[#9aabad]">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setBookingId(cr.id); setSeats(1); setMsg(''); }} className="rounded-lg bg-[#0d2f35] px-4 py-2 text-xs font-semibold text-white">Book seat</button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {msg && <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#0d7770]"><CheckCircle2 size={16} /> {msg}</p>}
    </>
  );
}

export function TripHistory() {
  const { user } = useAuth();
  const { formatCurrency } = useCountry();
  const [trips, setTrips] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('ride_requests').select('*').eq('user_id', user?.id).order('created_at', { ascending: false }).then(({ data }) => {
      setTrips((data as RideRequest[]) ?? []);
      setLoading(false);
    });
  }, [user]);

  return (
    <>
      <PageHeader title="Trip history" subtitle="Your past rides and co-rides." />
      <Card>
        {loading ? <Spinner /> : trips.length === 0 ? (
          <EmptyState icon={<Clock3 size={24} />} title="No trips yet" subtitle="Your ride history will appear here." />
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
                    <p className="mt-0.5 text-[11px] text-[#8ba0a2]">{formatRelative(trip.created_at)} · {trip.payment_method}{trip.driver_name ? ` · ${trip.driver_name}` : ''}</p>
                    {trip.service_type && trip.service_type !== 'standard' && <span className="mt-1 inline-block rounded-md bg-[#f0f4f4] px-1.5 py-0.5 text-[10px] font-semibold capitalize text-[#45656a]">{trip.service_type.replace(/_/g, ' ')}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatCurrency(trip.fare)}</p>
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
