// Map colours shared by the fruit, festival and plan pages. Each is 3:1 or better on the land colour.
export const FRUIT_COLORS = {
  Strawberry: '#d12f4a', Cherry: '#8a1538', Peach: '#c63f78', Blueberry: '#2f5fa8', Grape: '#5b3a9c',
  'Japanese Pear': '#5d7a1f', Apple: '#7f1d12', Chestnut: '#6b4a2b', Persimmon: '#c2560f',
  'Mandarin Orange': '#9a6a00', Melon: '#2f7d74', Loquat: '#a8740a',
};

export const FESTIVAL_TYPES = {
  fireworks: { label: 'Fireworks', plural: 'Fireworks', color: '#b8461b' },
  matsuri: { label: 'Matsuri', plural: 'Matsuri', color: '#8f1d3a' },
  winter: { label: 'Winter festival', plural: 'Winter festivals', color: '#2c5a7a' },
};

// Phase buckets from plan-model.js: before, starting, opening or colouring, peak, falling, over.
export const PHASES = {
  koyo: { words: ['Still green', 'Starting to turn', 'Colouring', 'Peak colour', 'Leaves falling', 'Bare'], colors: ['#5c7a3a', '#9a7a10', '#c4561a', '#a3231b', '#7d5537', '#857c73'] },
  sakura: { words: ['Buds closed', 'Buds swelling', 'Opening', 'Full bloom', 'Petals falling', 'In leaf'], colors: ['#7d6f66', '#a8687f', '#c4507d', '#b4325a', '#a87590', '#5f7f45'] },
};
