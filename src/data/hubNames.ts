/**
 * hubNames.ts — Curated catalog of hub names drawn from space history.
 *
 * Used by the hub name generation system to auto-suggest names for
 * newly established outposts and stations.
 *
 * @module data/hubNames
 */

/** Pool of candidate hub names from space history. */
export const HUB_NAME_POOL: readonly string[] = Object.freeze([
  // --- Missions ---
  'Apollo',
  'Gemini',
  'Vostok',
  'Artemis',
  'Pioneer',
  'Voyager',
  'Mercury',
  'Viking',
  'Cassini',
  'Rosetta',
  'Juno',
  'Horizon',
  'Discovery',
  'Endeavour',
  'Challenger',
  'Columbia',
  'Surveyor',
  'Mariner',
  'Ranger',
  'Luna',
  'Venera',
  'Hayabusa',
  'Dawn',
  'Messenger',
  'Magellan',
  'Galileo',
  'Ulysses',
  'Stardust',
  'Genesis',

  // --- Rockets ---
  'Saturn',
  'Falcon',
  'Soyuz',
  'Atlas',
  'Titan',
  'Delta',
  'Ariane',
  'Vega',
  'Proton',
  'Energia',
  'Electron',
  'Antares',
  'Vulcan',
  'Starship',
  'Angara',
  'Diamant',
  'Europa',
  'Scout',
  'Minotaur',

  // --- Figures ---
  'Gagarin',
  'Glenn',
  'Ride',
  'Tereshkova',
  'Armstrong',
  'Aldrin',
  'Shepard',
  'Leonov',
  'Yang',
  'Chawla',
  'Jemison',
  'Hubble',
  'Kepler',
  'Tsiolkovsky',
  'Goddard',
  'Korolev',
  'Oberth',
  'Copernicus',
  'Tycho',
  'Collins',
  'Lovell',
  'Cernan',
  'Bean',
  'Conrad',
  'Schmitt',

  // --- Stations ---
  'Mir',
  'Skylab',
  'Tiangong',
  'Salyut',
  'Freedom',
  'Unity',
  'Harmony',
  'Destiny',
  'Zarya',
  'Zvezda',
  'Kibo',
  'Columbus',
]);

/** Type alias for the hub name pool. */
export type HubNamePool = typeof HUB_NAME_POOL;
