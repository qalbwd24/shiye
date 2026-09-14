// Shuffle once per browsing round. Keep hidden legacy entries out of recollections.
export function memoryDeck(entries, categories = [], random = Math.random) {
  const deck = entries
    .filter(
      (e) =>
        !e.deleted &&
        !e.draft &&
        !(e.hidden === undefined ? e.legacy?.isHidden : e.hidden) &&
        (!categories.length || categories.includes(e.category)),
    )
    .map((e) => e.id);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
