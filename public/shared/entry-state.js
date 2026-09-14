export const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const ordinal = (value) => {
  const d = new Date(value);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
};
export const isHidden = (e) => (e.hidden === undefined ? !!e.legacy?.isHidden : !!e.hidden);
