export type UserRole = 'customer' | 'driver' | 'owner' | 'admin';
export type VehicleType = 'Moto' | 'Taxi' | 'Car';
export type ServiceType = 'standard' | 'coride' | 'moto' | 'moto_pro' | 'private_driver_city' | 'private_driver_intercity' | 'airport' | 'intercity' | 'intercity_shared' | 'delivery';
export type TripType = 'one_way' | 'round_trip' | 'hourly' | 'full_day' | 'return_later' | 'multi_day';

export interface JourneyAssessment {
  isIntercity: boolean;
  confidence: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  recommendedTripType: TripType;
  recommendedVehicle: VehicleType;
  recommendedScope: 'city' | 'intercity';
  fareRange: { min: number; max: number };
  coRideEligible: boolean;
  safetyNotes: string[];
  aiReasoning: string[];
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  role: UserRole;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  is_online: boolean;
  rating: number;
  total_trips: number;
  language?: string;
  data_encrypted?: boolean;
  city?: string | null;
  region?: string | null;
  wallet_balance?: number;
  provider_status?: ComplianceStatus;
  provider_activated_at?: string | null;
  provider_quality_tier?: ProviderQualityTier;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  direction: 'credit' | 'debit';
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  description: string | null;
  created_at: string;
}

export interface SavedPlace {
  id: string;
  user_id: string;
  label: string;
  address: string;
  landmark: string | null;
  note: string | null;
  type: 'home' | 'work' | 'other';
  created_at: string;
}

export interface RideRequest {
  id: string;
  pickup: string;
  destination: string;
  vehicle_type: string;
  payment_method: string;
  payment_status?: string | null;
  pickup_landmark?: string | null;
  pickup_note?: string | null;
  cash_change_for?: number | null;
  fare: number;
  status: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  driver_name: string | null;
  user_id: string | null;
  driver_id: string | null;
  service_type?: ServiceType;
  flight_number?: string | null;
  scheduled_time?: string | null;
  passenger_count?: number;
  package_description?: string | null;
  driver_service_option?: 'driver_only' | 'driver_and_vehicle' | null;
  booking_mode?: 'single' | 'hourly';
  requested_hours?: number;
  approved_hours?: number;
  hourly_rate?: number | null;
  extension_requested_hours?: number | null;
  extension_status?: 'none' | 'pending' | 'accepted' | 'declined';
  extension_requested_at?: string | null;
  airport_id?: string | null;
  airport_direction?: 'pickup' | 'dropoff' | null;
  trip_type?: TripType | null;
  intercity_mode?: 'private' | 'shared' | null;
  delivery_vehicle?: 'moto' | 'car' | null;
  moto_pro?: boolean | null;
  private_driver_scope?: 'city' | 'intercity' | null;
  created_at: string;
}

export interface DriverApplication {
  id: string;
  driver_id: string;
  full_name: string;
  phone: string;
  vehicle_type: VehicleType;
  vehicle_model: string;
  license_plate: string;
  license_number: string;
  license_expiry: string | null;
  insurance_provider: string;
  background_check_consent: boolean;
  safety_quiz_confirmed: boolean;
  terms_accepted: boolean;
  subscription_plan: 'basic' | 'pro' | 'fleet';
  status: 'pending_review' | 'under_review' | 'approved' | 'rejected';
  ai_photo_status: 'not_started' | 'queued' | 'passed' | 'needs_review';
  government_verification_status: 'not_started' | 'queued' | 'verified' | 'needs_review';
  created_at: string;
}

export interface DriverVehiclePhoto {
  id: string;
  application_id: string;
  driver_id: string;
  photo_type: 'inside' | 'outside_front' | 'outside_back' | 'outside_side' | 'license_document' | 'insurance_document';
  storage_path: string;
  review_status: 'queued' | 'passed' | 'needs_review';
  ai_notes: string;
  created_at: string;
}

export interface CoRide {
  id: string;
  owner_id: string | null;
  owner_name: string;
  pickup: string;
  destination: string;
  departure_time: string;
  total_seats: number;
  available_seats: number;
  price_per_seat: number;
  vehicle_info: string;
  status: string;
  created_at: string;
}

export interface CoRideBooking {
  id: string;
  coride_id: string;
  passenger_id: string | null;
  passenger_name: string;
  seats_booked: number;
  status: string;
  payment_method: string;
  created_at: string;
}

export interface DriverEarning {
  id: string;
  driver_id: string;
  amount: number;
  payment_method: string;
  description: string;
  created_at: string;
}

export interface RideReview {
  id: string;
  ride_id: string | null;
  driver_id: string | null;
  driver_name: string;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface AiDriverRanking {
  driver_name: string;
  driver_id: string | null;
  avg_rating: number;
  review_count: number;
  total_trips: number;
  ai_score: number;
  tier: string;
  sentiment: string;
  best_comment: string | null;
  vehicle_type: string;
}

export interface DriverHourlyRate {
  id: string;
  driver_id: string;
  vehicle_type: string;
  base_hourly_rate: number;
  discount_2h: number;
  discount_4h: number;
  discount_8h: number;
  created_at: string;
  updated_at: string;
}

export interface SosAlert {
  id: string;
  user_id: string;
  user_name: string;
  latitude: number;
  longitude: number;
  location_name: string;
  status: string;
  ai_analysis: string;
  notified_stations: string;
  created_at: string;
}

export interface RideMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'customer' | 'driver';
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface Promotion {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  service_type: string | null;
  max_redemptions: number;
  redemptions_count: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Complaint {
  id: string;
  user_id: string;
  user_name: string;
  ride_id: string | null;
  subject: string;
  description: string;
  category: 'general' | 'driver' | 'trip' | 'payment' | 'safety' | 'vehicle';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Commission {
  id: string;
  ride_id: string | null;
  driver_id: string;
  service_type: string;
  fare: number;
  commission_rate: number;
  commission_amount: number;
  driver_payout: number;
  created_at: string;
}

export interface ServiceConfig {
  id: string;
  service_type: ServiceType;
  label: string;
  base_fare: number;
  per_km_rate: number;
  per_minute_rate: number;
  min_fare: number;
  max_passengers: number;
  allows_scheduling: boolean;
  allows_hourly: boolean;
  max_hours: number;
  commission_rate: number;
  is_active: boolean;
  icon_name: string;
  updated_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  ride_updates: boolean;
  promotions: boolean;
  safety_alerts: boolean;
  account_updates: boolean;
  security_alerts: boolean;
  driver_requests: boolean;
  earnings_updates: boolean;
  updated_at: string;
}

export interface SiemEvent {
  id: string;
  event_type: 'failed_login' | 'suspicious_activity' | 'rate_limit_hit' | 'blocked_request' | 'ai_anomaly' | 'data_breach_attempt' | 'privilege_escalation' | 'sql_injection' | 'xss_attempt' | 'brute_force';
  severity: 'low' | 'medium' | 'high' | 'critical';
  user_id: string | null;
  user_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  source: string;
  status: 'logged' | 'investigating' | 'resolved' | 'escalated';
  created_at: string;
}

export interface SecurityScan {
  id: string;
  scan_type: 'full_scan' | 'user_scan' | 'ride_scan' | 'payment_scan' | 'auth_scan' | 'behavior_scan';
  status: 'running' | 'completed' | 'failed';
  anomalies_found: number;
  actions_taken: number;
  users_isolated: number;
  requests_blocked: number;
  severity_summary: Record<string, number> | null;
  findings: Array<{ title: string; severity: string; description: string; action: string }> | null;
  ai_summary: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface IsolatedUser {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isolated_by: 'ai' | 'admin';
  isolated_at: string;
  released_at: string | null;
  status: 'isolated' | 'released' | 'under_review';
}

export interface ComplaintRoute {
  id: string;
  complaint_id: string;
  user_id: string;
  user_name: string;
  category: string;
  subject: string;
  description: string;
  routed_to: 'police' | 'transport_regulator' | 'consumer_protection' | 'municipal_council' | 'gendarmerie' | 'ministry_of_transport' | 'internal_review';
  board_name: string;
  board_contact: string | null;
  ai_analysis: string | null;
  ai_confidence: number;
  status: 'routed' | 'acknowledged' | 'under_investigation' | 'resolved' | 'rejected';
  board_reference: string | null;
  routed_at: string;
  resolved_at: string | null;
}

export interface AppLanguage {
  id: string;
  code: string;
  name: string;
  native_name: string;
  flag_emoji: string | null;
  is_active: boolean;
}

export interface UserLanguage {
  id: string;
  user_id: string;
  language_code: string;
  created_at: string;
}

export interface Airport {
  id: string;
  name: string;
  iata_code: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

export interface UserLocation {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  updated_at: string;
}

export type ComplianceStatus = 'pending' | 'documents_required' | 'under_review' | 'approved' | 'active' | 'expiring' | 'restricted' | 'suspended' | 'rejected' | 'deactivated';
export type ProviderLifecycle = 'registered' | 'application' | 'documents_submitted' | 'verification' | 'safety_check' | 'admin_approval' | 'active' | 'can_go_online';
export type ProviderQualityTier = 'pending' | 'verified' | 'active' | 'trusted' | 'restricted' | 'suspended' | 'deactivated';

export interface ProviderApplication {
  id: string;
  user_id: string;
  lifecycle_stage: ProviderLifecycle;
  compliance_status: ComplianceStatus;
  selected_services: string[];
  identity_verified: boolean;
  credentials_verified: boolean;
  vehicle_verified: boolean;
  insurance_verified: boolean;
  authorization_verified: boolean;
  safety_training_completed: boolean;
  eligibility_checked: boolean;
  review_notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderService {
  id: string;
  provider_id: string;
  service_type: ServiceType;
  eligibility_status: 'pending' | 'eligible' | 'restricted' | 'rejected';
  is_active: boolean;
  operating_cities: string[];
  max_trip_distance_km: number | null;
  created_at: string;
}

export interface ProviderVehicle {
  id: string;
  provider_id: string;
  vehicle_type: VehicleType | 'Other';
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  registration_number: string;
  vin: string | null;
  seat_count: number;
  status: 'pending' | 'verified' | 'rejected' | 'expiring' | 'expired';
  created_at: string;
}

export interface ProviderDocument {
  id: string;
  provider_id: string;
  vehicle_id: string | null;
  document_type: string;
  document_number: string | null;
  document_file_path: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  verification_status: 'pending' | 'verified' | 'rejected' | 'expiring' | 'expired';
  rejection_reason: string | null;
  created_at: string;
}

export interface ProviderRequirement {
  id: string;
  provider_id: string;
  service_type: ServiceType;
  requirement_code: string;
  requirement_label: string;
  requirement_group: string;
  is_required: boolean;
  status: 'missing' | 'pending' | 'passed' | 'failed' | 'expired';
}

export interface SafetyTraining {
  id: string;
  provider_id: string;
  training_type: string;
  completed: boolean;
  score: number | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface EmergencyContact {
  id: string;
  user_id: string;
  name: string;
  relationship: string;
  phone: string;
  is_primary: boolean;
}

export interface IncidentReport {
  id: string;
  provider_id: string | null;
  ride_id: string | null;
  reporter_id: string;
  category: 'accident' | 'driver_behaviour' | 'harassment' | 'unsafe_driving' | 'wrong_vehicle' | 'suspicious_activity' | 'payment_dispute' | 'lost_property' | 'other';
  description: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'triaging' | 'investigating' | 'resolved' | 'closed';
  immediate_action: string | null;
  created_at: string;
}

export interface ProviderQualityScore {
  id: string;
  provider_id: string;
  score: number;
  tier: ProviderQualityTier;
  average_rating: number;
  completed_trips: number;
  cancellation_rate: number;
  serious_incidents: number;
  document_compliance: number;
  updated_at: string;
}
