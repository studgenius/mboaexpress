import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { SavedPlace } from '@/lib/types';

export function useSavedPlaces() {
  const { user } = useAuth();
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlaces = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const { data } = await supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    setPlaces((data as SavedPlace[]) ?? []);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchPlaces(); }, [fetchPlaces]);

  const addPlace = useCallback(async (label: string, address: string, type: 'home' | 'work' | 'other' = 'other', landmark?: string, note?: string) => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('saved_places')
      .insert({ user_id: user.id, label, address, type, landmark: landmark?.trim() || null, note: note?.trim() || null })
      .select('*')
      .single();
    if (data) setPlaces((prev) => [...prev, data as SavedPlace]);
  }, [user?.id]);

  const removePlace = useCallback(async (id: string) => {
    await supabase.from('saved_places').delete().eq('id', id);
    setPlaces((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { places, loading, addPlace, removePlace, refetch: fetchPlaces };
}
