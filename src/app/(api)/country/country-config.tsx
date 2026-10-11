import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export interface CountryConfig {
  id: string;
  code: string;
  name: string;
  dial_code: string;
  currency_code: string;
  currency_symbol: string;
  currency_locale: string;
  payment_methods: string[];
  primary_language: string;
  languages: string[];
  flag_emoji: string | null;
  base_fare_car: number;
  base_fare_moto: number;
  base_fare_moto_pro: number;
  base_fare_private_driver: number;
  base_fare_airport: number;
  per_km_car: number;
  per_km_moto: number;
  per_km_private_driver: number;
  per_km_airport: number;
  hourly_rate_moto: number;
  hourly_rate_car: number;
  daily_rate: number;
  commission_rate: number;
  is_active: boolean;
  is_default: boolean;
}

const DEFAULT_CONFIG: CountryConfig = {
  id: '',
  code: 'CM',
  name: 'Cameroon',
  dial_code: '+237',
  currency_code: 'XAF',
  currency_symbol: 'FCFA',
  currency_locale: 'fr-FR',
  payment_methods: ['MTN MoMo', 'Orange Money', 'Cash'],
  primary_language: 'fr',
  languages: ['fr', 'en'],
  flag_emoji: '🇨🇲',
  base_fare_car: 2000,
  base_fare_moto: 2400,
  base_fare_moto_pro: 3500,
  base_fare_private_driver: 7000,
  base_fare_airport: 8000,
  per_km_car: 150,
  per_km_moto: 200,
  per_km_private_driver: 500,
  per_km_airport: 400,
  hourly_rate_moto: 2500,
  hourly_rate_car: 7000,
  daily_rate: 50000,
  commission_rate: 15,
  is_active: true,
  is_default: true,
};

interface CountryContextValue {
  country: CountryConfig;
  loading: boolean;
  setCountryCode: (code: string) => void;
  formatCurrency: (value: number) => string;
}

const CountryContext = createContext<CountryContextValue>({
  country: DEFAULT_CONFIG,
  loading: true,
  setCountryCode: () => {},
  formatCurrency: (v) => `${v.toLocaleString('en-US')} XAF`,
});

const STORAGE_KEY = 'njanga_country_code';

export function CountryProvider({ children }: { children: ReactNode }) {
  const [country, setCountry] = useState<CountryConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const loadCountry = async (code: string) => {
    const { data } = await supabase
      .from('countries')
      .select('*')
      .eq('code', code)
      .single();
    if (data) {
      setCountry(data as CountryConfig);
    }
    setLoading(false);
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) || 'CM';
    loadCountry(stored);
  }, []);

  const setCountryCode = (code: string) => {
    localStorage.setItem(STORAGE_KEY, code);
    loadCountry(code);
  };

  const formatCurrency = (value: number) => {
    const formatted = new Intl.NumberFormat(country.currency_locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
    return `${formatted} ${country.currency_symbol}`;
  };

  return (
    <CountryContext.Provider value={{ country, loading, setCountryCode, formatCurrency }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  return useContext(CountryContext);
}
