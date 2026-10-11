export type WeatherIcon = 'sun' | 'cloud-sun' | 'cloud' | 'cloud-drizzle' | 'cloud-rain' | 'cloud-lightning';
export type TrafficLevel = 'light' | 'moderate' | 'heavy';

export interface Forecast {
  weather: { icon: WeatherIcon; label: string; tempC: number };
  traffic: { level: TrafficLevel; label: string; delayMin: number };
  insight: string;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// A lightweight on-device predictor. It blends the current hour, the day and a
// location seed so the same city shows a stable forecast that still shifts
// through the day and across days — no external weather service required.
export function getForecast(seed: string, now: Date = new Date()): Forecast {
  const hour = now.getHours();
  const base = hash(`${seed}|${now.toDateString()}`);
  const roll = (base % 1000) / 1000;

  const rainChance = hour >= 14 && hour <= 19 ? 0.5 : hour >= 5 && hour <= 10 ? 0.18 : 0.32;
  let weather: Forecast['weather'];
  const warmth = 25 + (base % 8);
  if (roll < rainChance * 0.35) {
    weather = { icon: 'cloud-lightning', label: 'Thunderstorms', tempC: warmth - 4 };
  } else if (roll < rainChance * 0.7) {
    weather = { icon: 'cloud-rain', label: 'Heavy rain', tempC: warmth - 3 };
  } else if (roll < rainChance) {
    weather = { icon: 'cloud-drizzle', label: 'Light showers', tempC: warmth - 2 };
  } else if (roll < rainChance + 0.22) {
    weather = { icon: 'cloud', label: 'Cloudy', tempC: warmth - 1 };
  } else if (roll < rainChance + 0.45) {
    weather = { icon: 'cloud-sun', label: 'Partly sunny', tempC: warmth };
  } else {
    weather = { icon: 'sun', label: 'Sunny', tempC: warmth + 1 };
  }

  const isRush = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  const isMidday = hour >= 11 && hour <= 15;
  const isNight = hour >= 22 || hour <= 5;
  const jitter = (base >> 5) % 3;
  let level: TrafficLevel;
  if (isRush) level = jitter === 0 ? 'moderate' : 'heavy';
  else if (isNight) level = 'light';
  else if (isMidday) level = jitter === 2 ? 'heavy' : 'moderate';
  else level = jitter === 0 ? 'light' : 'moderate';

  const wet = weather.icon === 'cloud-rain' || weather.icon === 'cloud-lightning';
  if (wet && level === 'light') level = 'moderate';
  if (wet && level === 'moderate') level = 'heavy';

  const delayMin = level === 'heavy' ? 12 + (base % 10) : level === 'moderate' ? 5 + (base % 6) : 1 + (base % 3);
  const traffic: Forecast['traffic'] = {
    level,
    label: level === 'heavy' ? 'Heavy traffic' : level === 'moderate' ? 'Moderate traffic' : 'Clear roads',
    delayMin,
  };

  const insight = buildInsight(weather, traffic);
  return { weather, traffic, insight };
}

export type VehicleClass = 'moto' | 'car' | 'shared';

export interface JourneyInsights {
  distanceKm: number;
  durationMin: number;
  traffic: { level: TrafficLevel; label: string; delayMin: number };
  route: { name: string; note: string };
  emissions: { grams: number; kg: string; savedPct: number; equivalent: string };
  weather: Forecast['weather'];
  customerTips: string[];
  driverTips: string[];
}

const CITY_ROUTES = [
  { name: 'Main boulevard route', note: 'Straightest path — steady flow outside peak hours' },
  { name: 'Ring-road bypass', note: 'Skips the market junction where traffic backs up' },
  { name: 'Riverside corridor', note: 'Fewer signals and smoother tarmac most of the way' },
  { name: 'Old-town shortcut', note: 'Narrow but quick when the main road is congested' },
];
const INTERCITY_ROUTES = [
  { name: 'National highway', note: 'Best-maintained surface for long stretches' },
  { name: 'Coastal expressway', note: 'Longer but avoids the mountain-pass slowdowns' },
  { name: 'Inland trunk road', note: 'Direct line between the two cities' },
];

// Grams of CO2 per passenger-km by vehicle class (shared splits a car's load).
const CO2_PER_KM: Record<VehicleClass, number> = { moto: 90, car: 165, shared: 82 };

export function estimateDistanceKm(pickup: string, destination: string, isIntercity: boolean): number {
  const base = hash(`${pickup.toLowerCase().trim()}→${destination.toLowerCase().trim()}`);
  if (isIntercity) return 80 + (base % 220);
  return 3 + (base % 17);
}

export function buildJourneyInsights(opts: {
  pickup: string;
  destination: string;
  distanceKm: number;
  durationMin: number;
  isIntercity: boolean;
  vehicle: VehicleClass;
  seed: string;
  now?: Date;
}): JourneyInsights {
  const { pickup, destination, distanceKm, durationMin, isIntercity, vehicle, seed } = opts;
  const now = opts.now ?? new Date();
  const forecast = getForecast(seed, now);
  const routeSeed = hash(`${pickup}|${destination}|${seed}`);
  const pool = isIntercity ? INTERCITY_ROUTES : CITY_ROUTES;
  const route = pool[routeSeed % pool.length];

  const grams = Math.round(distanceKm * CO2_PER_KM[vehicle]);
  const carGrams = distanceKm * CO2_PER_KM.car;
  const savedPct = vehicle === 'car' ? 0 : Math.max(0, Math.round((1 - CO2_PER_KM[vehicle] / CO2_PER_KM.car) * 100));
  const kg = (grams / 1000).toFixed(grams >= 1000 ? 1 : 2);
  const trees = Math.max(1, Math.round(grams / 21000 * 100) / 100);
  const equivalent = vehicle === 'car'
    ? `About ${trees} tree-day${trees === 1 ? '' : 's'} of CO2 to absorb`
    : `Saves ~${Math.round(carGrams - grams)} g CO2 versus a solo car`;

  const wet = forecast.weather.icon === 'cloud-rain' || forecast.weather.icon === 'cloud-lightning' || forecast.weather.icon === 'cloud-drizzle';
  const heavy = forecast.traffic.level === 'heavy';

  const customerTips: string[] = [];
  if (heavy) customerTips.push(`Roads are busy — add about ${forecast.traffic.delayMin} min and confirm your pickup landmark so your driver reaches you fast.`);
  if (wet) customerTips.push(`${forecast.weather.label} expected — a Car keeps you dry; Moto Pro riders carry rain gear.`);
  if (vehicle === 'moto' && !isIntercity) customerTips.push('Wear the helmet provided for the whole trip.');
  if (vehicle === 'shared') customerTips.push('Sharing this ride cuts both your fare and your carbon footprint.');
  if (customerTips.length === 0) customerTips.push('Clear conditions — this is a good time to travel.');

  const driverTips: string[] = [];
  driverTips.push(`Suggested: ${route.name} — ${route.note.toLowerCase()}.`);
  if (heavy) driverTips.push(`Heavy traffic on direct roads — the suggested route avoids the worst of it.`);
  if (wet) driverTips.push('Wet roads — allow extra braking distance and drive smoothly.');
  if (isIntercity) driverTips.push('Long trip — check fuel and plan a rest stop.');
  if (driverTips.length === 1 && !isIntercity) driverTips.push('Smooth, steady driving keeps fuel use and emissions down.');

  return {
    distanceKm,
    durationMin: durationMin + (heavy ? forecast.traffic.delayMin : 0),
    traffic: forecast.traffic,
    route,
    emissions: { grams, kg, savedPct, equivalent },
    weather: forecast.weather,
    customerTips,
    driverTips,
  };
}

function buildInsight(weather: Forecast['weather'], traffic: Forecast['traffic']): string {
  const wet = weather.icon === 'cloud-rain' || weather.icon === 'cloud-lightning' || weather.icon === 'cloud-drizzle';
  if (wet && traffic.level === 'heavy') return `Rain and heavy traffic — expect about ${traffic.delayMin} min longer. Book early and confirm your pickup landmark.`;
  if (wet) return `${weather.label} likely — a Car keeps you dry, and Moto Pro riders carry rain gear.`;
  if (traffic.level === 'heavy') return `Roads are busy right now — a Moto can save you roughly ${traffic.delayMin} min versus a car.`;
  if (traffic.level === 'moderate') return `Traffic is picking up. Leave a little earlier to stay on time.`;
  return `Clear skies and open roads — a great time to travel.`;
}
