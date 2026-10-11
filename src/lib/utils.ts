export const formatXaf = (value: number) => `${value.toLocaleString('en-US')} XAF`;

export const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
};

export const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

export const timeUntil = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Departed';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `in ${hrs} hr ${mins % 60} min`;
};
