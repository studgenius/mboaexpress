import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export function StatCard({ label, value, suffix, change, trend, icon, tint }: { label: string; value: string; suffix?: string; change: string; trend: 'up' | 'down'; icon: React.ReactNode; tint: string }) {
  const colors: Record<string, string> = { lime: 'bg-[#f0f6ca] text-[#627319]', teal: 'bg-[#d9f1ec] text-[#0d7770]', orange: 'bg-[#fff0e5] text-[#bd6337]', blue: 'bg-[#e1eff6] text-[#37718b]' };
  return (
    <div className="rounded-2xl border border-[#e1e9e9] bg-white p-5 shadow-[0_3px_14px_rgba(20,60,65,0.03)]">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[#759092]">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors[tint]}`}>{icon}</span>
      </div>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-[27px] font-semibold tracking-tight">{value}</span>
        {suffix && <span className="text-[11px] font-semibold text-[#759092]">{suffix}</span>}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold">
        <span className="text-[#15947c]">{trend === 'up' ? <ArrowUpRight size={13} className="inline" /> : <ArrowDownRight size={13} className="inline" />}{change}</span>
        <span className="font-normal text-[#9aabad]">vs last week</span>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h2 className="font-display text-3xl font-semibold tracking-[-0.04em] sm:text-[34px]">{title}</h2>
        <p className="mt-1 text-sm text-[#759092]">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#e1e9e9] bg-white ${className}`}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[#edf1f1] px-5 py-4 sm:px-6">
      <div>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-[#8ba0a2]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f5f8f8] text-[#9aabad]">{icon}</div>
      <p className="text-sm font-semibold text-[#45656a]">{title}</p>
      <p className="mt-1 text-xs text-[#9aabad]">{subtitle}</p>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d9e8e5] border-t-[#0d8179]" />
    </div>
  );
}
