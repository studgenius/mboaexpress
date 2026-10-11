import type { JourneyAssessment, TripType, VehicleType, CoRide } from '@/lib/types';

const INTERCITY_KEYWORDS = [
  'yaoundé', 'douala', 'bafoussam', 'bamenda', 'garoua', 'maroua', 'buea', 'limbe',
  'kribi', 'edéa', 'ngoundéré', 'bertoua', 'bafang', 'dchang', 'mbalmayo',
  'ebolowa', 'sangmélima', 'kousseri', 'yagoua', 'tiko', 'kumba', 'mamfe',
];

const CITY_PREFIXES = ['carrefour', 'quartier', 'marché', 'round', 'place', 'avenue', 'rue', 'bastos', 'akwa', 'bonanjo', 'bonapriso', 'mvan', 'mokolo', 'ndogpassi', 'cite verte', 'omnisport', 'briqueterie'];

export function assessJourney(pickup: string, destination: string, passengers: number): JourneyAssessment | null {
  if (!destination || !destination.trim()) return null;

  const p = pickup.toLowerCase().trim();
  const d = destination.toLowerCase().trim();

  const pickupIntercity = INTERCITY_KEYWORDS.some((kw) => p.includes(kw));
  const destIntercity = INTERCITY_KEYWORDS.some((kw) => d.includes(kw));
  const pickupCity = CITY_PREFIXES.some((kw) => p.includes(kw));
  const destCity = CITY_PREFIXES.some((kw) => d.includes(kw));

  let isIntercity = false;
  let confidence = 0.5;

  if (pickupIntercity && destIntercity && pickupIntercity !== destIntercity) {
    isIntercity = true;
    confidence = 0.92;
  } else if ((pickupIntercity && !destIntercity && destCity) || (destIntercity && !pickupIntercity && pickupCity)) {
    isIntercity = true;
    confidence = 0.85;
  } else if (pickupIntercity || destIntercity) {
    isIntercity = true;
    confidence = 0.7;
  } else if (pickupCity && destCity) {
    isIntercity = false;
    confidence = 0.88;
  } else if (pickupCity || destCity) {
    isIntercity = false;
    confidence = 0.75;
  } else {
    isIntercity = false;
    confidence = 0.55;
  }

  const estimatedDistanceKm = isIntercity
    ? Math.round(80 + Math.random() * 200)
    : Math.round(3 + Math.random() * 15);
  const estimatedDurationMin = isIntercity
    ? Math.round(estimatedDistanceKm / 60 * 60)
    : Math.round(estimatedDistanceKm / 25 * 60);

  const recommendedTripType: TripType = isIntercity
    ? (estimatedDistanceKm > 300 ? 'multi_day' : 'one_way')
    : (estimatedDurationMin > 240 ? 'full_day' : estimatedDurationMin > 90 ? 'hourly' : 'one_way');

  const recommendedVehicle: VehicleType = passengers > 3 ? 'Car' : isIntercity ? 'Car' : 'Moto';
  const recommendedScope = isIntercity ? 'intercity' : 'city';

  const baseRate = isIntercity ? 300 : 350;
  const baseFare = isIntercity ? 15000 : 4000;
  const minFare = Math.round(baseFare + estimatedDistanceKm * baseRate * 0.8);
  const maxFare = Math.round(baseFare + estimatedDistanceKm * baseRate * 1.3);

  const coRideEligible = passengers <= 2 && estimatedDistanceKm >= 10;

  const safetyNotes: string[] = [];
  if (isIntercity) safetyNotes.push('Long-distance trip — verify driver credentials and vehicle condition before departure');
  if (estimatedDistanceKm > 200) safetyNotes.push('Extended journey — consider scheduling a rest stop for the driver');
  if (passengers > 3) safetyNotes.push('Multiple passengers — ensure vehicle has adequate seating and seatbelts');
  if (recommendedVehicle === 'Moto' && !isIntercity) safetyNotes.push('Moto ride — helmet required for both rider and passenger');
  if (safetyNotes.length === 0) safetyNotes.push('Standard safety protocols apply');

  const aiReasoning: string[] = [];
  aiReasoning.push(
    isIntercity
      ? `Detected intercity journey (${confidence > 0.85 ? 'high' : 'moderate'} confidence — "${pickup}" → "${destination}" suggests cross-city travel)`
      : `Detected intra-city journey (${confidence > 0.8 ? 'high' : 'moderate'} confidence — both points appear within the same urban area)`
  );
  aiReasoning.push(`Estimated ${estimatedDistanceKm} km, ~${estimatedDurationMin} min travel time`);
  aiReasoning.push(
    recommendedTripType === 'multi_day' ? 'Distance suggests a multi-day booking for driver safety' :
    recommendedTripType === 'full_day' ? 'Duration suggests a full-day booking for best value' :
    recommendedTripType === 'hourly' ? 'Duration suggests hourly booking for flexibility and savings' :
    'One-way trip is the most cost-effective option'
  );
  aiReasoning.push(
    recommendedVehicle === 'Moto'
      ? 'Moto recommended for speed and affordability on short urban routes'
      : 'Car recommended for comfort and safety on this route'
  );
  if (coRideEligible) aiReasoning.push('Co-ride available — share with other passengers to save up to 30%');

  return {
    isIntercity,
    confidence,
    estimatedDistanceKm,
    estimatedDurationMin,
    recommendedTripType,
    recommendedVehicle,
    recommendedScope,
    fareRange: { min: minFare, max: maxFare },
    coRideEligible,
    safetyNotes,
    aiReasoning,
  };
}

export interface CoRideMatch {
  coride: CoRide;
  score: number;
  reason: string;
}

export function matchCoRides(pickup: string, destination: string, corides: CoRide[]): CoRideMatch[] {
  if (!pickup.trim() && !destination.trim()) return [];

  const p = pickup.toLowerCase().trim();
  const d = destination.toLowerCase().trim();

  const pTokens = p.split(/\s+/).filter((t) => t.length > 2);
  const dTokens = d.split(/\s+/).filter((t) => t.length > 2);

  const allKeywords = [...INTERCITY_KEYWORDS, ...CITY_PREFIXES];

  const results: CoRideMatch[] = [];

  for (const cr of corides) {
    if (cr.status !== 'open' || cr.available_seats <= 0) continue;

    const cp = cr.pickup.toLowerCase().trim();
    const cd = cr.destination.toLowerCase().trim();

    let score = 0;
    const reasons: string[] = [];

    const pickupExact = p && (cp === p || cp.includes(p) || p.includes(cp));
    const destExact = d && (cd === d || cd.includes(d) || d.includes(cd));

    if (pickupExact) { score += 50; reasons.push('pickup match'); }
    if (destExact) { score += 50; reasons.push('destination match'); }

    if (!pickupExact && pTokens.length > 0) {
      const overlap = pTokens.filter((t) => cp.includes(t)).length;
      if (overlap > 0) { score += 15 * overlap; reasons.push(`${overlap} pickup keyword(s)`); }
    }

    if (!destExact && dTokens.length > 0) {
      const overlap = dTokens.filter((t) => cd.includes(t)).length;
      if (overlap > 0) { score += 15 * overlap; reasons.push(`${overlap} destination keyword(s)`); }
    }

    const pCity = allKeywords.find((kw) => p.includes(kw));
    const dCity = allKeywords.find((kw) => d.includes(kw));
    const cpCity = allKeywords.find((kw) => cp.includes(kw));
    const cdCity = allKeywords.find((kw) => cd.includes(kw));

    if (pCity && cpCity && pCity === cpCity) { score += 20; reasons.push('same pickup city'); }
    if (dCity && cdCity && dCity === cdCity) { score += 20; reasons.push('same destination city'); }

    if (pCity && cdCity && pCity === cdCity && !dCity) {
      score += 10;
      reasons.push('your pickup is near co-ride destination');
    }
    if (dCity && cpCity && dCity === cpCity && !pCity) {
      score += 10;
      reasons.push('your destination is near co-ride pickup');
    }

    if (score > 0) {
      results.push({ coride: cr, score, reason: reasons.join(', ') });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
