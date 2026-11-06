import { useState, useEffect, useRef } from 'react';
import { Menu, Bell, ChevronDown, LogOut, UserRound, Settings, Shield, Cpu, Building2, X } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { CountryProvider, useCountry } from '@/lib/country-config';
import { Sidebar } from '@/components/Sidebar';
import Login from '@/components/Login';
import { CustomerHome, BookRide, FindCoRides, TripHistory } from '@/components/CustomerViews';
import { ChannelBooking } from '@/components/ChannelBooking';
import { WalletCenter } from '@/components/WalletViews';
import { NjangaCircle } from '@/components/NjangaCircle';
import { WeatherTrafficChip } from '@/components/WeatherTrafficChip';
import { DriverHome, DriverEarnings, DriverWallet, DriverHourlyRates, DriverExtensions, DriverMessages, DriverTripHistory, DriverRatings, DriverNavigation } from '@/components/DriverViews';
import { OwnerHome, MyCoRides, CreateCoRide, OwnerBookings } from '@/components/OwnerViews';
import { Profile, SafetyCenter, Support, SettingsView, Promotions, ComplaintsView, AiComplaintRouter } from '@/components/SharedViews';
import { ActiveJourney, TopDrivers } from '@/components/JourneyViews';
import { AdminHome, AdminDrivers, AdminPassengers, AdminTrips, AdminPricing, AdminComplaints, AdminVerification, AdminPromotions, AdminAnalytics } from '@/components/AdminViews';
import { SiemDashboard, AiSecurityScanner } from '@/components/SecurityViews';
import DriverRegistration from '@/components/DriverRegistration';
import ProviderOnboarding, { ProviderSafetyCenter, ProviderQuality } from '@/components/ProviderOnboarding';
import { Spinner } from '@/components/ui';

function Dashboard() {
  const { profile, signOut } = useAuth();
  const [activeView, setActiveView] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; title: string; desc: string; time: string; read: boolean }[]>([]);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    // Generate contextual notifications based on role
    const baseNotifs = [
      { id: '1', title: 'Welcome to Njanga', desc: 'Your account is set up and ready to go.', time: '2m', read: false },
      { id: '2', title: 'Safety reminder', desc: 'Always verify your driver before starting a ride.', time: '1h', read: false },
      { id: '3', title: 'New features available', desc: 'Check out the new language selector and notification settings.', time: '3h', read: true },
    ];
    if (profile?.role === 'admin') {
      baseNotifs.unshift(
        { id: 'a1', title: 'SIEM Alert', desc: '2 critical security events detected. Review now.', time: '5m', read: false },
        { id: 'a2', title: 'AI Sentinel', desc: 'Last scan found 5 anomalies. 1 user isolated.', time: '20m', read: false },
      );
    }
    if (profile?.role === 'driver') {
      baseNotifs.unshift(
        { id: 'd1', title: 'New ride request', desc: 'A passenger nearby needs a ride to Bastos.', time: '1m', read: false },
        { id: 'd2', title: 'Earnings update', desc: 'You earned 12,500 XAF today.', time: '30m', read: false },
      );
    }
    setNotifications(baseNotifs);
  }, [profile]);

  if (!profile) return <Spinner />;

  const role = profile.role;
  const unreadCount = notifications.filter((n) => !n.read).length;

  const renderView = () => {
    switch (activeView) {
      case 'home': return role === 'customer' ? <CustomerHome onNavigate={setActiveView} /> : role === 'driver' ? <DriverHome onNavigate={setActiveView} /> : role === 'admin' ? <AdminHome /> : <OwnerHome onNavigate={setActiveView} />;
      case 'book': return <BookRide onNavigate={setActiveView} />;
      case 'journey': return <ActiveJourney onNavigate={setActiveView} />;
      case 'topdrivers': return <TopDrivers />;
      case 'coride': return <FindCoRides />;
      case 'channels': return <ChannelBooking onNavigate={setActiveView} />;
      case 'wallet': return role === 'driver' ? <DriverWallet /> : <WalletCenter />;
      case 'circle': return <NjangaCircle />;
      case 'history': return <TripHistory />;
      case 'promotions': return <Promotions />;
      case 'requests': return <DriverHome onNavigate={setActiveView} />;
      case 'navigation': return <DriverNavigation />;
      case 'earnings': return <DriverEarnings />;
      case 'rates': return <DriverHourlyRates />;
      case 'extensions': return <DriverExtensions />;
      case 'messages': return <DriverMessages />;
      case 'dhistory': return <DriverTripHistory />;
      case 'ratings': return <DriverRatings />;
      case 'application': return <DriverRegistration />;
      case 'onboarding': return <ProviderOnboarding />;
      case 'psafety': return <ProviderSafetyCenter />;
      case 'pquality': return <ProviderQuality />;
      case 'corides': return <MyCoRides />;
      case 'create': return <CreateCoRide />;
      case 'bookings': return <OwnerBookings />;
      case 'adrivers': return <AdminDrivers />;
      case 'apassengers': return <AdminPassengers />;
      case 'atrips': return <AdminTrips />;
      case 'apricing': return <AdminPricing />;
      case 'acomplaints': return <AdminComplaints />;
      case 'averification': return <AdminVerification />;
      case 'apromotions': return <AdminPromotions />;
      case 'aanalytics': return <AdminAnalytics />;
      case 'siem': return <SiemDashboard />;
      case 'aiscanner': return <AiSecurityScanner />;
      case 'complaintai': return <AiComplaintRouter />;
      case 'profile': return <Profile />;
      case 'safety': return <SafetyCenter onNavigate={setActiveView} />;
      case 'support': return <Support />;
      case 'complaints': return <ComplaintsView />;
      case 'settings': return <SettingsView />;
      default: return role === 'customer' ? <CustomerHome onNavigate={setActiveView} /> : role === 'driver' ? <DriverHome onNavigate={setActiveView} /> : role === 'admin' ? <AdminHome /> : <OwnerHome onNavigate={setActiveView} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f9] text-[#102b32]">
      <Sidebar activeView={activeView} onNavigate={(v) => { setActiveView(v); setMenuOpen(false); }} menuOpen={menuOpen} setMenuOpen={setMenuOpen} onSignOut={signOut} />
      {menuOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)} />}
      <main className="lg:ml-[248px]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e1e9e9] bg-white/80 px-4 backdrop-blur-md sm:h-[78px] sm:px-8 lg:px-10">
          <div className="flex items-center gap-4">
            <button className="rounded-lg p-2 hover:bg-[#f0f4f4] lg:hidden" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
            <div>
              <p className="hidden text-xs font-medium text-[#759092] sm:block">{new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <h1 className="mt-0.5 font-display text-base font-semibold tracking-tight capitalize sm:text-xl">{activeView === 'home' ? (role === 'customer' ? 'Home' : 'Dashboard') : activeView.replace(/([A-Z])/g, ' $1').trim()}</h1>
            </div>
            <WeatherTrafficChip />
          </div>
          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div ref={notifRef} className="relative">
              <button onClick={() => setNotifOpen(!notifOpen)} className="relative rounded-xl border border-[#e1e9e9] p-2.5 text-[#45656a] hover:bg-[#f5f8f8]">
                <Bell size={18} />
                {unreadCount > 0 && <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef754d] px-1 text-[9px] font-bold text-white">{unreadCount}</span>}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-[#e1e9e9] bg-white shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[#edf1f1] p-4">
                    <p className="text-sm font-semibold">Notifications</p>
                    <button onClick={() => setNotifOpen(false)} className="text-[#9aabad] hover:text-[#45656a]"><X size={16} /></button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map((n) => (
                      <div key={n.id} className={`flex items-start gap-3 border-b border-[#edf1f1] p-4 transition hover:bg-[#f5f8f8] ${!n.read ? 'bg-[#f0faf7]' : ''}`}>
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0d7770]" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{n.title}</p>
                          <p className="mt-0.5 text-xs text-[#759092]">{n.desc}</p>
                          <p className="mt-1 text-[10px] text-[#9aabad]">{n.time} ago</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setActiveView('settings'); setNotifOpen(false); }} className="w-full border-t border-[#edf1f1] p-3 text-xs font-semibold text-[#0d7770] hover:bg-[#f5f8f8]">Manage notification preferences</button>
                </div>
              )}
            </div>

            <div className="h-8 w-px bg-[#e1e9e9]" />

            {/* User Dropdown */}
            <div ref={dropdownRef} className="relative">
              <button onClick={() => setDropdownOpen(!dropdownOpen)} className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 hover:bg-[#f5f8f8]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d7e9e6] text-xs font-semibold text-[#0d5a59]">{profile.full_name?.charAt(0).toUpperCase() ?? 'U'}</span>
                <span className="hidden text-left sm:block"><span className="block text-xs font-semibold">{profile.full_name}</span><span className="block text-[10px] capitalize text-[#759092]">{role}</span></span>
                <ChevronDown size={15} className={`text-[#759092] transition ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[#e1e9e9] bg-white shadow-2xl">
                  <div className="border-b border-[#edf1f1] p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d7e9e6] text-sm font-semibold text-[#0d5a59]">{profile.full_name?.charAt(0).toUpperCase() ?? 'U'}</span>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{profile.full_name}</p><p className="text-[10px] capitalize text-[#759092]">{role}</p></div>
                    </div>
                  </div>
                  <div className="p-2">
                    <button onClick={() => { setActiveView('profile'); setDropdownOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#45656a] hover:bg-[#f5f8f8]"><UserRound size={16} /> Profile</button>
                    <button onClick={() => { setActiveView('settings'); setDropdownOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#45656a] hover:bg-[#f5f8f8]"><Settings size={16} /> Settings</button>
                    {role === 'admin' && (
                      <>
                        <button onClick={() => { setActiveView('siem'); setDropdownOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#45656a] hover:bg-[#f5f8f8]"><Shield size={16} /> SIEM Security</button>
                        <button onClick={() => { setActiveView('aiscanner'); setDropdownOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#45656a] hover:bg-[#f5f8f8]"><Cpu size={16} /> AI Security Scanner</button>
                      </>
                    )}
                    <button onClick={() => { setActiveView('complaintai'); setDropdownOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#45656a] hover:bg-[#f5f8f8]"><Building2 size={16} /> AI Complaint Router</button>
                    <div className="my-1 h-px bg-[#edf1f1]" />
                    <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"><LogOut size={16} /> Sign out</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1450px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {renderView()}
        </div>
      </main>
    </div>
  );
}

function AppInner() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f6f8f9]"><Spinner /></div>;
  if (!user) return <Login />;
  return <Dashboard />;
}

function App() {
  return (
    <AuthProvider>
      <CountryProvider>
        <AppInner />
      </CountryProvider>
    </AuthProvider>
  );
}

export default App;
