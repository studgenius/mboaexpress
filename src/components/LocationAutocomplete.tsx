import { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, LocateFixed, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface CameroonianLocation {
  id: string;
  name: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  category: string;
  is_popular: boolean;
}

interface LocationAutocompleteProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: 'pickup' | 'destination';
  placeholder?: string;
  showGeolocate?: boolean;
  onGeolocate?: () => void;
  detecting?: boolean;
  excludeValue?: string;
}

export function LocationAutocomplete({
  label,
  value,
  onChange,
  icon = 'destination',
  placeholder = 'Search location...',
  showGeolocate = false,
  onGeolocate,
  detecting = false,
  excludeValue,
}: LocationAutocompleteProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [popularLocations, setPopularLocations] = useState<CameroonianLocation[]>([]);
  const [searchResults, setSearchResults] = useState<CameroonianLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from('cameroonian_locations')
      .select('*')
      .eq('is_popular', true)
      .order('city')
      .then(({ data }) => {
        setPopularLocations((data as CameroonianLocation[]) ?? []);
      });
  }, []);

  useEffect(() => {
    if (!value.trim() || value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      supabase
        .from('cameroonian_locations')
        .select('*')
        .or(`name.ilike.%${value.trim()}%,city.ilike.%${value.trim()}%,region.ilike.%${value.trim()}%`)
        .order('is_popular', { ascending: false })
        .limit(10)
        .then(({ data }) => {
          setSearchResults((data as CameroonianLocation[]) ?? []);
          setLoading(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const formatLocation = (loc: CameroonianLocation) => `${loc.name}, ${loc.city}`;

  const excludeNorm = excludeValue?.trim().toLowerCase() ?? '';
  const notExcluded = (loc: CameroonianLocation) => !excludeNorm || formatLocation(loc).toLowerCase() !== excludeNorm;

  const displayResults = value.trim().length >= 2 ? searchResults.filter(notExcluded) : [];
  const filteredPopular = popularLocations.filter(notExcluded);
  const showPopular = value.trim().length < 2 && showSuggestions;

  return (
    <div className="relative" ref={containerRef}>
      <span className="mb-1.5 block text-[11px] font-semibold text-[#708b8e]">{label}</span>
      {icon === 'pickup' ? (
        <Navigation size={16} className="absolute left-3 top-[33px] text-[#0d8179]" />
      ) : (
        <MapPin size={16} className="absolute left-3 top-[33px] text-[#ef754d]" />
      )}
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 pl-10 text-sm outline-none transition focus:border-[#0d8179]"
        style={{ paddingRight: showGeolocate ? 40 : 12 }}
        autoComplete="off"
      />
      {showGeolocate && (
        <button
          onClick={onGeolocate}
          disabled={detecting}
          title="Use my location"
          className="absolute right-3 top-[31px] flex h-7 w-7 items-center justify-center rounded-lg bg-[#e7f4f0] text-[#0d7770] transition hover:bg-[#d4ebe6] disabled:opacity-60"
        >
          {detecting ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
        </button>
      )}
      {value && !showGeolocate && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-[31px] flex h-7 w-7 items-center justify-center rounded-lg text-[#9aabad] transition hover:bg-[#f0f4f4]"
        >
          <X size={14} />
        </button>
      )}
      {showSuggestions && (displayResults.length > 0 || showPopular) && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[#e1e9e9] bg-white shadow-lg">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={18} className="animate-spin text-[#0d7770]" />
            </div>
          )}
          {!loading && displayResults.length > 0 && displayResults.map((loc) => (
            <button
              key={loc.id}
              onMouseDown={() => { onChange(formatLocation(loc)); setShowSuggestions(false); }}
              className="flex w-full items-center gap-2.5 border-b border-[#f0f4f4] px-4 py-3 text-left transition last:border-0 hover:bg-[#f5f8f8]"
            >
              <MapPin size={14} className="shrink-0 text-[#9aabad]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[#0d2f35]">{loc.name}</p>
                <p className="truncate text-[10px] text-[#8ba0a2]">{loc.city}, {loc.region}</p>
              </div>
              {loc.is_popular && <span className="shrink-0 rounded-full bg-[#e7f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#0d7770]">POPULAR</span>}
            </button>
          ))}
          {!loading && showPopular && filteredPopular.length > 0 && (
            <>
              <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#9aabad]">Popular locations</div>
              {filteredPopular.map((loc) => (
                <button
                  key={loc.id}
                  onMouseDown={() => { onChange(formatLocation(loc)); setShowSuggestions(false); }}
                  className="flex w-full items-center gap-2.5 border-b border-[#f0f4f4] px-4 py-3 text-left transition last:border-0 hover:bg-[#f5f8f8]"
                >
                  <MapPin size={14} className="shrink-0 text-[#9aabad]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[#0d2f35]">{loc.name}</p>
                    <p className="truncate text-[10px] text-[#8ba0a2]">{loc.city}, {loc.region}</p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
