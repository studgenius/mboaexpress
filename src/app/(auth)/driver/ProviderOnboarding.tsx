import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, Briefcase, Building2, CarFront, Check, CheckCircle2, FileCheck2, IdCard, LockKeyhole, MapPin, Package, Plane, Plus, Route, Shield, ShieldCheck, Upload, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import type { ComplianceStatus, ProviderApplication, ProviderDocument, ProviderQualityScore, ProviderVehicle, SafetyTraining, ServiceType } from '@/lib/types';

type ProviderServiceChoice = { id: ServiceType; label: string; description: string; icon: React.ReactNode; tint: string };

const providerServices: ProviderServiceChoice[] = [
  { id: 'moto', label: 'Moto', description: 'Fast motorcycle rides', icon: <Bike size={22} />, tint: 'bg-[#fff0e5] text-[#be653e]' },
  { id: 'standard', label: 'Standard Car', description: 'Private point-to-point rides', icon: <CarFront size={22} />, tint: 'bg-[#e7f4f0] text-[#0d7770]' },
  { id: 'coride', label: 'Co-Ride', description: 'Shared rides with compatible passengers', icon: <Users size={22} />, tint: 'bg-[#e9f55b]/40 text-[#526213]' },
  { id: 'private_driver_city', label: 'Private Driver', description: 'Drive a customer vehicle or provide one', icon: <Briefcase size={22} />, tint: 'bg-[#f0e7f5] text-[#7a3d9a]' },
  { id: 'airport', label: 'Airport / Intercity', description: 'Scheduled and long-distance trips', icon: <Plane size={22} />, tint: 'bg-[#e7f0f5] text-[#2c6f9a]' },
  { id: 'delivery', label: 'Delivery', description: 'Deliver packages by moto or car', icon: <Package size={22} />, tint: 'bg-[#e0f3ed] text-[#118370]' },
];

const steps = [
  { label: 'Services', icon: <Route size={16} /> },
  { label: 'Identity', icon: <IdCard size={16} /> },
  { label: 'Credentials', icon: <FileCheck2 size={16} /> },
  { label: 'Vehicle', icon: <CarFront size={16} /> },
  { label: 'Insurance', icon: <ShieldCheck size={16} /> },
  { label: 'Safety', icon: <Shield size={16} /> },
  { label: 'Review', icon: <CheckCircle2 size={16} /> },
];

export default function ProviderOnboarding() {
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedServices, setSelectedServices] = useState<ServiceType[]>([]);
  const [application, setApplication] = useState<ProviderApplication | null>(null);
  const [vehicle, setVehicle] = useState<ProviderVehicle | null>(null);
  const [documents, setDocuments] = useState<ProviderDocument[]>([]);
  const [training, setTraining] = useState<SafetyTraining | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState({ fullName: profile?.full_name ?? '', dob: '', address: '', nationality: 'Cameroonian', idType: 'National ID', idNumber: '' });
  const [credentials, setCredentials] = useState({ licenceNumber: '', category: 'B', expiry: '', transportNumber: '', capacityNumber: '' });
  const [vehicleForm, setVehicleForm] = useState({ type: 'Car', make: '', model: '', year: '', color: '', registration: '', vin: '', seats: '4' });
  const [insurance, setInsurance] = useState({ provider: '', policyNumber: '', expiry: '', authorizationNumber: '' });
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const [applicationResult, vehicleResult, documentsResult, trainingResult] = await Promise.all([
        supabase.from('provider_applications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('provider_vehicles').select('*').eq('provider_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('provider_documents').select('*').eq('provider_id', user.id).order('created_at', { ascending: false }),
        supabase.from('safety_trainings').select('*').eq('provider_id', user.id).eq('training_type', 'road_safety').maybeSingle(),
      ]);
      if (applicationResult.data) {
        const record = applicationResult.data as ProviderApplication;
        setApplication(record);
        setSelectedServices(record.selected_services as ServiceType[]);
        setStep(record.lifecycle_stage === 'registered' ? 0 : Math.min(6, record.lifecycle_stage === 'admin_approval' ? 6 : 1));
      }
      if (vehicleResult.data) {
        const record = vehicleResult.data as ProviderVehicle;
        setVehicle(record);
        setVehicleForm({ type: record.vehicle_type, make: record.make, model: record.model, year: String(record.year ?? ''), color: record.color ?? '', registration: record.registration_number, vin: record.vin ?? '', seats: String(record.seat_count) });
      }
      if (documentsResult.data) setDocuments(documentsResult.data as ProviderDocument[]);
      if (trainingResult.data) setTraining(trainingResult.data as SafetyTraining);
    };
    load();
  }, [user]);

  const complianceStatus = (application?.compliance_status ?? profile?.provider_status ?? 'pending') as ComplianceStatus;
  const statusLabel = complianceStatus.replace(/_/g, ' ');
  const requiredDocuments = useMemo(() => {
    const list = ['identity_document', 'driving_licence', 'insurance', 'transport_authorization'];
    if (selectedServices.includes('moto')) list.push('motorcycle_registration', 'helmet_compliance');
    if (selectedServices.includes('standard') || selectedServices.includes('coride')) list.push('vehicle_registration');
    return [...new Set(list)];
  }, [selectedServices]);

  const updateApplication = async (patch: Record<string, unknown>, nextStage?: string) => {
    if (!user) return false;
    const payload = { ...patch, ...(nextStage ? { lifecycle_stage: nextStage } : {}) };
    const result = application
      ? await supabase.from('provider_applications').update(payload).eq('id', application.id).select().maybeSingle()
      : await supabase.from('provider_applications').insert({ user_id: user.id, ...payload }).select().maybeSingle();
    if (result.error || !result.data) { setStatus('We could not save this step. Please try again.'); return false; }
    setApplication(result.data as ProviderApplication);
    return true;
  };

  const saveStep = async () => {
    if (!user) return;
    setBusy(true); setStatus('');
    if (step === 0) {
      if (selectedServices.length === 0) { setStatus('Select at least one service.'); setBusy(false); return; }
      const ok = await updateApplication({ selected_services: selectedServices, lifecycle_stage: 'application', compliance_status: 'documents_required' });
      if (ok) setStep(1);
    } else if (step === 1) {
      if (!identity.fullName || !identity.dob || !identity.address || !identity.idNumber) { setStatus('Complete your identity details first.'); setBusy(false); return; }
      const ok = await updateApplication({ lifecycle_stage: 'documents_submitted' });
      if (ok) setStep(2);
    } else if (step === 2) {
      if (!credentials.licenceNumber || !credentials.expiry) { setStatus('Add a valid driving licence number and expiry date.'); setBusy(false); return; }
      const ok = await updateApplication({ lifecycle_stage: 'verification' });
      if (ok) setStep(3);
    } else if (step === 3) {
      if (!vehicleForm.make || !vehicleForm.model || !vehicleForm.registration) { setStatus('Add the vehicle details required for your service.'); setBusy(false); return; }
      const result = vehicle
        ? await supabase.from('provider_vehicles').update({ vehicle_type: vehicleForm.type, make: vehicleForm.make, model: vehicleForm.model, year: Number(vehicleForm.year) || null, color: vehicleForm.color || null, registration_number: vehicleForm.registration, vin: vehicleForm.vin || null, seat_count: Number(vehicleForm.seats) || 1 }).eq('id', vehicle.id).select().maybeSingle()
        : await supabase.from('provider_vehicles').insert({ provider_id: user.id, vehicle_type: vehicleForm.type, make: vehicleForm.make, model: vehicleForm.model, year: Number(vehicleForm.year) || null, color: vehicleForm.color || null, registration_number: vehicleForm.registration, vin: vehicleForm.vin || null, seat_count: Number(vehicleForm.seats) || 1 }).select().maybeSingle();
      if (result.error || !result.data) setStatus('We could not save the vehicle.');
      else { setVehicle(result.data as ProviderVehicle); await updateApplication({ lifecycle_stage: 'verification' }); setStep(4); }
    } else if (step === 4) {
      if (!insurance.provider || !insurance.policyNumber || !insurance.expiry) { setStatus('Add valid insurance details.'); setBusy(false); return; }
      const rows = [
        { provider_id: user.id, vehicle_id: vehicle?.id ?? null, document_type: 'insurance', document_number: insurance.policyNumber, expiry_date: insurance.expiry, verification_status: 'pending' },
        { provider_id: user.id, vehicle_id: vehicle?.id ?? null, document_type: 'transport_authorization', document_number: insurance.authorizationNumber || null, verification_status: insurance.authorizationNumber ? 'pending' : 'pending' },
      ];
      const result = await supabase.from('provider_documents').insert(rows).select();
      if (result.error) setStatus('We could not save your insurance details.');
      else { setDocuments((result.data as ProviderDocument[]) ?? []); await updateApplication({ lifecycle_stage: 'safety_check' }); setStep(5); }
    } else if (step === 5) {
      if (!safetyConfirmed) { setStatus('Confirm the safety requirements before continuing.'); setBusy(false); return; }
      const result = await supabase.from('safety_trainings').upsert({ provider_id: user.id, training_type: 'road_safety', completed: true, score: 100, completed_at: new Date().toISOString() }, { onConflict: 'provider_id,training_type' }).select().maybeSingle();
      if (result.error) setStatus('We could not save the safety training.');
      else { setTraining(result.data as SafetyTraining); await updateApplication({ lifecycle_stage: 'admin_approval', safety_training_completed: true, submitted_at: new Date().toISOString(), compliance_status: 'under_review' }); await supabase.from('profiles').update({ provider_status: 'under_review' }).eq('id', user.id); await refreshProfile(); setStep(6); }
    } else {
      setStatus('Your application is under review. You cannot go online until an administrator approves it.');
    }
    setBusy(false);
  };

  const toggleService = (service: ServiceType) => setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]);

  if (!user) return <Spinner />;
  return (
    <>
      <PageHeader title="Become a Provider" subtitle="One account for taking rides and providing safe transportation." />
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between gap-2 overflow-x-auto rounded-2xl border border-[#dce7e6] bg-white p-3">
          {steps.map((item, index) => <div key={item.label} className={`flex min-w-fit items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${step === index ? 'bg-[#0d2f35] text-white' : index < step ? 'bg-[#e0f3ed] text-[#118370]' : 'text-[#8ba0a2]'}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">{index < step ? <Check size={14} /> : item.icon}</span>{item.label}</div>)}
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-[#dcefe8] bg-[#f0faf7] p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0d7770] text-white"><LockKeyhole size={17} /></div><div className="min-w-0"><p className="text-sm font-semibold capitalize text-[#0d7770]">Compliance status: {statusLabel}</p><p className="mt-1 text-xs leading-relaxed text-[#587478]">Registration does not grant driving access. A provider must complete every check, pass admin review, and reach Active before accepting a booking.</p></div></div>

        <Card className="p-6 sm:p-8">
          {step === 0 && <ServiceStep selected={selectedServices} onToggle={toggleService} />}
          {step === 1 && <IdentityStep value={identity} onChange={(value) => setIdentity(value as typeof identity)} />}
          {step === 2 && <CredentialsStep value={credentials} onChange={(value) => setCredentials(value as typeof credentials)} services={selectedServices} />}
          {step === 3 && <VehicleStep value={vehicleForm} onChange={(value) => setVehicleForm(value as typeof vehicleForm)} services={selectedServices} />}
          {step === 4 && <InsuranceStep value={insurance} onChange={(value) => setInsurance(value as typeof insurance)} documents={documents} requiredDocuments={requiredDocuments} />}
          {step === 5 && <SafetyStep confirmed={safetyConfirmed} onConfirm={setSafetyConfirmed} services={selectedServices} training={training} />}
          {step === 6 && <ReviewStep application={application} services={selectedServices} documents={documents} vehicle={vehicle} training={training} />}
          {status && <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#fff4ed] px-4 py-3 text-sm font-semibold text-[#be653e]"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{status}</div>}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-[#edf1f1] pt-5"><button onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy} className="rounded-xl border border-[#dce7e6] px-4 py-3 text-sm font-semibold text-[#45656a] hover:bg-[#f5f8f8] disabled:invisible">Back</button><button onClick={saveStep} disabled={busy} className="flex items-center gap-2 rounded-xl bg-[#0d2f35] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-60">{busy ? 'Saving...' : step === 6 ? 'Application submitted' : step === 5 ? 'Submit for review' : 'Continue'} {!busy && step < 6 && <Check size={16} />}</button></div>
        </Card>
      </div>
    </>
  );
}

function ServiceStep({ selected, onToggle }: { selected: ServiceType[]; onToggle: (service: ServiceType) => void }) {
  return <div><SectionIntro icon={<Route size={21} />} title="What service do you want to provide?" subtitle="Select one or more services. Each service has its own eligibility checks." /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{providerServices.map((service) => <button key={service.id} onClick={() => onToggle(service.id)} className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition ${selected.includes(service.id) ? 'border-[#0d8179] bg-[#e7f4f0] shadow-[0_0_0_2px_rgba(13,129,121,.08)]' : 'border-[#e1e9e9] hover:border-[#9fbdbc]'}`}><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${service.tint}`}>{service.icon}</div><div><p className="text-sm font-semibold">{service.label}</p><p className="mt-1 text-xs leading-relaxed text-[#8ba0a2]">{service.description}</p></div>{selected.includes(service.id) && <CheckCircle2 size={17} className="ml-auto shrink-0 text-[#0d7770]" />}</button>)}</div><p className="mt-4 text-xs text-[#708b8e]">Moto providers can later qualify for Moto Pro after additional training and quality checks.</p></div>;
}

function IdentityStep({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  return <div><SectionIntro icon={<IdCard size={21} />} title="Personal identity" subtitle="We collect only what is needed to verify who can safely provide transport services." /><div className="grid gap-4 sm:grid-cols-2"><Input label="Full legal name" value={value.fullName} onChange={(fullName) => onChange({ ...value, fullName })} placeholder="As shown on your ID" /><Input label="Date of birth" type="date" value={value.dob} onChange={(dob) => onChange({ ...value, dob })} /><Input label="Residential address" value={value.address} onChange={(address) => onChange({ ...value, address })} placeholder="City and neighborhood" /><Input label="Nationality" value={value.nationality} onChange={(nationality) => onChange({ ...value, nationality })} /><Input label="ID document type" value={value.idType} onChange={(idType) => onChange({ ...value, idType })} placeholder="National ID / Passport" /><Input label="ID number" value={value.idNumber} onChange={(idNumber) => onChange({ ...value, idNumber })} placeholder="Document number" /></div><Notice>Identity documents are protected and reviewed for provider eligibility. They are not treated as ordinary profile information.</Notice></div>;
}

function CredentialsStep({ value, onChange, services }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void; services: ServiceType[] }) {
  return <div><SectionIntro icon={<FileCheck2 size={21} />} title="Driver credentials" subtitle="Your licence and professional transport credentials must remain valid." /><div className="grid gap-4 sm:grid-cols-2"><Input label="Driving licence number" value={value.licenceNumber} onChange={(licenceNumber) => onChange({ ...value, licenceNumber })} /><Input label="Licence category" value={value.category} onChange={(category) => onChange({ ...value, category })} /><Input label="Licence expiry" type="date" value={value.expiry} onChange={(expiry) => onChange({ ...value, expiry })} /><Input label="Transport licence / authorization" value={value.transportNumber} onChange={(transportNumber) => onChange({ ...value, transportNumber })} placeholder="If applicable" />{(services.includes('private_driver_city') || services.includes('airport')) && <Input label="Certificate of capacity" value={value.capacityNumber} onChange={(capacityNumber) => onChange({ ...value, capacityNumber })} placeholder="If applicable" />}</div><Notice>Requirements differ by service and city. Missing or expired credentials can restrict access to specific bookings.</Notice></div>;
}

function VehicleStep({ value, onChange, services }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void; services: ServiceType[] }) {
  const options = services.includes('moto') && !services.some((item) => ['standard', 'coride'].includes(item)) ? ['Moto'] : ['Car', 'Taxi', 'Moto'];
  return <div><SectionIntro icon={<CarFront size={21} />} title="Add your vehicle" subtitle="You can add more vehicles later. Every vehicle is verified separately." /><div className="grid gap-4 sm:grid-cols-2"><Select label="Vehicle type" value={value.type} options={options} onChange={(type) => onChange({ ...value, type })} /><Input label="Make" value={value.make} onChange={(make) => onChange({ ...value, make })} placeholder="Toyota, Honda..." /><Input label="Model" value={value.model} onChange={(model) => onChange({ ...value, model })} /><Input label="Year" value={value.year} onChange={(year) => onChange({ ...value, year })} placeholder="2022" /><Input label="Color" value={value.color} onChange={(color) => onChange({ ...value, color })} /><Input label="Registration number" value={value.registration} onChange={(registration) => onChange({ ...value, registration })} placeholder="CE-123-AA" /><Input label="VIN / chassis number" value={value.vin} onChange={(vin) => onChange({ ...value, vin })} /><Input label="Passenger seats" value={value.seats} onChange={(seats) => onChange({ ...value, seats })} /></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Requirement label="Registration / carte grise" /><Requirement label={value.type === 'Moto' ? 'Motorcycle registration' : 'Vehicle photos'} /><Requirement label="Technical inspection" /></div></div>;
}

function InsuranceStep({ value, onChange, documents, requiredDocuments }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void; documents: ProviderDocument[]; requiredDocuments: string[] }) {
  return <div><SectionIntro icon={<ShieldCheck size={21} />} title="Insurance & transport authorization" subtitle="Motor vehicles must carry valid third-party liability coverage and applicable transport approvals." /><div className="grid gap-4 sm:grid-cols-2"><Input label="Insurance provider" value={value.provider} onChange={(provider) => onChange({ ...value, provider })} placeholder="Insurance company" /><Input label="Policy number" value={value.policyNumber} onChange={(policyNumber) => onChange({ ...value, policyNumber })} /><Input label="Insurance expiry" type="date" value={value.expiry} onChange={(expiry) => onChange({ ...value, expiry })} /><Input label="Transport authorization number" value={value.authorizationNumber} onChange={(authorizationNumber) => onChange({ ...value, authorizationNumber })} placeholder="Licence / blue card / permit" /></div><div className="mt-5 rounded-2xl bg-[#f5f8f8] p-4"><p className="text-xs font-bold uppercase tracking-wider text-[#708b8e]">Required evidence</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{requiredDocuments.map((document) => <div key={document} className="flex items-center gap-2 text-sm text-[#45656a]"><Upload size={15} className="text-[#0d7770]" />{document.replace(/_/g, ' ')}</div>)}</div><p className="mt-3 text-[11px] text-[#8ba0a2]">Saved files are kept in protected storage and each document receives its own verification and expiry status.</p></div>{documents.length > 0 && <p className="mt-4 text-xs font-semibold text-[#0d7770]">{documents.length} document record{documents.length === 1 ? '' : 's'} saved and awaiting review.</p>}</div>;
}

function SafetyStep({ confirmed, onConfirm, services, training }: { confirmed: boolean; onConfirm: (value: boolean) => void; services: ServiceType[]; training: SafetyTraining | null }) {
  const checks = ['I will follow Cameroon road-safety rules and never drive while impaired.', 'I will keep my vehicle, licence, insurance, and authorizations valid.', 'I understand that SOS, incident reports, complaints, and serious safety events can restrict access.', ...(services.includes('moto') ? ['I will provide a compliant passenger helmet and maintain motorcycle safety equipment.'] : []), ...(services.includes('private_driver_city') ? ['I understand customer-vehicle and driver-only responsibilities.'] : [])];
  return <div><SectionIntro icon={<Shield size={21} />} title="Safety & training" subtitle="Complete the safety check before your application moves to administrator review." /><div className="rounded-2xl border border-[#e1e9e9] bg-[#fbfcfc] p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]"><ShieldCheck size={21} /></div><div><p className="text-sm font-semibold">Road safety training</p><p className="text-xs text-[#8ba0a2]">{training?.completed ? 'Completed and recorded' : 'Required before approval'}</p></div></div><div className="mt-5 space-y-3">{checks.map((check) => <label key={check} className="flex items-start gap-3 text-sm text-[#45656a]"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[#0d7770]" /><span>{check}</span></label>)}</div></div><Notice>Safety is checked before activation and monitored during every trip through tracking, emergency support, incident handling, and post-trip quality signals.</Notice></div>;
}

function ReviewStep({ application, services, documents, vehicle, training }: { application: ProviderApplication | null; services: ServiceType[]; documents: ProviderDocument[]; vehicle: ProviderVehicle | null; training: SafetyTraining | null }) {
  const checks = [{ label: 'Services selected', passed: services.length > 0 }, { label: 'Identity submitted', passed: application?.lifecycle_stage !== 'registered' }, { label: 'Vehicle recorded', passed: !!vehicle }, { label: 'Insurance record', passed: documents.some((item) => item.document_type === 'insurance') }, { label: 'Safety training', passed: !!training?.completed }];
  return <div><SectionIntro icon={<CheckCircle2 size={21} />} title="Application review" subtitle="Your application is now queued for verification. An administrator must approve it before you can go online." /><div className="grid gap-3 sm:grid-cols-2">{checks.map((check) => <div key={check.label} className="flex items-center gap-3 rounded-xl border border-[#e1e9e9] p-4"><div className={`flex h-8 w-8 items-center justify-center rounded-full ${check.passed ? 'bg-[#e0f3ed] text-[#118370]' : 'bg-[#fff0e5] text-[#be653e]'}`}>{check.passed ? <Check size={16} /> : <AlertTriangle size={16} />}</div><span className="text-sm font-semibold">{check.label}</span></div>)}</div><div className="mt-5 rounded-2xl bg-[#0d2f35] p-5 text-white"><p className="text-sm font-semibold">Current status: {application?.compliance_status?.replace(/_/g, ' ') ?? 'pending'}</p><p className="mt-1 text-xs leading-relaxed text-[#a8c5c6]">Do not accept rides until the status changes to active. The platform will automatically restrict expired or suspended providers.</p></div></div>;
}

export function ProviderSafetyCenter() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; relationship: string; phone: string }>>([]);
  const [contact, setContact] = useState({ name: '', relationship: '', phone: '' });
  const [message, setMessage] = useState('');
  const [incident, setIncident] = useState({ category: 'unsafe_driving', description: '' });
  useEffect(() => { if (user) supabase.from('emergency_contacts').select('id,name,relationship,phone').eq('user_id', user.id).then(({ data }) => setContacts(data ?? [])); }, [user]);
  const addContact = async () => { if (!user || !contact.name || !contact.relationship || !contact.phone) return; const { data, error } = await supabase.from('emergency_contacts').insert({ user_id: user.id, ...contact, is_primary: contacts.length === 0 }).select('id,name,relationship,phone').maybeSingle(); if (error) setMessage('Could not save emergency contact.'); else if (data) { setContacts((current) => [...current, data]); setContact({ name: '', relationship: '', phone: '' }); setMessage('Emergency contact saved.'); } };
  const reportIncident = async () => { if (!user || !incident.description) return; const { error } = await supabase.from('incident_reports').insert({ reporter_id: user.id, category: incident.category, description: incident.description, risk_level: incident.category === 'accident' || incident.category === 'harassment' ? 'high' : 'medium' }); setMessage(error ? 'Could not submit the report.' : 'Safety report submitted to the review team.'); if (!error) setIncident({ category: 'unsafe_driving', description: '' }); };
  return <><PageHeader title="Safety Center" subtitle="Protect yourself, your passengers, and the people you share the road with." /><div className="grid gap-5 lg:grid-cols-2"><Card className="p-6"><SectionIntro icon={<Shield size={21} />} title="Before every trip" subtitle="Keep these protections ready." /><div className="space-y-3">{['Confirm your identity and vehicle match the booking.', 'Keep GPS and trip monitoring available.', 'Use the SOS flow for immediate danger.', 'Report incidents promptly so access can be reviewed.'].map((item) => <div key={item} className="flex items-start gap-3 rounded-xl bg-[#f5f8f8] p-3 text-sm text-[#45656a]"><ShieldCheck size={16} className="mt-0.5 text-[#0d7770]" />{item}</div>)}</div></Card><Card className="p-6"><SectionIntro icon={<Users size={21} />} title="Emergency contacts" subtitle="People who should be reached if something goes wrong." />{contacts.length === 0 ? <EmptyState icon={<Users size={22} />} title="No contacts yet" subtitle="Add a trusted contact below." /> : <div className="space-y-2">{contacts.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl bg-[#f5f8f8] p-3"><div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs text-[#8ba0a2]">{item.relationship} · {item.phone}</p></div><CheckCircle2 size={17} className="text-[#0d7770]" /></div>)}</div>}<div className="mt-4 grid gap-2 sm:grid-cols-3"><input value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} placeholder="Name" className="rounded-xl border border-[#dce7e6] px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" /><input value={contact.relationship} onChange={(event) => setContact({ ...contact, relationship: event.target.value })} placeholder="Relationship" className="rounded-xl border border-[#dce7e6] px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" /><input value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} placeholder="Phone" className="rounded-xl border border-[#dce7e6] px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" /></div><button onClick={addContact} className="mt-3 flex items-center gap-2 rounded-xl bg-[#0d7770] px-4 py-2.5 text-xs font-semibold text-white"><Plus size={15} /> Add contact</button></Card><Card className="p-6 lg:col-span-2"><SectionIntro icon={<AlertTriangle size={21} />} title="Report a safety issue" subtitle="Serious incidents may immediately restrict a provider from accepting new trips while they are investigated." /><div className="grid gap-3 sm:grid-cols-[220px_1fr_auto]"><select value={incident.category} onChange={(event) => setIncident({ ...incident, category: event.target.value })} className="rounded-xl border border-[#dce7e6] px-3 py-3 text-sm outline-none focus:border-[#0d8179]"><option value="unsafe_driving">Unsafe driving</option><option value="accident">Accident</option><option value="wrong_vehicle">Wrong vehicle</option><option value="suspicious_activity">Suspicious activity</option><option value="payment_dispute">Payment dispute</option><option value="other">Other</option></select><input value={incident.description} onChange={(event) => setIncident({ ...incident, description: event.target.value })} placeholder="Describe what happened" className="rounded-xl border border-[#dce7e6] px-3 py-3 text-sm outline-none focus:border-[#0d8179]" /><button onClick={reportIncident} className="rounded-xl bg-[#be653e] px-4 py-3 text-sm font-semibold text-white">Submit report</button></div>{message && <p className="mt-4 text-sm font-semibold text-[#0d7770]">{message}</p>}</Card></div></>;
}

export function ProviderQuality() {
  const { user } = useAuth();
  const [quality, setQuality] = useState<ProviderQualityScore | null>(null);
  useEffect(() => { if (user) supabase.from('provider_quality_scores').select('*').eq('provider_id', user.id).maybeSingle().then(({ data }) => setQuality(data as ProviderQualityScore | null)); }, [user]);
  return <><PageHeader title="Provider quality" subtitle="Understand the signals that shape your provider tier." /><Card className="p-6"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e9f55b] text-2xl font-bold text-[#0d2f35]">{quality?.score ?? 0}</div><div><p className="text-lg font-semibold capitalize">{quality?.tier ?? 'pending'} tier</p><p className="text-sm text-[#8ba0a2]">Updated quality score</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-4">{[['Rating', quality?.average_rating?.toFixed(2) ?? '0.00'], ['Completed trips', String(quality?.completed_trips ?? 0)], ['Document compliance', `${quality?.document_compliance ?? 0}%`], ['Serious incidents', String(quality?.serious_incidents ?? 0)]].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f5f8f8] p-4"><p className="text-xs text-[#8ba0a2]">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>)}</div><p className="mt-5 text-xs leading-relaxed text-[#708b8e]">Your score is explainable: ratings, completed trips, cancellations, incidents, document compliance, and training all contribute. Status changes are reviewed before access is restored.</p></Card></>;
}

function SectionIntro({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) { return <div className="mb-6 flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d7770]">{icon}</div><div><h2 className="font-display text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-[#759092]">{subtitle}</p></div></div>; }
function Input({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] px-3 py-3 text-sm outline-none transition focus:border-[#0d8179]" /></label>; }
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] px-3 py-3 text-sm outline-none focus:border-[#0d8179]">{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
function Requirement({ label }: { label: string }) { return <div className="flex items-center gap-2 rounded-xl border border-[#e1e9e9] p-3 text-xs font-semibold text-[#45656a]"><FileCheck2 size={15} className="text-[#0d7770]" />{label}<span className="ml-auto text-[10px] text-[#be653e]">Required</span></div>; }
function Notice({ children }: { children: React.ReactNode }) { return <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#f5f8f8] p-3 text-[11px] leading-relaxed text-[#587478]"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-[#0d8179]" />{children}</div>; }
