export const paths = {
  plus: 'M12 5v14M5 12h14',
  book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3',
  calendar: 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h1M15 14h1M8 17h1',
  image: 'M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M15 8h.01',
  sparkles: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  chart: 'M4 20h17M7 17V9M12 17V4M17 17v-6',
  chevron: 'M9 5l7 7-7 7',
  search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  pin: 'M8 3h8l-1 7 4 4v2H5v-2l4-4zM12 16v6',
  history: 'M3 5v5h5M3 10a9 9 0 1 1 2 8M12 7v6l4 2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sort: 'M6 4v16M3 17l3 3 3-3M12 5h9M12 10h6M12 15h3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  quote: 'M4 6h6v7H4zM4 13c0 4 3 5 5 5M14 6h6v7h-6zM14 13c0 4 3 5 5 5',
  eraser: 'M3 14l9-10 9 8-8 9H9zM8 9l9 8M13 21h9',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  indent: 'M3 5h18M12 10h9M12 15h9M3 20h18M3 10l4 3-4 3',
  template: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h4',
  tag: 'M3 3h8l10 10-8 8L3 11zM7 7h.01',
  help: 'M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  close: 'M5 5l14 14M5 19L19 5',
  'pin-location': 'M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  lock: 'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
export function icons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
}
