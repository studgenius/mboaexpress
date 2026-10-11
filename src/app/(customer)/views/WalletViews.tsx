import { useState, useEffect } from 'react';
import { Wallet, Plus, Smartphone, Banknote, ArrowDownLeft, ArrowUpRight, ShieldCheck, Loader2, X, Check, Phone, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCountry } from '@/lib/country-config';
import { PageHeader, Card, EmptyState, Spinner } from '@/components/ui';
import type { WalletTransaction } from '@/lib/types';

function methodStyle(method: string): { dot: string; icon: React.ReactNode } {
  const m = method.toLowerCase();
  if (m.includes('mtn')) return { dot: 'bg-[#ffcc00]', icon: <Smartphone size={16} /> };
  if (m.includes('orange')) return { dot: 'bg-[#ff7900]', icon: <Smartphone size={16} /> };
  if (m.includes('wave')) return { dot: 'bg-[#1dc4e9]', icon: <Smartphone size={16} /> };
  if (m.includes('airtel')) return { dot: 'bg-[#e40000]', icon: <Smartphone size={16} /> };
  if (m.includes('moov')) return { dot: 'bg-[#0a5cb8]', icon: <Smartphone size={16} /> };
  if (m.includes('free')) return { dot: 'bg-[#c8102e]', icon: <Smartphone size={16} /> };
  if (m.includes('wallet')) return { dot: 'bg-[#0d7770]', icon: <Wallet size={16} /> };
  if (m.includes('cash')) return { dot: 'bg-[#5a7d5a]', icon: <Banknote size={16} /> };
  return { dot: 'bg-[#9aabad]', icon: <Smartphone size={16} /> };
}

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 25000];

export function WalletCenter() {
  const { profile, refreshProfile } = useAuth();
  const { country, formatCurrency } = useCountry();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const balance = profile?.wallet_balance ?? 0;
  const mobileMethods = country.payment_methods.filter((m) => !/cash|wallet/i.test(m));

  const loadTransactions = async () => {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) setTransactions(data as WalletTransaction[]);
    setLoading(false);
  };

  useEffect(() => { loadTransactions(); }, []);

  const onTopUpDone = async () => {
    await refreshProfile();
    await loadTransactions();
    setTopUpOpen(false);
  };

  const methodCards = [
    ...mobileMethods.map((m) => ({ name: m, desc: 'Pay instantly from your mobile money account' })),
    { name: 'Njanga Wallet', desc: 'Prepaid balance — top up once, ride cash-free' },
    { name: 'Cash', desc: 'Pay your driver directly, tell us your note for change' },
  ];

  return (
    <>
      <PageHeader title="Wallet & payments" subtitle="Top up your Njanga Wallet, manage how you pay, and follow every transaction." />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {/* Balance hero */}
          <Card className="overflow-hidden p-0">
            <div className="relative bg-[#0d2f35] p-6 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#e9f55b]/10" />
              <div className="pointer-events-none absolute -bottom-16 -right-4 h-48 w-48 rounded-full bg-[#0d7770]/25" />
              <div className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#a8c5c6]"><Wallet size={14} /> Njanga Wallet</div>
              <p className="relative mt-3 font-display text-4xl font-semibold tracking-tight">{formatCurrency(balance)}</p>
              <p className="relative mt-1 text-xs text-[#8fb0b2]">Available balance</p>
              <button onClick={() => setTopUpOpen(true)} className="relative mt-5 flex items-center gap-2 rounded-xl bg-[#e9f55b] px-4 py-2.5 text-sm font-semibold text-[#0d2f35] transition hover:bg-[#dfec4b]"><Plus size={16} /> Add money</button>
            </div>
          </Card>

          {/* Payment methods */}
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9aabad]">Payment methods</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {methodCards.map((m) => {
                const s = methodStyle(m.name);
                return (
                  <div key={m.name} className="flex items-start gap-3 rounded-2xl border border-[#e1e9e9] bg-white p-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${s.dot}`}>{s.icon}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0d2f35]">{m.name}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[#8ba0a2]">{m.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[#8ba0a2]"><ShieldCheck size={13} className="text-[#0d8179]" /> Every payment is protected. Your wallet balance can only change through a confirmed transaction.</div>
          </div>
        </div>

        {/* Transactions */}
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#9aabad]">Recent activity</h3>
          <Card className="p-0">
            {loading ? (
              <div className="p-8"><Spinner /></div>
            ) : transactions.length === 0 ? (
              <div className="p-6"><EmptyState icon={<Wallet size={22} />} title="No transactions yet" subtitle="Top up your wallet to see your activity here." /></div>
            ) : (
              <ul className="divide-y divide-[#eef2f2]">
                {transactions.map((t) => {
                  const credit = t.direction === 'credit';
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${credit ? 'bg-[#eaf6ee] text-[#3f8f5f]' : 'bg-[#fdeeea] text-[#c9483a]'}`}>
                        {credit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#0d2f35]">{t.description ?? (credit ? 'Top-up' : 'Payment')}</p>
                        <p className="text-[11px] text-[#9aabad]">{new Date(t.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold ${credit ? 'text-[#3f8f5f]' : 'text-[#c9483a]'}`}>{credit ? '+' : '−'}{formatCurrency(t.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {topUpOpen && <TopUpDrawer methods={mobileMethods} onClose={() => setTopUpOpen(false)} onDone={onTopUpDone} formatCurrency={formatCurrency} />}
    </>
  );
}

function TopUpDrawer({ methods, onClose, onDone, formatCurrency }: { methods: string[]; onClose: () => void; onDone: () => void; formatCurrency: (v: number) => string }) {
  const { country } = useCountry();
  const [amount, setAmount] = useState<number>(2000);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState(methods[0] ?? 'MTN MoMo');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'form' | 'processing' | 'done'>('form');
  const [error, setError] = useState('');

  const effectiveAmount = custom ? parseInt(custom, 10) || 0 : amount;
  const phoneValid = phone.replace(/\D/g, '').length >= 8;
  const canConfirm = effectiveAmount >= 100 && effectiveAmount <= 1000000 && phoneValid && method;

  const confirm = async () => {
    if (!canConfirm) return;
    setError('');
    setStep('processing');
    const reference = `${method.replace(/\s+/g, '').toUpperCase().slice(0, 4)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { error: rpcError } = await supabase.rpc('wallet_topup', { p_amount: effectiveAmount, p_method: method, p_reference: reference });
    if (rpcError) {
      console.error('wallet topup failed', rpcError);
      setError('We could not confirm your top-up. Please check the amount and try again.');
      setStep('form');
      return;
    }
    setStep('done');
    window.setTimeout(onDone, 1400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#eef2f2] px-5 py-4">
          <h3 className="font-display text-lg font-semibold text-[#0d2f35]">Add money</h3>
          <button onClick={onClose} className="text-[#9aabad] hover:text-[#0d2f35]"><X size={20} /></button>
        </div>

        {step === 'done' ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf6ee] text-[#3f8f5f]"><Check size={28} strokeWidth={3} /></div>
            <p className="text-base font-semibold text-[#0d2f35]">{formatCurrency(effectiveAmount)} added</p>
            <p className="text-sm text-[#8ba0a2]">Your Njanga Wallet has been topped up successfully.</p>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Amount</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((a) => (
                  <button key={a} onClick={() => { setAmount(a); setCustom(''); }} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold transition ${!custom && amount === a ? 'border-[#0d8179] bg-[#f0faf7] text-[#0d2f35]' : 'border-[#e1e9e9] text-[#45656a] hover:border-[#9fbdbc]'}`}>{formatCurrency(a)}</button>
                ))}
              </div>
              <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="Or enter another amount" className="mt-2 w-full rounded-xl border border-[#dce7e6] px-3 py-2.5 text-sm outline-none focus:border-[#0d8179]" />
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Pay with</p>
              <div className="space-y-2">
                {methods.map((m) => {
                  const s = methodStyle(m);
                  return (
                    <button key={m} onClick={() => setMethod(m)} className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${method === m ? 'border-[#0d8179] bg-[#f0faf7]' : 'border-[#e1e9e9] hover:border-[#9fbdbc]'}`}>
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${s.dot}`}>{s.icon}</span>
                      <span className="flex-1 text-sm font-semibold text-[#0d2f35]">{m}</span>
                      {method === m && <Check size={16} className="text-[#0d7770]" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#9aabad]">Mobile money number</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#dce7e6] px-3 focus-within:border-[#0d8179]">
                <Phone size={15} className="text-[#9aabad]" />
                <span className="text-sm font-medium text-[#45656a]">{country.dial_code}</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ''))} inputMode="tel" placeholder="6 12 34 56 78" className="flex-1 bg-transparent py-2.5 text-sm outline-none" />
              </div>
            </div>

            {error && <p className="rounded-lg bg-[#fdeeea] px-3 py-2 text-xs font-medium text-[#c9483a]">{error}</p>}

            <button onClick={confirm} disabled={!canConfirm || step === 'processing'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d2f35] py-3.5 text-sm font-semibold text-white transition hover:bg-[#174850] disabled:opacity-50">
              {step === 'processing' ? <><Loader2 size={16} className="animate-spin" /> Confirming with {method}...</> : <>Add {effectiveAmount >= 100 ? formatCurrency(effectiveAmount) : 'money'} <ChevronRight size={16} /></>}
            </button>
            <p className="text-center text-[10px] text-[#9aabad]">You will approve this payment on your phone via {method}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
