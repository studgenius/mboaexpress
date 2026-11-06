import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, FileCheck2, ImagePlus, LockKeyhole, ShieldCheck, Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, PageHeader, Spinner } from '@/components/ui';
import type { DriverApplication, DriverVehiclePhoto, VehicleType } from '@/lib/types';

const photoFields = [
  { id: 'inside', label: 'Vehicle interior', hint: 'Dashboard and seats' },
  { id: 'outside_front', label: 'Front exterior', hint: 'Front of the vehicle' },
  { id: 'outside_back', label: 'Rear exterior', hint: 'Rear of the vehicle' },
  { id: 'outside_side', label: 'Side exterior', hint: 'Full side profile' },
  { id: 'license_document', label: 'Driver license', hint: 'Clear document photo' },
  { id: 'insurance_document', label: 'Insurance document', hint: 'Current insurance proof' },
] as const;

type PhotoId = typeof photoFields[number]['id'];
type PhotoFile = { file: File; preview: string };

export default function DriverRegistration() {
  const { user, profile, refreshProfile } = useAuth();
  const [application, setApplication] = useState<DriverApplication | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<PhotoId, PhotoFile>>>({});
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [vehicleType, setVehicleType] = useState<VehicleType>('Car');
  const [vehicleModel, setVehicleModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [backgroundCheck, setBackgroundCheck] = useState(false);
  const [safetyQuiz, setSafetyQuiz] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [plan, setPlan] = useState<'basic' | 'pro' | 'fleet'>('pro');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from('driver_applications').select('*').eq('driver_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
      if (data) {
        const record = data as DriverApplication;
        setApplication(record);
        setFullName(record.full_name); setPhone(record.phone); setVehicleType(record.vehicle_type);
        setVehicleModel(record.vehicle_model); setLicensePlate(record.license_plate); setLicenseNumber(record.license_number);
        setLicenseExpiry(record.license_expiry ?? ''); setInsuranceProvider(record.insurance_provider);
        setBackgroundCheck(record.background_check_consent); setSafetyQuiz(record.safety_quiz_confirmed); setTermsAccepted(record.terms_accepted); setPlan(record.subscription_plan);
      }
      setLoading(false);
    });
  }, [user]);

  const selectPhoto = (id: PhotoId, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') { setMessage('Please choose an image or PDF document.'); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage('Each file must be smaller than 8 MB.'); return; }
    const previous = photos[id];
    if (previous) URL.revokeObjectURL(previous.preview);
    setPhotos((current) => ({ ...current, [id]: { file, preview: URL.createObjectURL(file) } }));
    setMessage('');
  };

  const submit = async () => {
    if (!user || !fullName || !phone || !vehicleModel || !licensePlate || !licenseNumber || !insuranceProvider || !backgroundCheck || !safetyQuiz || !termsAccepted) {
      setMessage('Complete the required details and safety confirmations first.'); return;
    }
    setBusy(true); setMessage('');
    const payload = {
      driver_id: user.id, full_name: fullName, phone, vehicle_type: vehicleType, vehicle_model: vehicleModel,
      license_plate: licensePlate, license_number: licenseNumber, license_expiry: licenseExpiry || null,
      insurance_provider: insuranceProvider, background_check_consent: backgroundCheck, safety_quiz_confirmed: safetyQuiz,
      terms_accepted: termsAccepted, subscription_plan: plan, status: 'pending_review', ai_photo_status: 'queued', government_verification_status: 'queued',
    };
    const result = application
      ? await supabase.from('driver_applications').update(payload).eq('id', application.id).select().maybeSingle()
      : await supabase.from('driver_applications').insert(payload).select().maybeSingle();
    if (result.error || !result.data) { setBusy(false); setMessage('We could not save your application. Please try again.'); return; }
    const saved = result.data as DriverApplication;
    const uploadResults = await Promise.all(Object.entries(photos).map(async ([photoType, selected]) => {
      if (!selected) return null;
      const path = `${user.id}/${saved.id}/${photoType}-${Date.now()}-${selected.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const upload = await supabase.storage.from('driver-documents').upload(path, selected.file, { upsert: true, contentType: selected.file.type });
      if (upload.error) return upload.error;
      return supabase.from('driver_vehicle_photos').insert({ application_id: saved.id, driver_id: user.id, photo_type: photoType, storage_path: path, review_status: 'queued', ai_notes: 'AI photo review queued' });
    }));
    const uploadFailed = uploadResults.some((item) => item && 'message' in item && item.message);
    if (uploadFailed) { setBusy(false); setMessage('Application saved, but one or more files could not be uploaded.'); return; }
    await supabase.from('profiles').update({ vehicle_type: vehicleType, vehicle_plate: licensePlate }).eq('id', user.id);
    await refreshProfile();
    setApplication(saved); setPhotos({}); setBusy(false);
    setMessage('Application submitted. Photo and government checks are now queued.');
  };

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader title="Become a licensed driver" subtitle="Subscription is only granted to verified, insured drivers who meet our safety conditions." />
      <div className="mx-auto max-w-5xl space-y-5">
        {application && <StatusBanner application={application} />}
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9f7ed] text-[#08ae7a]"><LockKeyhole size={21} /></div><div><h2 className="font-display text-xl font-semibold">Driver & vehicle</h2><p className="text-xs text-[#759092]">Tell us how you will provide safe rides.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name *" value={fullName} onChange={setFullName} placeholder="Your name" />
            <Field label="Phone *" value={phone} onChange={setPhone} placeholder="+237..." />
            <SelectField label="Vehicle type" value={vehicleType} onChange={(value) => setVehicleType(value as VehicleType)} options={['Car', 'Taxi', 'Moto']} />
            <Field label="Vehicle model *" value={vehicleModel} onChange={setVehicleModel} placeholder="Toyota Corolla" />
            <Field label="License plate *" value={licensePlate} onChange={setLicensePlate} placeholder="DLA-1234-A" />
            <Field label="License number *" value={licenseNumber} onChange={setLicenseNumber} placeholder="CM-2026-..." />
            <Field label="License expiry" type="date" value={licenseExpiry} onChange={setLicenseExpiry} />
            <Field label="Insurance provider *" value={insuranceProvider} onChange={setInsuranceProvider} placeholder="Activa Assurances" />
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7f4f0] text-[#0d8179]"><ShieldCheck size={21} /></div><div><h2 className="font-display text-xl font-semibold">Safety conditions</h2><p className="text-xs text-[#759092]">Every driver is reviewed before receiving ride requests.</p></div></div>
          <div className="space-y-3"><CheckRow checked={backgroundCheck} onChange={setBackgroundCheck}>I consent to a background check and confirm a clean record</CheckRow><CheckRow checked={safetyQuiz} onChange={setSafetyQuiz}>I passed the road safety quiz and will follow all traffic rules</CheckRow><CheckRow checked={termsAccepted} onChange={setTermsAccepted}>I accept the driver terms: valid license, insured vehicle, no reckless driving</CheckRow></div>
        </Card>

        <Card className="p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff8e0] text-[#b8860b]"><ImagePlus size={21} /></div><div><h2 className="font-display text-xl font-semibold">Vehicle condition photos</h2><p className="text-xs text-[#759092]">Upload clear photos. AI review checks image quality and flags vehicles for manual inspection.</p></div></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{photoFields.map((field) => <PhotoPicker key={field.id} field={field} selected={photos[field.id]} onSelect={(file) => selectPhoto(field.id, file)} onRemove={() => setPhotos((current) => ({ ...current, [field.id]: undefined }))} />)}</div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#f5f8f8] p-3 text-[11px] text-[#587478]"><FileCheck2 size={15} className="mt-0.5 shrink-0 text-[#0d8179]" /> License and insurance documents are queued for verification with the relevant government and insurance entities. Approval is never granted from the browser alone.</div>
        </Card>

        <Card className="p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold">Choose your subscription</h2><p className="mt-1 text-xs text-[#759092]">Your plan activates only after your application is approved.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">{([['basic', 'Basic — 1 vehicle', 'Standard commission'], ['pro', 'Pro — priority rides', 'Lower commission + airport priority'], ['fleet', 'Fleet — up to 10 vehicles', 'For operators']] as const).map(([id, title, desc]) => <button key={id} onClick={() => setPlan(id)} className={`rounded-2xl border p-4 text-left transition ${plan === id ? 'border-[#08ae7a] bg-[#ecfff8] shadow-[0_0_0_2px_rgba(8,174,122,.12)]' : 'border-[#dce7e6] hover:border-[#9fbdbc]'}`}><p className="font-semibold">{title}</p><p className="mt-1 text-xs text-[#708b8e]">{desc}</p></button>)}</div>
        </Card>

        <button onClick={submit} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#08b77f] py-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(8,174,122,.2)] transition hover:bg-[#079b6d] disabled:opacity-60">{busy ? <><Upload size={17} className="animate-pulse" /> Submitting application...</> : <><CheckCircle2 size={17} /> {application ? 'Update driver application' : 'Activate driver subscription'}</>}</button>
        {message && <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.includes('could') || message.includes('Complete') || message.includes('smaller') || message.includes('choose') ? 'bg-red-50 text-red-600' : 'bg-[#e7f4f0] text-[#0d7770]'}`}>{message}</p>}
      </div>
    </>
  );
}

function StatusBanner({ application }: { application: DriverApplication }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-[#dcefe8] bg-[#f0faf7] p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0d8179] text-white"><FileCheck2 size={17} /></div><div><p className="text-sm font-semibold text-[#0d7770]">Application {application.status.replace('_', ' ')}</p><p className="mt-1 text-xs text-[#587478]">AI photo review: {application.ai_photo_status.replace('_', ' ')} · Government verification: {application.government_verification_status.replace('_', ' ')}.</p></div></div>;
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><span className="relative block">{type === 'date' && <CalendarDays size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#759092]" />}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] py-3 pr-3 text-sm outline-none transition focus:border-[#0d8179] ${type === 'date' ? 'pl-10' : 'pl-3'}`} /></span></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-[#dce7e6] bg-[#fbfcfc] px-3 py-3 text-sm outline-none focus:border-[#0d8179]">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-start gap-3 text-sm text-[#405e65]"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[#08ae7a]" /><span>{children}</span></label>;
}

function PhotoPicker({ field, selected, onSelect, onRemove }: { field: typeof photoFields[number]; selected?: PhotoFile; onSelect: (file: File) => void; onRemove: () => void }) {
  return <label className="relative flex min-h-[150px] cursor-pointer flex-col justify-end overflow-hidden rounded-2xl border border-dashed border-[#c9d9d7] bg-[#f8fbfa] p-4 transition hover:border-[#08ae7a] hover:bg-[#f1fbf7]">{selected?.file.type.startsWith('image/') && <img src={selected.preview} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />}<input type="file" accept="image/*,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelect(file); }} className="sr-only" />{selected ? <><button type="button" onClick={(event) => { event.preventDefault(); onRemove(); }} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-[#45656a] shadow-sm"><X size={14} /></button><span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[#08ae7a] text-white"><CheckCircle2 size={18} /></span><span className="relative mt-3 text-sm font-semibold">{field.label} added</span><span className="relative mt-1 truncate text-[11px] text-[#587478]">{selected.file.name}</span></> : <><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d8179] shadow-sm"><Upload size={18} /></span><span className="mt-3 text-sm font-semibold">{field.label}</span><span className="mt-1 text-[11px] text-[#8ba0a2]">{field.hint}</span></>}</label>;
}
