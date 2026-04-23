/**
 * environment.ts — Per-body environmental hazards for airless (and other)
 * bodies.  The weather system already handles atmospheric wind/thermal on
 * bodies with an atmosphere (Earth, Mars, Venus, Titan).  This module
 * exposes body-level hazards that are present regardless of atmosphere —
 * radiation, surface thermal swings, dust, microgravity — so the hub UI
 * has something meaningful to show at a Mun base or an asteroid outpost.
 *
 * Hazard severity is qualitative:
 *   - 'low'     — noteworthy but minor operational impact
 *   - 'medium'  — planning consideration; extended crew exposure risky
 *   - 'high'    — significant operational constraint
 *   - 'extreme' — mission-critical; avoid or mitigate aggressively
 *
 * This module is pure data + lookup — no DOM, no side effects.
 *
 * @module core/environment
 */

export type HazardSeverity = 'low' | 'medium' | 'high' | 'extreme';

export interface BodyHazard {
  /** Short label (e.g. 'Radiation', 'Thermal'). */
  label: string;
  /** Qualitative severity. */
  severity: HazardSeverity;
  /** Brief note for the player (shown as a tooltip / supporting line). */
  note: string;
}

/**
 * Per-body environmental hazards.  Bodies not listed fall back to an
 * empty list — the UI then shows a neutral "No significant hazards" line.
 */
const BODY_HAZARDS: Readonly<Record<string, readonly BodyHazard[]>> = Object.freeze({
  EARTH: Object.freeze([]),

  MOON: Object.freeze([
    { label: 'Radiation', severity: 'medium' as HazardSeverity,
      note: 'No atmosphere to deflect solar + cosmic radiation — crew exposure accumulates.' },
    { label: 'Thermal', severity: 'medium' as HazardSeverity,
      note: 'Surface temperature swings ~250°C between lunar day and night.' },
    { label: 'Regolith', severity: 'low' as HazardSeverity,
      note: 'Fine abrasive dust damages seals and joints over time.' },
  ]),

  MERCURY: Object.freeze([
    { label: 'Thermal', severity: 'extreme' as HazardSeverity,
      note: 'Sub-solar temperatures exceed 430°C; nightside drops below -170°C.' },
    { label: 'Radiation', severity: 'extreme' as HazardSeverity,
      note: 'Intense direct solar radiation, no magnetic shielding.' },
  ]),

  VENUS: Object.freeze([
    // Venus has an atmosphere, but surface ops are still dominated by thermal
    // and pressure hazards the weather system doesn't model.
    { label: 'Thermal', severity: 'extreme' as HazardSeverity,
      note: 'Surface holds steady at ~460°C — most hardware fails within hours.' },
    { label: 'Pressure', severity: 'extreme' as HazardSeverity,
      note: '92 bar atmospheric pressure — equivalent to ~900 m ocean depth.' },
    { label: 'Corrosion', severity: 'high' as HazardSeverity,
      note: 'Sulfuric-acid clouds and CO₂ atmosphere degrade exposed materials.' },
  ]),

  MARS: Object.freeze([
    // Mars also has dust-storm weather, but the base radiation hazard is
    // always present and worth reminding the player about.
    { label: 'Radiation', severity: 'medium' as HazardSeverity,
      note: 'Thin atmosphere offers limited shielding; long-stay crew needs cover.' },
  ]),

  PHOBOS: Object.freeze([
    { label: 'Microgravity', severity: 'high' as HazardSeverity,
      note: 'Escape velocity ~11 m/s — landing is more rendezvous than descent.' },
    { label: 'Radiation', severity: 'medium' as HazardSeverity,
      note: 'Unshielded solar + cosmic radiation throughout the Mars transit period.' },
  ]),

  DEIMOS: Object.freeze([
    { label: 'Microgravity', severity: 'high' as HazardSeverity,
      note: 'Escape velocity ~5 m/s — effectively free-space docking.' },
    { label: 'Radiation', severity: 'medium' as HazardSeverity,
      note: 'Unshielded solar + cosmic radiation; plan crew rotations short.' },
  ]),

  CERES: Object.freeze([
    { label: 'Microgravity', severity: 'high' as HazardSeverity,
      note: 'Low gravity — anchors required; walking impractical.' },
    { label: 'Thermal', severity: 'medium' as HazardSeverity,
      note: 'Dim sunlight; surface averages -100°C.' },
    { label: 'Radiation', severity: 'medium' as HazardSeverity,
      note: 'No atmosphere; solar flares punch through shielding.' },
  ]),

  JUPITER: Object.freeze([
    { label: 'Radiation', severity: 'extreme' as HazardSeverity,
      note: 'Jovian magnetosphere — lethal dose within hours of orbit insertion.' },
    { label: 'Gravity', severity: 'extreme' as HazardSeverity,
      note: 'Launch-energy cost from Jupiter orbit is enormous.' },
  ]),

  SATURN: Object.freeze([
    { label: 'Radiation', severity: 'high' as HazardSeverity,
      note: 'Saturnian magnetosphere — shield crew quarters.' },
    { label: 'Thermal', severity: 'high' as HazardSeverity,
      note: 'Distant from the Sun — solar power is marginal.' },
  ]),

  TITAN: Object.freeze([
    { label: 'Thermal', severity: 'extreme' as HazardSeverity,
      note: 'Surface at -180°C; thermal management dominates crew-hab design.' },
    { label: 'Atmosphere', severity: 'medium' as HazardSeverity,
      note: 'Thick N₂/CH₄ atmosphere — useful for aerobraking, hazardous to breathe.' },
  ]),
});

/**
 * Return the environmental hazard list for a body.  Empty array when the
 * body has no known hazards (Earth, unknown ids).
 */
export function getBodyHazards(bodyId: string): readonly BodyHazard[] {
  return BODY_HAZARDS[bodyId] ?? [];
}

/**
 * Quick check: does the body have any environmental hazards to display?
 */
export function hasBodyHazards(bodyId: string): boolean {
  return getBodyHazards(bodyId).length > 0;
}

// ---------------------------------------------------------------------------
// Orbital hazards
// ---------------------------------------------------------------------------

/**
 * Orbital-radiation severity by parent body.  In orbit the magnetosphere
 * (where present) shields the station, so LEO is lower than deep space;
 * orbits around airless or high-radiation bodies inherit more of that
 * body's exposure.
 */
const ORBITAL_RADIATION: Readonly<Record<string, HazardSeverity>> = Object.freeze({
  EARTH:   'low',
  MOON:    'medium',
  MARS:    'medium',
  MERCURY: 'extreme',
  VENUS:   'medium',
  PHOBOS:  'medium',
  DEIMOS:  'medium',
  CERES:   'medium',
  JUPITER: 'extreme',
  SATURN:  'high',
  TITAN:   'high',
});

/**
 * Hazards present at an orbital hub around the given body.  Always includes
 * microgravity (station-ops constraint) and radiation (severity varies by
 * body), plus body-specific additions (extreme thermal around Mercury, deep
 * magnetosphere risk around Jupiter).
 */
export function getOrbitalHazards(bodyId: string): readonly BodyHazard[] {
  const radiation: BodyHazard = {
    label: 'Radiation',
    severity: ORBITAL_RADIATION[bodyId] ?? 'medium',
    note: bodyId === 'EARTH'
      ? 'Low Earth Orbit sits inside the magnetosphere — radiation is manageable.'
      : bodyId === 'JUPITER'
        ? 'Jovian belts deliver a lethal dose within hours of orbit insertion.'
        : bodyId === 'MERCURY'
          ? 'Direct solar radiation at 0.4 AU; no magnetosphere to deflect it.'
          : 'Deep-space radiation — no atmosphere, limited shielding.',
  };

  const microgravity: BodyHazard = {
    label: 'Microgravity',
    severity: 'low',
    note: 'Free-fall environment — crew health and long-duration operations require countermeasures.',
  };

  const vacuum: BodyHazard = {
    label: 'Vacuum',
    severity: 'medium',
    note: 'Hard vacuum outside the habitat — pressure-tight seals and EVA discipline are critical.',
  };

  const hazards: BodyHazard[] = [microgravity, vacuum, radiation];

  // Body-specific additions.
  if (bodyId === 'MERCURY') {
    hazards.push({
      label: 'Thermal',
      severity: 'extreme',
      note: 'Extreme sub-solar radiant heat; station must rotate thermal panels constantly.',
    });
  } else if (bodyId === 'VENUS') {
    hazards.push({
      label: 'Upper Atmosphere',
      severity: 'medium',
      note: 'Thin high-altitude air and sulfur compounds abrade solar arrays and windows.',
    });
  } else if (bodyId === 'JUPITER' || bodyId === 'SATURN') {
    hazards.push({
      label: 'Magnetosphere',
      severity: 'high',
      note: 'Trapped charged particles interfere with avionics; shield electronics.',
    });
  }

  return Object.freeze(hazards);
}
