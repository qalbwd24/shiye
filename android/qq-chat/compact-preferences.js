/** Apply the user's confirmed correction once; leave other custom sizes intact. */
export function migrateCompactPreferences(previous) {
  if (!previous || previous.compactTypography023 === 1) return previous;
  const base = previous.appearance || {};
  const oldPair = (value) => value.messageFontSize === 16 && value.inputFontSize === 25;
  const roomAppearance = { ...previous.roomAppearance };
  for (const [id, override] of Object.entries(roomAppearance)) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue;
    if (
      oldPair({ ...base, ...override }) &&
      (Object.hasOwn(override, 'inputFontSize') || !oldPair(base))
    )
      roomAppearance[id] = { ...override, inputFontSize: 14 };
  }
  return {
    ...previous,
    compactTypography023: 1,
    appearance: oldPair(base) ? { ...base, inputFontSize: 14 } : base,
    roomAppearance,
  };
}
