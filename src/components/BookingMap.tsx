import { MapPin, Navigation, LocateFixed, Clock, Route, ShieldCheck, Loader2 } from 'lucide-react';

export type BookingStage = 'route' | 'ride' | 'payment' | 'ready';

const STAGE_LABEL: Record<BookingStage, string> = {
  route: 'Set your pickup and destination',
  ride: 'Choosing your ride',
  payment: 'Choosing how to pay',
  ready: 'Ready to confirm',
};

function seededOffset(text: string, spread: number, base: number): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum + text.charCodeAt(i) * (i + 3)) % 1000;
  return base + (sum / 1000) * spread;
}

function formatDuration(min?: number): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

interface BookingMapProps {
  pickup: string;
  destination: string;
  stage: BookingStage;
  distanceKm?: number;
  durationMin?: number;
  detecting?: boolean;
  onUseCurrentLocation?: () => void;
}

export function BookingMap({ pickup, destination, stage, distanceKm, durationMin, detecting, onUseCurrentLocation }: BookingMapProps) {
  const hasPickup = Boolean(pickup.trim());
  const hasDest = Boolean(destination.trim());

  const px = hasPickup ? seededOffset(pickup, 34, 22) : 28;
  const py = hasPickup ? seededOffset(pickup, 26, 34) : 62;
  const dx = hasDest ? seededOffset(destination, 32, 46) : 74;
  const dy = hasDest ? seededOffset(destination, 28, 20) : 30;
  const mx = (px + dx) / 2 + 6;
  const my = (py + dy) / 2 - 10;

  const duration = formatDuration(durationMin);

  return (
    <div className="relative h-[320px] overflow-hidden rounded-2xl border border-[#dce7e6] bg-[#eaf2f0] shadow-sm xl:h-[560px]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="njmap" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eef5f3" />
            <stop offset="100%" stopColor="#dfeeeb" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#njmap)" />
        {[14, 30, 46, 62, 78, 94].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke="#cde0dc" strokeWidth="0.6" />
        ))}
        {[12, 28, 44, 60, 76, 92].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="#cde0dc" strokeWidth="0.6" />
        ))}
        <path d="M0 70 L38 66 L60 40 L100 34" fill="none" stroke="#c3dad5" strokeWidth="2.4" />
        <path d="M20 0 L26 44 L52 62 L58 100" fill="none" stroke="#c3dad5" strokeWidth="2.4" />
        <circle cx="80" cy="82" r="10" fill="#d7e8e3" />
        <circle cx="16" cy="18" r="7" fill="#d7e8e3" />

        {hasPickup && hasDest && (
          <path
            d={`M${px} ${py} Q ${mx} ${my} ${dx} ${dy}`}
            fill="none"
            stroke="#0d7770"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray="3 2.4"
          />
        )}
        {hasPickup && (
          <g>
            <circle cx={px} cy={py} r="3.4" fill="#0d7770" opacity="0.25" />
            <circle cx={px} cy={py} r="1.8" fill="#0d7770" stroke="#fff" strokeWidth="0.7" />
          </g>
        )}
        {hasDest && (
          <g>
            <circle cx={dx} cy={dy} r="3.4" fill="#ef754d" opacity="0.25" />
            <circle cx={dx} cy={dy} r="1.8" fill="#ef754d" stroke="#fff" strokeWidth="0.7" />
          </g>
        )}
      </svg>

      {/* Status pill */}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur">
        <span className={`h-2 w-2 rounded-full ${stage === 'ready' ? 'bg-[#3f8f5f]' : 'bg-[#e9a23b]'} ${stage !== 'ready' ? 'animate-pulse' : ''}`} />
        <span className="text-[11px] font-semibold text-[#0d2f35]">{STAGE_LABEL[stage]}</span>
      </div>

      {/* Current location */}
      {onUseCurrentLocation && (
        <button
          onClick={onUseCurrentLocation}
          disabled={detecting}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0d7770] shadow-md transition hover:bg-[#f0faf7] disabled:opacity-60"
          title="Use my current location"
        >
          {detecting ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
        </button>
      )}

      {/* Route summary chips */}
      <div className="absolute inset-x-4 bottom-4 space-y-2">
        <div className="rounded-2xl bg-white/95 p-3.5 shadow-md backdrop-blur">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex flex-col items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-[#0d7770]" />
              <span className="h-5 w-px bg-[#cdd9d8]" />
              <MapPin size={13} className="text-[#ef754d]" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="truncate text-xs font-semibold text-[#0d2f35]">{pickup.trim() || 'Choose your pickup'}</p>
              <div className="h-px bg-[#eef2f1]" />
              <p className="truncate text-xs font-semibold text-[#0d2f35]">{destination.trim() || 'Where are you going?'}</p>
            </div>
          </div>
          {(distanceKm || duration) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#eef2f1] pt-2.5">
              {distanceKm ? <span className="flex items-center gap-1 rounded-lg bg-[#f0f4f4] px-2 py-1 text-[10px] font-semibold text-[#45656a]"><Route size={12} className="text-[#0d7770]" /> ~{distanceKm} km</span> : null}
              {duration ? <span className="flex items-center gap-1 rounded-lg bg-[#f0f4f4] px-2 py-1 text-[10px] font-semibold text-[#45656a]"><Clock size={12} className="text-[#0d7770]" /> ~{duration}</span> : null}
              <span className="flex items-center gap-1 rounded-lg bg-[#f0f4f4] px-2 py-1 text-[10px] font-semibold text-[#45656a]"><Navigation size={12} className="text-[#0d7770]" /> Live route</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-[#4c6b6a]">
          <ShieldCheck size={12} className="text-[#0d8179]" /> Protected with Njanga Safety
        </div>
      </div>
    </div>
  );
}
