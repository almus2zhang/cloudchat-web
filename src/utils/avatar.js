export function getInitialAvatar(name) {
  const str = (name || 'User').trim();
  const letter = (str.charAt(0) || 'U').toUpperCase();

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    ['#4f46e5', '#3730a3'], // Indigo
    ['#0284c7', '#075985'], // Sky
    ['#059669', '#065f46'], // Emerald
    ['#d97706', '#92400e'], // Amber
    ['#7c3aed', '#5b21b6'], // Violet
    ['#db2777', '#9d174d'], // Pink
    ['#2563eb', '#1e40af'], // Blue
    ['#0d9488', '#115e59']  // Teal
  ];

  const idx = Math.abs(hash) % colors.length;
  const [c1, c2] = colors[idx];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="58" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="44" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${letter}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const PRESET_AVATARS = [
  getInitialAvatar('Felix'),
  getInitialAvatar('Aria'),
  getInitialAvatar('Zack'),
  getInitialAvatar('Luna'),
  getInitialAvatar('Leo'),
  getInitialAvatar('Maya'),
  getInitialAvatar('Milo'),
  getInitialAvatar('Nova'),
  getInitialAvatar('Kira'),
  getInitialAvatar('Orion')
];
