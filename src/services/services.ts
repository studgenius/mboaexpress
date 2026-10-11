import type { ServiceType } from '@/lib/types';

export interface ServiceMeta {
  id: ServiceType;
  label: string;
  description: string;
  iconName: string;
  tint: string;
  baseFare: number;
  perKm: number;
  eta: string;
  allowsScheduling: boolean;
  allowsHourly: boolean;
  maxPassengers: number;
  commissionRate: number;
}

export const SERVICES: ServiceMeta[] = [
  { id: 'standard', label: 'Standard Ride', description: 'Private point-to-point ride', iconName: 'CarFront', tint: 'bg-[#e7f4f0] text-[#0d7770]', baseFare: 4000, perKm: 350, eta: '4 min', allowsScheduling: false, allowsHourly: false, maxPassengers: 4, commissionRate: 15 },
  { id: 'coride', label: 'Co-Ride', description: 'Share and save up to 30%', iconName: 'Users', tint: 'bg-[#e9f55b]/40 text-[#526213]', baseFare: 2800, perKm: 250, eta: '6 min', allowsScheduling: false, allowsHourly: false, maxPassengers: 4, commissionRate: 10 },
  { id: 'moto', label: 'Moto Ride', description: 'Fast motorcycle transport', iconName: 'Bike', tint: 'bg-[#fff0e5] text-[#be653e]', baseFare: 2400, perKm: 200, eta: '3 min', allowsScheduling: false, allowsHourly: false, maxPassengers: 1, commissionRate: 15 },
  { id: 'moto_pro', label: 'Moto Pro', description: 'Premium moto with verified drivers & helmets', iconName: 'Bike', tint: 'bg-[#e7f0f5] text-[#2c6f9a]', baseFare: 3500, perKm: 300, eta: '5 min', allowsScheduling: true, allowsHourly: false, maxPassengers: 1, commissionRate: 18 },
  { id: 'private_driver_city', label: 'Private Driver — City', description: 'Professional driver within the city', iconName: 'Briefcase', tint: 'bg-[#f0e7f5] text-[#7a3d9a]', baseFare: 7000, perKm: 500, eta: '8 min', allowsScheduling: true, allowsHourly: true, maxPassengers: 4, commissionRate: 20 },
  { id: 'private_driver_intercity', label: 'Private Driver — Intercity', description: 'Professional driver between cities', iconName: 'Briefcase', tint: 'bg-[#f5ede0] text-[#8a6520]', baseFare: 15000, perKm: 400, eta: 'Scheduled', allowsScheduling: true, allowsHourly: false, maxPassengers: 4, commissionRate: 20 },
  { id: 'airport', label: 'Airport Transfer', description: 'Scheduled airport pickup/drop-off', iconName: 'Plane', tint: 'bg-[#e7f0f5] text-[#2c6f9a]', baseFare: 8000, perKm: 400, eta: 'Scheduled', allowsScheduling: true, allowsHourly: false, maxPassengers: 4, commissionRate: 18 },
  { id: 'intercity', label: 'Intercity Ride', description: 'Private city-to-city transportation', iconName: 'Route', tint: 'bg-[#f5ede0] text-[#8a6520]', baseFare: 15000, perKm: 300, eta: 'Scheduled', allowsScheduling: true, allowsHourly: false, maxPassengers: 4, commissionRate: 15 },
  { id: 'intercity_shared', label: 'Shared Intercity', description: 'Shared city-to-city ride', iconName: 'Route', tint: 'bg-[#e9f55b]/40 text-[#526213]', baseFare: 8000, perKm: 200, eta: 'Scheduled', allowsScheduling: true, allowsHourly: false, maxPassengers: 4, commissionRate: 12 },
  { id: 'delivery', label: 'Delivery', description: 'Send packages and parcels', iconName: 'Package', tint: 'bg-[#e0f3ed] text-[#118370]', baseFare: 2000, perKm: 150, eta: '5 min', allowsScheduling: false, allowsHourly: false, maxPassengers: 1, commissionRate: 15 },
];

export function getService(id: ServiceType): ServiceMeta {
  return SERVICES.find((s) => s.id === id) ?? SERVICES[0];
}

export function calculateFare(service: ServiceType, options: { hours?: number; vehicleType?: string }): number {
  const svc = getService(service);
  if ((service === 'private_driver_city' || service === 'private_driver_intercity') && options.hours) {
    const hourlyRate = options.vehicleType === 'Moto' ? 2500 : options.vehicleType === 'Taxi' ? 5000 : 7000;
    const discount = options.hours >= 8 ? 15 : options.hours >= 4 ? 10 : options.hours >= 2 ? 5 : 0;
    return Math.round(hourlyRate * options.hours * (1 - discount / 100));
  }
  if (service === 'private_driver_intercity' && options.hours && options.hours >= 24) {
    const dailyRate = 50000;
    const days = Math.ceil(options.hours / 24);
    return dailyRate * days;
  }
  return svc.baseFare;
}

export function calculateCommission(fare: number, serviceType: ServiceType): { commission: number; payout: number; rate: number } {
  const svc = getService(serviceType);
  const commission = Math.round(fare * (svc.commissionRate / 100));
  return { commission, payout: fare - commission, rate: svc.commissionRate };
}

export type RideKind = 'moto' | 'standard' | 'coride' | 'private_driver';

export interface EligibleRide {
  id: RideKind;
  serviceType: RideKind;
  label: string;
  description: string;
  iconName: 'Bike' | 'CarFront' | 'Users' | 'Briefcase';
  fare: number;
  etaText: string;
  capacity: number;
  badge?: string;
}

export interface EligibleRideFares {
  baseMoto: number;
  perKmMoto: number;
  baseCar: number;
  perKmCar: number;
  basePrivate: number;
  perKmPrivate: number;
}

export function getEligibleRides(opts: { distanceKm: number; passengers: number; isIntercity: boolean; fares: EligibleRideFares }): EligibleRide[] {
  const { distanceKm, passengers, isIntercity, fares } = opts;
  const round = (n: number) => Math.max(500, Math.round(n / 50) * 50);
  const carFare = round(fares.baseCar + fares.perKmCar * distanceKm);
  const rides: EligibleRide[] = [];

  if (passengers <= 1 && !isIntercity && distanceKm <= 25) {
    rides.push({ id: 'moto', serviceType: 'moto', label: 'Moto', description: 'Fast motorcycle ride · 1 passenger', iconName: 'Bike', fare: round(fares.baseMoto + fares.perKmMoto * distanceKm), etaText: '3–6 min away', capacity: 1, badge: 'FASTEST' });
  }

  rides.push({ id: 'standard', serviceType: 'standard', label: 'Standard Car', description: 'Comfortable everyday ride · up to 4', iconName: 'CarFront', fare: carFare, etaText: '5–9 min away', capacity: 4, badge: 'BEST VALUE' });

  if (passengers <= 2 && distanceKm >= 6) {
    rides.push({ id: 'coride', serviceType: 'coride', label: 'Co-Ride', description: 'Shared ride with compatible passengers', iconName: 'Users', fare: round(carFare * 0.7), etaText: '6–12 min away', capacity: 2, badge: 'SHARED' });
  }

  rides.push({ id: 'private_driver', serviceType: 'private_driver', label: 'Private Driver', description: 'Professional driver for your trip', iconName: 'Briefcase', fare: round(fares.basePrivate + fares.perKmPrivate * distanceKm), etaText: isIntercity ? 'Scheduled' : '7–12 min away', capacity: 4, badge: 'PREMIUM' });

  return rides;
}
