import { Navigation, LayoutDashboard, Map, Users, Bike, CarFront, Wallet, TrendingUp, Plus, Search, ShieldCheck, MessageSquare, Settings, UserRound, X, Clock3, Star, LogOut, Trophy, Route, Tag, Clock, AlertCircle, BarChart3, Shield, Cpu, Building2, Briefcase, Award, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

export interface NavItem {
  id: string;
  label: string;
  icon: typeof Map;
  badge?: string;
}

export function getNavItems(role: UserRole): { primary: NavItem[]; secondary: NavItem[] } {
  if (role === 'customer') {
    return {
      primary: [
        { id: 'home', label: 'Home', icon: LayoutDashboard },
        { id: 'book', label: 'Book a ride', icon: Map },
        { id: 'channels', label: 'WhatsApp & USSD', icon: MessageSquare },
        { id: 'journey', label: 'Active ride', icon: Route },
        { id: 'wallet', label: 'Wallet & payments', icon: Wallet },
        { id: 'coride', label: 'Find co-rides', icon: Search },
        { id: 'topdrivers', label: 'Top drivers', icon: Trophy },
        { id: 'history', label: 'Trip history', icon: Clock3 },
        { id: 'promotions', label: 'Promotions', icon: Tag },
      ],
      secondary: [
        { id: 'onboarding', label: 'Become a Provider', icon: Briefcase },
        { id: 'safety', label: 'Safety center', icon: ShieldCheck },
        { id: 'circle', label: 'Njanga Circle', icon: Users },
        { id: 'support', label: 'Support', icon: MessageSquare },
        { id: 'complaints', label: 'Complaints', icon: AlertCircle },
        { id: 'complaintai', label: 'AI Complaint Router', icon: Building2 },
        { id: 'profile', label: 'Profile', icon: UserRound },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    };
  }
  if (role === 'driver') {
    return {
      primary: [
        { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'requests', label: 'Ride requests', icon: Map, badge: '3' },
        { id: 'navigation', label: 'Navigation', icon: Navigation },
        { id: 'earnings', label: 'Earnings', icon: TrendingUp },
        { id: 'wallet', label: 'Wallet', icon: Wallet },
        { id: 'rates', label: 'Hourly rates', icon: Tag },
        { id: 'extensions', label: 'Hourly extensions', icon: Clock },
        { id: 'messages', label: 'Messages', icon: MessageSquare },
        { id: 'dhistory', label: 'Trip history', icon: Clock3 },
        { id: 'ratings', label: 'Ratings', icon: Star },
        { id: 'application', label: 'Driver application', icon: ShieldCheck },
      ],
      secondary: [
        { id: 'onboarding', label: 'Provider onboarding', icon: Briefcase },
        { id: 'psafety', label: 'Provider safety', icon: Shield },
        { id: 'pquality', label: 'Provider quality', icon: Award },
        { id: 'safety', label: 'Safety center', icon: ShieldCheck },
        { id: 'circle', label: 'Njanga Circle', icon: Users },
        { id: 'support', label: 'Support', icon: MessageSquare },
        { id: 'complaints', label: 'Complaints', icon: AlertCircle },
        { id: 'profile', label: 'Profile', icon: UserRound },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    };
  }
  if (role === 'admin') {
    return {
      primary: [
        { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'adrivers', label: 'Drivers', icon: CarFront },
        { id: 'apassengers', label: 'Passengers', icon: Users },
        { id: 'atrips', label: 'All trips', icon: Route },
        { id: 'apricing', label: 'Pricing', icon: Tag },
        { id: 'acomplaints', label: 'Complaints', icon: AlertCircle },
        { id: 'averification', label: 'Driver verification', icon: ShieldCheck },
        { id: 'apromotions', label: 'Promotions', icon: Tag },
        { id: 'aanalytics', label: 'Analytics', icon: BarChart3 },
        { id: 'siem', label: 'SIEM Security', icon: Shield },
        { id: 'aiscanner', label: 'AI Security Scanner', icon: Cpu },
      ],
      secondary: [
        { id: 'complaintai', label: 'AI Complaint Router', icon: Building2 },
        { id: 'onboarding', label: 'Provider onboarding', icon: Briefcase },
        { id: 'profile', label: 'Profile', icon: UserRound },
        { id: 'settings', label: 'Settings', icon: Settings },
      ],
    };
  }
  return {
    primary: [
      { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'corides', label: 'My co-rides', icon: CarFront },
      { id: 'create', label: 'Create co-ride', icon: Plus },
      { id: 'bookings', label: 'Bookings', icon: Users },
    ],
    secondary: [
      { id: 'safety', label: 'Safety center', icon: ShieldCheck },
      { id: 'support', label: 'Support', icon: MessageSquare },
      { id: 'profile', label: 'Profile', icon: UserRound },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  };
}

export function Sidebar({ activeView, onNavigate, menuOpen, setMenuOpen, onSignOut }: { activeView: string; onNavigate: (id: string) => void; menuOpen: boolean; setMenuOpen: (v: boolean) => void; onSignOut: () => void }) {
  const { profile } = useAuth();
  const role = profile?.role ?? 'customer';
  const { primary, secondary } = getNavItems(role);
  const roleLabel = role === 'customer' ? 'Customer' : role === 'driver' ? 'Driver' : role === 'admin' ? 'Administrator' : 'Private owner';
  const [moreOpen, setMoreOpen] = useState(false);
  const activeInSecondary = secondary.some((i) => i.id === activeView);
  const showSecondary = moreOpen || activeInSecondary;

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col overflow-y-auto bg-[#0d2f35] px-5 py-6 text-white transition-transform no-scrollbar lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e9f55b] text-[#0d2f35]"><Navigation size={19} strokeWidth={2.8} /></div>
          <span className="font-display text-[21px] font-semibold tracking-tight">Njanga</span>
        </div>
        <button onClick={() => setMenuOpen(false)} className="lg:hidden"><X size={20} /></button>
      </div>

      <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e9f55b] text-xs font-bold text-[#0d2f35]">
          {profile?.full_name?.charAt(0).toUpperCase() ?? 'U'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{profile?.full_name ?? 'User'}</p>
          <p className="text-[10px] text-[#a8c5c6]">{roleLabel}</p>
        </div>
      </div>

      <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca7a9]">Menu</p>
      <nav className="mt-3 space-y-1">
        {primary.map((item) => <NavButton key={item.id} item={item} active={activeView === item.id} onClick={() => onNavigate(item.id)} />)}
      </nav>
      <button onClick={() => setMoreOpen(!moreOpen)} className="mt-7 flex w-full items-center justify-between rounded-lg px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ca7a9] transition hover:text-[#cfe0e0]">
        <span>More</span>
        <ChevronDown size={14} className={`transition-transform ${showSecondary ? 'rotate-180' : ''}`} />
      </button>
      <nav className={`grid transition-all duration-300 ${showSecondary ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="space-y-1 overflow-hidden">
          {secondary.map((item) => <NavButton key={item.id} item={item} active={activeView === item.id} onClick={() => onNavigate(item.id)} />)}
        </div>
      </nav>

      <div className="mt-auto space-y-3 pb-20 lg:pb-0">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="flex items-center gap-2 text-xs text-[#afc4c5]"><Star size={13} className="text-[#e9f55b]" fill="currentColor" /> {profile?.rating?.toFixed(1) ?? '5.0'} rating</div>
          <div className="mt-1 text-[11px] text-[#8ca7a9]">{profile?.total_trips ?? 0} trips completed</div>
        </div>
        <button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#b0c4c5] transition hover:bg-white/[0.08] hover:text-white">
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </aside>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${active ? 'bg-[#e9f55b] font-semibold text-[#0d2f35] shadow-[0_4px_14px_rgba(233,245,91,0.25)]' : 'text-[#b0c4c5] hover:bg-white/[0.08] hover:text-white'}`}>
      <span className="flex items-center gap-3"><Icon size={18} className={active ? '' : 'text-[#8ca7a9] transition group-hover:text-white'} />{item.label}</span>
      {item.badge && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-[#0d2f35] text-white' : 'bg-white/10 text-[#d6e3e3]'}`}>{item.badge}</span>}
    </button>
  );
}

export function getRoleIcon(role: UserRole) {
  return role === 'driver' ? Bike : role === 'owner' ? CarFront : role === 'admin' ? ShieldCheck : Users;
}
