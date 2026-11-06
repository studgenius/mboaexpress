import { Sparkles, Route as RouteIcon, Gauge, Leaf, Clock, Lightbulb } from 'lucide-react';
import type { JourneyInsights } from '@/lib/predictions';

const TRAFFIC_COLOR: Record<string, string> = {
  light: 'text-[#3f8f5f]',
  moderate: 'text-[#c58521]',
  heavy: 'text-[#c9483a]',
};
const TRAFFIC_DOT: Record<string, string> = {
  light: 'bg-[#3f8f5f]',
  moderate: 'bg-[#c58521]',
  heavy: 'bg-[#c9483a]',
};

export function JourneyInsightsPanel({ insights, audience }: { insights: JourneyInsights; audience: 'customer' | 'driver' }) {
  const tips = audience === 'driver' ? insights.driverTips : insights.customerTips;
  const title = audience === 'driver' ? 'AI Trip Guidance' : 'AI Journey Insights';

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e7f0f5] bg-gradient-to-br from-[#f8fbff] to-[#eef5fb]">
      <div className="flex items-center gap-2.5 bg-[#e7f0f5] px-4 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2c6f9a] text-white"><Sparkles size={15} /></div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#2c6f9a]">{title}</p>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#45656a]"><Clock size={11} /> ~{insights.durationMin} min</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9aabad]"><Gauge size={12} /> Traffic</div>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${TRAFFIC_COLOR[insights.traffic.level]}`}>
              <span className={`h-2 w-2 rounded-full ${TRAFFIC_DOT[insights.traffic.level]}`} />{insights.traffic.label}
            </p>
            <p className="mt-0.5 text-[10px] text-[#8ba0a2]">+{insights.traffic.delayMin} min on direct roads</p>
          </div>
          <div className="rounded-xl bg-white p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9aabad]"><RouteIcon size={12} /> Best route</div>
            <p className="text-sm font-semibold text-[#0d2f35]">{insights.route.name}</p>
            <p className="mt-0.5 text-[10px] text-[#8ba0a2]">{insights.route.note}</p>
          </div>
          <div className="rounded-xl bg-white p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9aabad]"><Leaf size={12} /> Emissions</div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#0d7770]"><Leaf size={13} />{insights.emissions.kg} kg CO2{insights.emissions.savedPct > 0 && <span className="rounded-full bg-[#e7f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#0d7770]">−{insights.emissions.savedPct}%</span>}</p>
            <p className="mt-0.5 text-[10px] text-[#8ba0a2]">{insights.emissions.equivalent}</p>
          </div>
        </div>
        <div className="space-y-1.5 rounded-xl bg-[#f0faf7] p-3">
          {tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-[#0d5a59]"><Lightbulb size={13} className="mt-0.5 shrink-0 text-[#0d7770]" /><span>{tip}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
