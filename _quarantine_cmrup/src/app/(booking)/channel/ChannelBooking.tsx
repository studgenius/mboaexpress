import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Hash, Phone, Bike, CarFront, ShieldCheck, Sparkles, Route, Signal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCountry } from '@/lib/country-config';
import { PageHeader, Card } from '@/components/ui';

interface ParsedTrip {
  pickup: string;
  destination: string;
  vehicle?: 'Car' | 'Moto';
}

interface ChatMessage {
  id: number;
  from: 'njanga' | 'user';
  text: string;
  options?: { label: string; sub: string; vehicle: 'Car' | 'Moto' }[];
  trackAction?: boolean;
}

function parseTrip(text: string): ParsedTrip | null {
  const t = text.trim();
  const m = t.match(/from\s+(.+?)\s+to\s+(.+)/i) || t.match(/^(.+?)\s+to\s+(.+)$/i);
  if (!m) return null;
  let pickup = m[1].trim();
  const destination = m[2].trim().replace(/[.?!]+$/, '').trim();
  pickup = pickup.replace(/^(i\s+want|i\s+need|book|get\s+me|please|hi|hello)\b/i, '').trim();
  pickup = pickup.replace(/^(a|an|the)\s+/i, '').replace(/^(car|moto|ride|taxi|bike|okada|voiture)\s+/i, '').trim();
  const vehicle = /\b(moto|bike|okada)\b/i.test(t) ? 'Moto' : /\b(car|taxi|voiture)\b/i.test(t) ? 'Car' : undefined;
  if (!pickup || !destination) return null;
  return { pickup, destination, vehicle };
}

let msgId = 0;
const nextId = () => ++msgId;

export function ChannelBooking({ onNavigate }: { onNavigate: (view: string) => void }) {
  const { user } = useAuth();
  const { country, formatCurrency } = useCountry();
  const paymentMethod = country.payment_methods[0] ?? 'Cash';

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), from: 'njanga', text: `Hi! I'm Njanga. Tell me your trip in one line, like:\n"Car from Bonamoussadi to Akwa".` },
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<ParsedTrip | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const push = (msg: Omit<ChatMessage, 'id'>) => setMessages((prev) => [...prev, { ...msg, id: nextId() }]);

  const offer = (trip: ParsedTrip) => {
    setPending(trip);
    push({
      from: 'njanga',
      text: `${trip.pickup} → ${trip.destination}\nHere are your options:\n\n🚗 Car — ~${formatCurrency(country.base_fare_car)}\n🏍 Moto — ~${formatCurrency(country.base_fare_moto)}\n\nReply 1 for Car, 2 for Moto.`,
      options: [
        { label: 'Car', sub: `~${formatCurrency(country.base_fare_car)}`, vehicle: 'Car' },
        { label: 'Moto', sub: `~${formatCurrency(country.base_fare_moto)}`, vehicle: 'Moto' },
      ],
    });
  };

  const book = async (trip: ParsedTrip, vehicle: 'Car' | 'Moto') => {
    setBusy(true);
    const fare = vehicle === 'Moto' ? country.base_fare_moto : country.base_fare_car;
    const { error } = await supabase.from('ride_requests').insert({
      pickup: trip.pickup, destination: trip.destination, vehicle_type: vehicle,
      payment_method: paymentMethod, fare, status: 'searching', user_id: user?.id, service_type: 'standard',
      passenger_count: 1, pickup_note: 'Booked via WhatsApp channel',
    });
    setBusy(false);
    setPending(null);
    if (error) {
      push({ from: 'njanga', text: 'Sorry, I could not send that request. Please try again in a moment.' });
      return;
    }
    push({
      from: 'njanga',
      text: `Done! Your ${vehicle} is booked from ${trip.pickup} to ${trip.destination}.\nPayment: ${paymentMethod} · Fare ~${formatCurrency(fare)}.\nWe're finding your driver now. 🚗`,
      trackAction: true,
    });
  };

  const selectVehicle = (vehicle: 'Car' | 'Moto') => {
    if (!pending || busy) return;
    push({ from: 'user', text: vehicle === 'Car' ? '1' : '2' });
    book(pending, vehicle);
  };

  const handleSend = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    push({ from: 'user', text });
    setInput('');

    if (pending) {
      if (/^1$|^car$|voiture/i.test(text)) { book(pending, 'Car'); return; }
      if (/^2$|^moto$|bike|okada/i.test(text)) { book(pending, 'Moto'); return; }
    }

    const trip = parseTrip(text);
    if (!trip) {
      push({ from: 'njanga', text: `I didn't catch the route. Try "from <pickup> to <destination>" — for example "from Bonamoussadi to Akwa".` });
      return;
    }
    if (trip.vehicle) {
      push({ from: 'user', text: trip.vehicle === 'Car' ? '1' : '2' });
      book(trip, trip.vehicle);
      return;
    }
    offer(trip);
  };

  const suggestions = ['Car from Bonamoussadi to Akwa', 'Moto from Mvan to Bastos', 'from Bonapriso to Deido'];

  return (
    <>
      <PageHeader title="Book by WhatsApp, USSD or phone" subtitle="No app? No problem. Reserve a ride the way that suits you — chat, dial code or a quick call." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* WhatsApp-style chat */}
        <Card className="flex h-[560px] flex-col overflow-hidden p-0">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25d366]"><MessageCircle size={20} /></div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Njanga on WhatsApp</p>
              <p className="text-[11px] text-white/70">Typically replies instantly</p>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold"><Sparkles size={11} /> AI</span>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-[#e5ddd5] p-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${m.from === 'user' ? 'rounded-br-md bg-[#dcf8c6] text-[#0d2f35]' : 'rounded-bl-md bg-white text-[#233]'}`}>
                  {m.text}
                  {m.options && (
                    <div className="mt-2.5 flex gap-2">
                      {m.options.map((opt) => (
                        <button
                          key={opt.vehicle}
                          onClick={() => selectVehicle(opt.vehicle)}
                          disabled={busy || !pending}
                          className="flex flex-1 items-center gap-2 rounded-xl border border-[#c9e6b8] bg-[#f2fbe9] px-3 py-2 text-left transition hover:border-[#25d366] disabled:opacity-50"
                        >
                          {opt.vehicle === 'Moto' ? <Bike size={16} className="text-[#be653e]" /> : <CarFront size={16} className="text-[#0d7770]" />}
                          <span><span className="block text-xs font-semibold text-[#0d2f35]">{opt.label}</span><span className="block text-[10px] text-[#6b8a6b]">{opt.sub}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {m.trackAction && (
                    <button onClick={() => onNavigate('journey')} className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#075e54] py-2 text-xs font-semibold text-white transition hover:bg-[#0a7166]"><Route size={14} /> Track my ride</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[#e1e9e9] bg-white px-3 py-2.5">
            <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
              {suggestions.map((s) => (
                <button key={s} onClick={() => handleSend(s)} disabled={busy} className="shrink-0 rounded-full border border-[#dce7e6] bg-[#f7faf9] px-3 py-1.5 text-[11px] font-medium text-[#45656a] transition hover:border-[#25d366] disabled:opacity-50">{s}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                placeholder="Type your trip, e.g. Car from A to B"
                className="flex-1 rounded-full border border-[#dce7e6] bg-[#f7faf9] px-4 py-2.5 text-sm outline-none focus:border-[#25d366]"
              />
              <button onClick={() => handleSend()} disabled={busy || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25d366] text-white transition hover:bg-[#1fb757] disabled:opacity-50"><Send size={17} /></button>
            </div>
          </div>
        </Card>

        {/* USSD + phone */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d2f35] text-[#e9f55b]"><Hash size={18} /></div><h3 className="text-sm font-semibold text-[#0d2f35]">Book by USSD</h3></div>
            <p className="text-xs text-[#8ba0a2]">Works on any phone — no internet needed. On your keypad, dial:</p>
            <div className="my-3 rounded-xl border border-dashed border-[#c6d6d5] bg-[#f7faf9] py-3 text-center font-display text-2xl font-semibold tracking-wide text-[#0d2f35]">*126*7#</div>
            <ol className="space-y-2 text-[11px] text-[#45656a]">
              <li className="flex gap-2"><span className="font-bold text-[#0d7770]">1.</span> Choose your pickup neighbourhood</li>
              <li className="flex gap-2"><span className="font-bold text-[#0d7770]">2.</span> Choose your destination</li>
              <li className="flex gap-2"><span className="font-bold text-[#0d7770]">3.</span> Pick Car or Moto and confirm the fare</li>
              <li className="flex gap-2"><span className="font-bold text-[#0d7770]">4.</span> Get an SMS with your driver's name and plate</li>
            </ol>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#f3f6f0] px-3 py-2 text-[10px] font-medium text-[#526213]"><Signal size={13} /> Ideal for basic phones and low-data areas</div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d7770] text-white"><Phone size={18} /></div><h3 className="text-sm font-semibold text-[#0d2f35]">Book by phone call</h3></div>
            <p className="text-xs text-[#8ba0a2]">Prefer to talk? Call the Njanga voice line and an agent (or our voice assistant) books it for you.</p>
            <a href={`tel:${country.dial_code}657000000`} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3 text-sm font-semibold text-white transition hover:bg-[#174850]"><Phone size={16} /> {country.dial_code} 657 000 000</a>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[#8ba0a2]"><ShieldCheck size={13} className="text-[#0d8179]" /> Every channel is protected with Njanga Safety and driver PIN verification</div>
          </Card>
        </div>
      </div>
    </>
  );
}
