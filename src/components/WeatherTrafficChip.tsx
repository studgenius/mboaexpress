import { useState, useEffect, useRef } from 'react';
import { Sun, CloudSun, Cloud, CloudDrizzle, CloudRain, CloudLightning, Gauge, Sparkles, X } from 'lucide-react';
import { useCountry } from '@/lib/country-config';
import { getForecast, type WeatherIcon, type TrafficLevel } from '@/lib/predictions';

const WEATHER_ICONS: Record<WeatherIcon, typeof Sun> = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain,
  'cloud-lightning': CloudLightning,
};

const TRAFFIC_COLOR: Record<TrafficLevel, string> = {
  light: 'text-[#3f8f5f]',
  moderate: 'text-[#c58521]',
  heavy: 'text-[#c9483a]',
};

const TRAFFIC_DOT: Record<TrafficLevel, string> = {
  light: 'bg-[#3f8f5f]',
  moderate: 'bg-[#c58521]',
  heavy: 'bg-[#c9483a]',
};

export function WeatherTrafficChip() {
  const { country } = useCountry();
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const forecast = getForecast(country.name, now);
  const WeatherGlyph = WEATHER_ICONS[forecast.weather.icon];

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        onClick={() => setOpen(!open)}
        title="Njanga AI forecast"
        className="flex items-center gap-3 rounded-xl border border-[#e1e9e9] bg-white/70 py-1.5 pl-2.5 pr-3 transition hover:border-[#c6d6d5] hover:bg-white"
      >
        <span className="flex items-center gap-1.5">
          <WeatherGlyph size={16} className="text-[#2c6f9a]" />
          <span className="text-xs font-semibold text-[#0d2f35]">{forecast.weather.tempC}°</span>
        </span>
        <span className="h-4 w-px bg-[#e1e9e9]" />
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${TRAFFIC_DOT[forecast.traffic.level]}`} />
          <span className={`text-xs font-semibold ${TRAFFIC_COLOR[forecast.traffic.level]}`}>{forecast.traffic.label}</span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[#e1e9e9] bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-[#0d2f35] px-4 py-2.5 text-white">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#e9f55b]"><Sparkles size={13} /> Njanga AI forecast</span>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white"><X size={14} /></button>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eaf2f7] text-[#2c6f9a]"><WeatherGlyph size={20} /></div>
              <div>
                <p className="text-sm font-semibold text-[#0d2f35]">{forecast.weather.label} · {forecast.weather.tempC}°C</p>
                <p className="text-[11px] text-[#8ba0a2]">{country.name} · updated just now</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f3f6f0] text-[#526213]"><Gauge size={20} /></div>
              <div>
                <p className={`text-sm font-semibold ${TRAFFIC_COLOR[forecast.traffic.level]}`}>{forecast.traffic.label}</p>
                <p className="text-[11px] text-[#8ba0a2]">Roughly +{forecast.traffic.delayMin} min on typical routes</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-[#f0faf7] p-3 text-[11px] leading-relaxed text-[#0d5a59]">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-[#0d7770]" />
              <span>{forecast.insight}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
