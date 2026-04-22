/**
 * designFactory.ts — Minimum-viable rocket designs for late-game debug saves.
 *
 * Each role maps to a canonical parts list + staging configuration. Totals
 * (mass, thrust) are computed from the real parts catalog so designs stay
 * in sync if parts data changes.
 *
 * Designs produced here are first-class RocketDesign values — they render
 * in the design library and satisfy route-leg references. They are not
 * guaranteed to be optimally flyable; they are structurally valid, use
 * real part IDs, and meet the interface contract.
 */

import { PARTS } from '../../data/parts.ts';
import type { PartDef } from '../physics/types.ts';
import type { RocketDesign, RocketPart } from '../gameState.ts';

export type DesignRole =
  | 'sub-orbital-tourist'
  | 'leo-launcher'
  | 'satellite-deployer-leo'
  | 'heo-deployer'
  | 'lunar-transfer'
  | 'lunar-cargo-lander'
  | 'mars-injection'
  | 'leo-tug'
  | 'lunar-tug'
  | 'venus-orbiter'
  | 'mercury-probe'
  | 'phobos-lander'
  | 'deimos-lander';

interface DesignTemplate {
  /** Part IDs ordered bottom (fires first / physical base) to top. */
  partIds: string[];
  /** Each entry is the part indices activated in that stage (earliest first). */
  stages: number[][];
}

const TEMPLATES: Record<DesignRole, DesignTemplate> = {
  'sub-orbital-tourist': {
    partIds: ['engine-spark', 'tank-small', 'cmd-mk1', 'parachute-mk1'],
    stages: [[0], [3]],
  },
  'leo-launcher': {
    partIds: ['engine-reliant', 'tank-large', 'cmd-mk1', 'parachute-mk1'],
    stages: [[0], [3]],
  },
  'satellite-deployer-leo': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'satellite-comm', 'cmd-mk1', 'parachute-mk1'],
    stages: [[0], [2], [5]],
  },
  'heo-deployer': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-spark-improved', 'tank-medium', 'cmd-mk1', 'parachute-mk1'],
    stages: [[0], [2], [3], [6]],
  },
  'lunar-transfer': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-poodle', 'tank-medium', 'decoupler-stack-tr18', 'engine-spark', 'tank-small', 'cmd-mk1', 'parachute-mk1'],
    stages: [[0], [2], [3], [5], [6], [9]],
  },
  'lunar-cargo-lander': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-poodle', 'tank-medium', 'landing-legs-large', 'cmd-mk1'],
    stages: [[0], [2], [3], [5]],
  },
  'mars-injection': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-nerv', 'tank-large', 'decoupler-stack-tr18', 'engine-poodle', 'tank-medium', 'cmd-mk1'],
    stages: [[0], [2], [3], [5], [6]],
  },
  'leo-tug': {
    partIds: ['engine-spark', 'tank-small', 'probe-core-mk1'],
    stages: [[0]],
  },
  'lunar-tug': {
    partIds: ['engine-spark-improved', 'tank-medium', 'decoupler-stack-tr18', 'engine-spark', 'tank-small', 'probe-core-mk1'],
    stages: [[0], [2], [3]],
  },
  'venus-orbiter': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-spark-improved', 'tank-medium', 'probe-core-mk1', 'heat-shield-mk2'],
    stages: [[0], [2], [3]],
  },
  'mercury-probe': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-nerv', 'tank-medium', 'probe-core-mk1'],
    stages: [[0], [2], [3]],
  },
  'phobos-lander': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-poodle', 'tank-medium', 'landing-legs-small', 'probe-core-mk1'],
    stages: [[0], [2], [3]],
  },
  'deimos-lander': {
    partIds: ['engine-reliant', 'tank-large', 'decoupler-stack-tr18', 'engine-poodle', 'tank-small', 'landing-legs-small', 'probe-core-mk1'],
    stages: [[0], [2], [3]],
  },
};

const PARTS_BY_ID: Map<string, PartDef> = new Map(PARTS.map(p => [p.id, p]));

function partDef(id: string): PartDef {
  const def = PARTS_BY_ID.get(id);
  if (!def) throw new Error(`designFactory: unknown partId "${id}"`);
  return def;
}

function sumMass(partIds: string[]): number {
  return partIds.reduce((sum, id) => sum + partDef(id).mass, 0);
}

function sumThrust(partIds: string[]): number {
  return partIds.reduce((sum, id) => {
    const thrust = partDef(id).properties?.thrust;
    return sum + (typeof thrust === 'number' ? thrust : 0);
  }, 0);
}

function computeUnstaged(partsLength: number, stages: number[][]): number[] {
  const staged = new Set<number>();
  for (const stage of stages) for (const idx of stage) staged.add(idx);
  const unstaged: number[] = [];
  for (let i = 0; i < partsLength; i++) if (!staged.has(i)) unstaged.push(i);
  return unstaged;
}

export interface MakeDesignOpts {
  id: string;
  name: string;
  role: DesignRole;
  /** Optional ISO date override for deterministic tests. */
  createdDate?: string;
}

/**
 * Build a minimum-viable RocketDesign from a canonical role template.
 * Throws if any template part ID is unknown.
 */
export function makeDesign(opts: MakeDesignOpts): RocketDesign {
  const template = TEMPLATES[opts.role];
  if (!template) throw new Error(`designFactory: unknown role "${opts.role}"`);

  // Validate every partId before we compute anything.
  template.partIds.forEach(partDef);

  const parts: RocketPart[] = template.partIds.map((partId, i) => ({
    partId,
    position: { x: 0, y: i * 40 },
  }));

  const totalMass = sumMass(template.partIds);
  const totalThrust = sumThrust(template.partIds);
  const unstaged = computeUnstaged(parts.length, template.stages);
  const createdDate = opts.createdDate ?? '2026-01-01T00:00:00.000Z';

  return {
    id: opts.id,
    name: opts.name,
    parts,
    staging: {
      stages: template.stages.map(stage => [...stage]),
      unstaged,
    },
    totalMass,
    totalThrust,
    createdDate,
    updatedDate: createdDate,
  };
}
