/**
 * debugSaves.ts — Pre-built game state snapshots for manual testing.
 *
 * Each generator returns a fully formed GameState at a specific progression
 * point.  The debug save menu (src/ui/debugSaves.js) loads these into the
 * live game so testers can jump to any stage without replaying from scratch.
 *
 * These states are synthetic — they don't represent real play sessions but
 * contain enough data for every subsystem to function correctly.
 */

import { createGameState, createCrewMember } from './gameState.js';
import {
  STARTING_MONEY,
  GameMode,
  MissionState,
  FacilityId,
  STARTING_REPUTATION,
} from './constants.js';

import type { GameState, CrewMember, CrewSkills } from './gameState.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completedMission(id: string, title: string, reward: number): any {
  return {
    id, title, description: '', reward,
    deadline: '2099-12-31T00:00:00.000Z',
    state: MissionState.COMPLETED,
    requirements: { minDeltaV: 0, minCrewCount: 0, requiredParts: [] },
    acceptedDate: '2026-01-01T00:00:00.000Z',
    completedDate: '2026-01-02T00:00:00.000Z',
  };
}

function makeCrew(id: string, name: string, salary: number, skills: Partial<CrewSkills> = {}): CrewMember {
  const c = createCrewMember({ id, name, salary, hiredDate: '2026-01-01T00:00:00.000Z' });
  c.skills = { piloting: skills.piloting ?? 0, engineering: skills.engineering ?? 0, science: skills.science ?? 0 };
  return c;
}

function flightRecord(id: string, missionId: string, outcome: string, revenue: number = 0, extras: Record<string, any> = {}): any {
  return {
    id, missionId,
    rocketId: extras.rocketId ?? 'rocket-debug-001',
    rocketName: extras.rocketName ?? 'Debug Rocket',
    crewIds: extras.crewIds ?? [],
    launchDate: extras.launchDate ?? '2026-01-02T00:00:00.000Z',
    outcome, deltaVUsed: extras.deltaVUsed ?? 0, revenue,
    maxAltitude: extras.maxAltitude ?? 0, maxSpeed: extras.maxSpeed ?? 0,
    duration: extras.duration ?? 0, notes: extras.notes ?? 'Debug save flight record',
  };
}

// ---------------------------------------------------------------------------
// Snapshot Definitions
// ---------------------------------------------------------------------------

export interface DebugSaveDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  generate: () => GameState;
}

export const DEBUG_SAVE_DEFINITIONS: DebugSaveDefinition[] = [

  // === EARLY GAME ===

  {
    id: 'fresh-start', name: 'Fresh Start',
    description: 'Brand-new tutorial game with starter parts only.', category: 'Early Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency';
      s.parts = ['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1'];
      s.gameMode = GameMode.TUTORIAL;
      return s;
    },
  },

  {
    id: 'post-tutorial-basics', name: 'Post-Tutorial Basics (Mission 4 Done)',
    description: 'Missions 1-4 complete. Science, recovery, and crew tracks unlocked.', category: 'Early Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 5;
      s.missions.completed = [
        completedMission('mission-001', 'First Flight', 15_000),
        completedMission('mission-002', 'Higher Ambitions', 20_000),
        completedMission('mission-003', 'Breaking the Kilometre', 25_000),
        completedMission('mission-004', 'Speed Test Alpha', 30_000),
      ];
      s.missions.available = []; s.missions.accepted = [];
      s.money = STARTING_MONEY + 90_000 - 30_000; s.loan.balance = 1_950_000;
      s.parts = ['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1'];
      s.flightHistory = [
        flightRecord('fr-001', 'mission-001', 'SUCCESS', 15_000),
        flightRecord('fr-002', 'mission-002', 'SUCCESS', 20_000),
        flightRecord('fr-003', 'mission-003', 'SUCCESS', 25_000),
        flightRecord('fr-004', 'mission-004', 'SUCCESS', 30_000),
      ];
      s.reputation = STARTING_REPUTATION + 8; s.playTimeSeconds = 600; s.flightTimeSeconds = 120;
      return s;
    },
  },

  {
    id: 'post-tutorial-all-parts', name: 'Post-Tutorial All Parts (Mission 10 Done)',
    description: 'Science track complete through mission 10. Engine Poodle unlocked. R&D Lab available.', category: 'Early Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 12;
      s.missions.completed = [
        completedMission('mission-001', 'First Flight', 15_000), completedMission('mission-002', 'Higher Ambitions', 20_000),
        completedMission('mission-003', 'Breaking the Kilometre', 25_000), completedMission('mission-004', 'Speed Test Alpha', 30_000),
        completedMission('mission-005', 'Safe Return I', 35_000), completedMission('mission-006', 'Controlled Descent', 40_000),
        completedMission('mission-007', 'Leg Day', 40_000), completedMission('mission-008', 'Black Box Test', 55_000),
        completedMission('mission-009', 'Ejector Seat Test', 45_000), completedMission('mission-010', 'Science Experiment Alpha', 75_000),
      ];
      s.missions.available = []; s.missions.accepted = [];
      s.money = STARTING_MONEY + 380_000 - 120_000; s.loan.balance = 1_850_000;
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1','parachute-mk2','science-module-mk1','thermometer-mk1','landing-legs-small','landing-legs-large','engine-poodle'];
      s.crew = [makeCrew('crew-d-001', 'Alex Mitchell', 1200, { piloting: 15, engineering: 10 })];
      s.facilities[FacilityId.CREW_ADMIN] = { built: true, tier: 1 };
      s.sciencePoints = 25;
      s.scienceLog = [{ instrumentId: 'thermometer-mk1', biomeId: 'LOW_ATMOSPHERE', count: 3 }, { instrumentId: 'thermometer-mk1', biomeId: 'MID_ATMOSPHERE', count: 2 }];
      s.flightHistory = Array.from({ length: 10 }, (_, i) => flightRecord(`fr-${String(i+1).padStart(3,'0')}`, `mission-${String(i+1).padStart(3,'0')}`, 'SUCCESS'));
      s.reputation = STARTING_REPUTATION + 18; s.playTimeSeconds = 1800; s.flightTimeSeconds = 450;
      return s;
    },
  },

  // === MID GAME ===

  {
    id: 'first-orbit-achieved', name: 'First Orbit Achieved (Mission 16 Done)',
    description: 'Orbital milestone reached. Large tank and Reliant unlocked. Tracking station available next.', category: 'Mid Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 20;
      s.missions.completed = [
        completedMission('mission-001', 'First Flight', 15_000), completedMission('mission-002', 'Higher Ambitions', 20_000),
        completedMission('mission-003', 'Breaking the Kilometre', 25_000), completedMission('mission-004', 'Speed Test Alpha', 30_000),
        completedMission('mission-005', 'Safe Return I', 35_000), completedMission('mission-006', 'Controlled Descent', 40_000),
        completedMission('mission-007', 'Leg Day', 40_000), completedMission('mission-008', 'Black Box Test', 55_000),
        completedMission('mission-009', 'Ejector Seat Test', 45_000), completedMission('mission-010', 'Science Experiment Alpha', 75_000),
        completedMission('mission-011', 'Emergency Systems Verified', 55_000), completedMission('mission-012', 'Stage Separation Test', 90_000),
        completedMission('mission-013', 'High Altitude Record', 120_000), completedMission('mission-014', 'K\u00e1rm\u00e1n Line Approach', 200_000),
        completedMission('mission-018', 'First Crew Flight', 60_000), completedMission('mission-019', 'Research Division', 120_000),
        completedMission('mission-016', 'Low Earth Orbit', 500_000),
      ];
      s.missions.available = []; s.missions.accepted = [];
      s.money = STARTING_MONEY + 1_525_000 - 400_000; s.loan.balance = 1_500_000;
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1','parachute-mk2','science-module-mk1','thermometer-mk1','landing-legs-small','landing-legs-large','engine-poodle','engine-reliant','srb-small','engine-nerv','srb-large','tank-large','cmd-mk1','decoupler-stack-tr18'];
      s.crew = [makeCrew('crew-d-001', 'Alex Mitchell', 1200, { piloting: 25, engineering: 15, science: 10 }), makeCrew('crew-d-002', 'Jordan Lee', 1500, { piloting: 10, engineering: 20, science: 15 })];
      s.facilities[FacilityId.CREW_ADMIN] = { built: true, tier: 1 }; s.facilities[FacilityId.RD_LAB] = { built: true, tier: 1 };
      s.sciencePoints = 60;
      s.scienceLog = [{ instrumentId: 'thermometer-mk1', biomeId: 'LOW_ATMOSPHERE', count: 5 },{ instrumentId: 'thermometer-mk1', biomeId: 'MID_ATMOSPHERE', count: 4 },{ instrumentId: 'thermometer-mk1', biomeId: 'UPPER_ATMOSPHERE', count: 3 },{ instrumentId: 'thermometer-mk1', biomeId: 'NEAR_SPACE', count: 2 }];
      s.techTree = { researched: ['prop-t1', 'struct-t1'], unlockedInstruments: [] };
      s.flightHistory = Array.from({ length: 17 }, (_, i) => flightRecord(`fr-${String(i+1).padStart(3,'0')}`, `mission-${String(i+1).padStart(3,'0')}`, 'SUCCESS'));
      s.reputation = STARTING_REPUTATION + 30; s.playTimeSeconds = 3600; s.flightTimeSeconds = 900;
      return s;
    },
  },

  {
    id: 'orbital-operations', name: 'Orbital Operations (Mission 20 Done)',
    description: 'Tracking Station online. Docking port unlocked. Satellite deployment available.', category: 'Mid Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 28;
      s.missions.completed = [
        completedMission('mission-001', 'First Flight', 15_000), completedMission('mission-002', 'Higher Ambitions', 20_000),
        completedMission('mission-003', 'Breaking the Kilometre', 25_000), completedMission('mission-004', 'Speed Test Alpha', 30_000),
        completedMission('mission-005', 'Safe Return I', 35_000), completedMission('mission-006', 'Controlled Descent', 40_000),
        completedMission('mission-007', 'Leg Day', 40_000), completedMission('mission-008', 'Black Box Test', 55_000),
        completedMission('mission-009', 'Ejector Seat Test', 45_000), completedMission('mission-010', 'Science Experiment Alpha', 75_000),
        completedMission('mission-011', 'Emergency Systems Verified', 55_000), completedMission('mission-012', 'Stage Separation Test', 90_000),
        completedMission('mission-013', 'High Altitude Record', 120_000), completedMission('mission-014', 'K\u00e1rm\u00e1n Line Approach', 200_000),
        completedMission('mission-015', 'Orbital Satellite Deployment I', 250_000), completedMission('mission-016', 'Low Earth Orbit', 500_000),
        completedMission('mission-018', 'First Crew Flight', 60_000), completedMission('mission-019', 'Research Division', 120_000),
        completedMission('mission-020', 'Eyes on the Sky', 250_000),
      ];
      s.missions.available = []; s.missions.accepted = [];
      s.money = STARTING_MONEY + 1_775_000 + 250_000 - 600_000; s.loan.balance = 1_200_000;
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1','parachute-mk2','science-module-mk1','thermometer-mk1','landing-legs-small','landing-legs-large','engine-poodle','engine-reliant','srb-small','engine-nerv','srb-large','tank-large','cmd-mk1','decoupler-stack-tr18','docking-port-std','satellite-mk1'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:35,engineering:20,science:15}),makeCrew('crew-d-002','Jordan Lee',1500,{piloting:15,engineering:30,science:20}),makeCrew('crew-d-003','Sam Rivera',1300,{piloting:20,engineering:15,science:25})];
      s.facilities[FacilityId.CREW_ADMIN] = { built: true, tier: 1 }; s.facilities[FacilityId.RD_LAB] = { built: true, tier: 1 }; s.facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 1 };
      s.sciencePoints = 100;
      s.scienceLog = [{instrumentId:'thermometer-mk1',biomeId:'LOW_ATMOSPHERE',count:6},{instrumentId:'thermometer-mk1',biomeId:'MID_ATMOSPHERE',count:5},{instrumentId:'thermometer-mk1',biomeId:'UPPER_ATMOSPHERE',count:4},{instrumentId:'thermometer-mk1',biomeId:'NEAR_SPACE',count:3},{instrumentId:'thermometer-mk1',biomeId:'LOW_EARTH_ORBIT',count:2}];
      s.techTree = { researched: ['prop-t1','prop-t2','struct-t1','struct-t2','recov-t1','sci-t1'], unlockedInstruments: ['barometer','surface-sampler'] };
      s.orbitalObjects = [{id:'sat-obj-001',bodyId:'EARTH',type:'SATELLITE',name:'Debug Sat 1',elements:{semiMajorAxis:6_571_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}];
      s.satelliteNetwork = { satellites: [{id:'sat-rec-001',orbitalObjectId:'sat-obj-001',satelliteType:'GENERIC',partId:'satellite-mk1',bodyId:'EARTH',bandId:'LEO',health:100,autoMaintain:false,deployedPeriod:22}] };
      s.flightHistory = Array.from({ length: 19 }, (_, i) => flightRecord(`fr-${String(i+1).padStart(3,'0')}`, `mission-${String(i+1).padStart(3,'0')}`, 'SUCCESS'));
      s.reputation = STARTING_REPUTATION + 38; s.playTimeSeconds = 5400; s.flightTimeSeconds = 1500;
      return s;
    },
  },

  // === LATE GAME ===

  {
    id: 'full-facilities', name: 'All Facilities Unlocked',
    description: 'All tutorial missions done. Every facility built. Mid-tier tech researched.', category: 'Late Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 40;
      s.missions.completed = [
        completedMission('mission-001','First Flight',15_000),completedMission('mission-002','Higher Ambitions',20_000),completedMission('mission-003','Breaking the Kilometre',25_000),completedMission('mission-004','Speed Test Alpha',30_000),completedMission('mission-005','Safe Return I',35_000),completedMission('mission-006','Controlled Descent',40_000),completedMission('mission-007','Leg Day',40_000),completedMission('mission-008','Black Box Test',55_000),completedMission('mission-009','Ejector Seat Test',45_000),completedMission('mission-010','Science Experiment Alpha',75_000),completedMission('mission-011','Emergency Systems Verified',55_000),completedMission('mission-012','Stage Separation Test',90_000),completedMission('mission-013','High Altitude Record',120_000),completedMission('mission-014','K\u00e1rm\u00e1n Line Approach',200_000),completedMission('mission-015','Orbital Satellite Deployment I',250_000),completedMission('mission-016','Low Earth Orbit',500_000),completedMission('mission-017','Tracked Satellite Deployment',350_000),completedMission('mission-018','First Crew Flight',60_000),completedMission('mission-019','Research Division',120_000),completedMission('mission-020','Eyes on the Sky',250_000),completedMission('mission-021','Orbital Survey',200_000),completedMission('mission-022','Network Control',400_000),
      ];
      s.missions.available = []; s.missions.accepted = [];
      s.money = STARTING_MONEY + 2_975_000 - 1_200_000; s.loan.balance = 800_000;
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1','parachute-mk2','science-module-mk1','thermometer-mk1','landing-legs-small','landing-legs-large','engine-poodle','engine-reliant','srb-small','engine-nerv','srb-large','tank-large','cmd-mk1','decoupler-stack-tr18','docking-port-std','satellite-mk1','engine-spark-improved','tank-medium','decoupler-radial','nose-cone','parachute-drogue','heat-shield-mk1','satellite-comm','satellite-gps'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:45,engineering:30,science:20}),makeCrew('crew-d-002','Jordan Lee',1500,{piloting:20,engineering:40,science:25}),makeCrew('crew-d-003','Sam Rivera',1300,{piloting:25,engineering:20,science:40}),makeCrew('crew-d-004','Casey Park',1400,{piloting:30,engineering:25,science:30})];
      s.facilities[FacilityId.CREW_ADMIN]={built:true,tier:2};s.facilities[FacilityId.RD_LAB]={built:true,tier:2};s.facilities[FacilityId.TRACKING_STATION]={built:true,tier:2};s.facilities[FacilityId.SATELLITE_OPS]={built:true,tier:1};s.facilities[FacilityId.LIBRARY]={built:true,tier:1};
      s.sciencePoints = 180;
      s.scienceLog = [{instrumentId:'thermometer-mk1',biomeId:'LOW_ATMOSPHERE',count:8},{instrumentId:'thermometer-mk1',biomeId:'MID_ATMOSPHERE',count:6},{instrumentId:'thermometer-mk1',biomeId:'UPPER_ATMOSPHERE',count:5},{instrumentId:'thermometer-mk1',biomeId:'NEAR_SPACE',count:4},{instrumentId:'thermometer-mk1',biomeId:'LOW_EARTH_ORBIT',count:3},{instrumentId:'barometer',biomeId:'LOW_ATMOSPHERE',count:4},{instrumentId:'barometer',biomeId:'MID_ATMOSPHERE',count:3}];
      s.techTree = { researched: ['prop-t1','prop-t2','prop-t3','struct-t1','struct-t2','struct-t3','recov-t1','recov-t2','recov-t3','sci-t1','sci-t2','sci-t3'], unlockedInstruments: ['barometer','surface-sampler','radiation-detector','gravity-gradiometer','magnetometer'] };
      s.orbitalObjects = [{id:'sat-obj-001',bodyId:'EARTH',type:'SATELLITE',name:'CommSat Alpha',elements:{semiMajorAxis:6_571_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}},{id:'sat-obj-002',bodyId:'EARTH',type:'SATELLITE',name:'GPS Relay 1',elements:{semiMajorAxis:7_000_000,eccentricity:0.002,argPeriapsis:0.5,meanAnomalyAtEpoch:1,epoch:0}}];
      s.satelliteNetwork = { satellites: [{id:'sat-rec-001',orbitalObjectId:'sat-obj-001',satelliteType:'COMM' as any,partId:'satellite-comm',bodyId:'EARTH',bandId:'LEO',health:95,autoMaintain:true,deployedPeriod:22},{id:'sat-rec-002',orbitalObjectId:'sat-obj-002',satelliteType:'GPS' as any,partId:'satellite-gps',bodyId:'EARTH',bandId:'LEO',health:100,autoMaintain:false,deployedPeriod:30}] };
      s.contracts = { board: [], active: [], completed: [{id:'contract-d-001',title:'Suborbital Science',description:'',category:'SCIENCE' as any,objectives:[],reward:40_000,penaltyFee:0,reputationReward:3,reputationPenalty:0,deadlinePeriod:null,boardExpiryPeriod:50,generatedPeriod:10,acceptedPeriod:12,chainId:null,chainPart:null,chainTotal:null}], failed: [] };
      s.flightHistory = Array.from({length:22},(_,i)=>flightRecord(`fr-${String(i+1).padStart(3,'0')}`,`mission-${String(i+1).padStart(3,'0')}`,'SUCCESS'));
      s.reputation = STARTING_REPUTATION + 45; s.playTimeSeconds = 9000; s.flightTimeSeconds = 3000;
      return s;
    },
  },

  {
    id: 'late-game-rich', name: 'Late Game \u2014 Wealthy Agency',
    description: 'All missions done, loan paid off, high reputation, tier-3 tech across all branches.', category: 'Late Game',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Agency'; s.gameMode = GameMode.FREEPLAY; s.tutorialMode = false; s.currentPeriod = 60;
      s.missions.completed = [completedMission('mission-001','First Flight',15_000),completedMission('mission-002','Higher Ambitions',20_000),completedMission('mission-003','Breaking the Kilometre',25_000),completedMission('mission-004','Speed Test Alpha',30_000),completedMission('mission-005','Safe Return I',35_000),completedMission('mission-006','Controlled Descent',40_000),completedMission('mission-007','Leg Day',40_000),completedMission('mission-008','Black Box Test',55_000),completedMission('mission-009','Ejector Seat Test',45_000),completedMission('mission-010','Science Experiment Alpha',75_000),completedMission('mission-011','Emergency Systems Verified',55_000),completedMission('mission-012','Stage Separation Test',90_000),completedMission('mission-013','High Altitude Record',120_000),completedMission('mission-014','K\u00e1rm\u00e1n Line Approach',200_000),completedMission('mission-015','Orbital Satellite Deployment I',250_000),completedMission('mission-016','Low Earth Orbit',500_000),completedMission('mission-017','Tracked Satellite Deployment',350_000),completedMission('mission-018','First Crew Flight',60_000),completedMission('mission-019','Research Division',120_000),completedMission('mission-020','Eyes on the Sky',250_000),completedMission('mission-021','Orbital Survey',200_000),completedMission('mission-022','Network Control',400_000)];
      s.missions.available = []; s.missions.accepted = [];
      s.money = 8_000_000; s.loan = {balance:0,interestRate:0.03,totalInterestAccrued:120_000};
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1','parachute-mk2','science-module-mk1','thermometer-mk1','landing-legs-small','landing-legs-large','engine-poodle','engine-reliant','srb-small','engine-nerv','srb-large','tank-large','cmd-mk1','decoupler-stack-tr18','docking-port-std','satellite-mk1','engine-spark-improved','tank-medium','decoupler-radial','nose-cone','tube-connector','parachute-drogue','heat-shield-mk1','heat-shield-mk2','docking-port-small','relay-antenna','satellite-comm','satellite-gps','satellite-relay','satellite-science','satellite-weather','sample-return-container','surface-instrument-package','engine-ion','landing-legs-powered','solar-panel-small','solar-panel-large','battery-small','battery-large'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:60,engineering:40,science:30}),makeCrew('crew-d-002','Jordan Lee',1500,{piloting:30,engineering:55,science:35}),makeCrew('crew-d-003','Sam Rivera',1300,{piloting:35,engineering:25,science:55}),makeCrew('crew-d-004','Casey Park',1400,{piloting:45,engineering:35,science:40}),makeCrew('crew-d-005','Morgan Chen',1600,{piloting:50,engineering:45,science:45})];
      s.facilities[FacilityId.LAUNCH_PAD]={built:true,tier:3};s.facilities[FacilityId.VAB]={built:true,tier:3};s.facilities[FacilityId.MISSION_CONTROL]={built:true,tier:3};s.facilities[FacilityId.CREW_ADMIN]={built:true,tier:3};s.facilities[FacilityId.RD_LAB]={built:true,tier:3};s.facilities[FacilityId.TRACKING_STATION]={built:true,tier:3};s.facilities[FacilityId.SATELLITE_OPS]={built:true,tier:2};s.facilities[FacilityId.LIBRARY]={built:true,tier:1};
      s.sciencePoints = 350;
      s.scienceLog = [{instrumentId:'thermometer-mk1',biomeId:'LOW_ATMOSPHERE',count:10},{instrumentId:'thermometer-mk1',biomeId:'MID_ATMOSPHERE',count:8},{instrumentId:'thermometer-mk1',biomeId:'UPPER_ATMOSPHERE',count:6},{instrumentId:'barometer',biomeId:'LOW_ATMOSPHERE',count:8},{instrumentId:'barometer',biomeId:'MID_ATMOSPHERE',count:6},{instrumentId:'radiation-detector',biomeId:'NEAR_SPACE',count:4},{instrumentId:'radiation-detector',biomeId:'LOW_EARTH_ORBIT',count:3},{instrumentId:'gravity-gradiometer',biomeId:'LOW_EARTH_ORBIT',count:2}];
      s.techTree = { researched: ['prop-t1','prop-t2','prop-t3','prop-t4','struct-t1','struct-t2','struct-t3','struct-t4','recov-t1','recov-t2','recov-t3','recov-t4','sci-t1','sci-t2','sci-t3','sci-t4'], unlockedInstruments: ['barometer','surface-sampler','radiation-detector','gravity-gradiometer','magnetometer'] };
      s.orbitalObjects = [{id:'sat-obj-001',bodyId:'EARTH',type:'SATELLITE',name:'CommSat Alpha',elements:{semiMajorAxis:6_571_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}},{id:'sat-obj-002',bodyId:'EARTH',type:'SATELLITE',name:'GPS Relay 1',elements:{semiMajorAxis:7_000_000,eccentricity:0.002,argPeriapsis:0.5,meanAnomalyAtEpoch:1,epoch:0}},{id:'sat-obj-003',bodyId:'EARTH',type:'SATELLITE',name:'SciSat Gamma',elements:{semiMajorAxis:6_800_000,eccentricity:0.003,argPeriapsis:1,meanAnomalyAtEpoch:2,epoch:0}}];
      s.satelliteNetwork = { satellites: [{id:'sat-rec-001',orbitalObjectId:'sat-obj-001',satelliteType:'COMM' as any,partId:'satellite-comm',bodyId:'EARTH',bandId:'LEO',health:85,autoMaintain:true,deployedPeriod:22},{id:'sat-rec-002',orbitalObjectId:'sat-obj-002',satelliteType:'GPS' as any,partId:'satellite-gps',bodyId:'EARTH',bandId:'LEO',health:90,autoMaintain:true,deployedPeriod:30},{id:'sat-rec-003',orbitalObjectId:'sat-obj-003',satelliteType:'SCIENCE' as any,partId:'satellite-science',bodyId:'EARTH',bandId:'LEO',health:100,autoMaintain:false,deployedPeriod:45}] };
      s.achievements = [{id:'first-flight',earnedPeriod:1},{id:'first-orbit',earnedPeriod:18},{id:'first-satellite',earnedPeriod:22}];
      const altitudes = [100,500,1000,2000,5000,10000,20000,40000,70000,100000,150000,200000,250000,300000,150000,200000,180000,5000,120000,250000,350000,200000,180000,150000,200000,300000,250000,180000,220000,280000];
      const speeds = [50,100,200,400,800,1200,1800,2400,3000,4000,5000,6000,7000,7800,5500,6500,6000,400,4500,7200,8000,6500,6000,5500,6500,7500,7000,6000,6800,7400];
      const durations = [30,45,60,90,120,180,240,300,360,420,480,540,600,720,500,600,550,90,450,660,900,600,550,500,600,780,700,550,640,740];
      s.flightHistory = Array.from({length:30},(_,i)=>flightRecord(`fr-${String(i+1).padStart(3,'0')}`,i<22?`mission-${String(i+1).padStart(3,'0')}`:`contract-flight-${i}`,'SUCCESS',0,{maxAltitude:altitudes[i],maxSpeed:speeds[i],duration:durations[i],rocketName:`Rocket Mk${Math.min(Math.floor(i/5)+1,6)}`}));
      s.savedDesigns = [{id:'design-001',name:'Explorer I',totalMass:2500} as any,{id:'design-002',name:'Lifter II',totalMass:8500} as any,{id:'design-003',name:'Orbital III',totalMass:15000} as any];
      s.reputation = 95; s.playTimeSeconds = 18_000; s.flightTimeSeconds = 6000;
      return s;
    },
  },

  // === SPECIAL STATES ===

  {
    id: 'sandbox-all-unlocked', name: 'Sandbox \u2014 Everything Unlocked',
    description: 'Sandbox mode with infinite money, all parts, all facilities, full tech tree.', category: 'Special',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Sandbox'; s.gameMode = GameMode.SANDBOX; s.tutorialMode = false;
      s.money = 999_999_999; s.loan = {balance:0,interestRate:0,totalInterestAccrued:0}; s.currentPeriod = 0;
      s.sandboxSettings = { malfunctionsEnabled: false, weatherEnabled: false };
      s.parts = ['probe-core-mk1','cmd-mk1','tank-small','tank-medium','tank-large','engine-spark','engine-spark-improved','engine-reliant','engine-poodle','engine-nerv','engine-ion','engine-deep-space','srb-small','srb-large','parachute-mk1','parachute-mk2','parachute-drogue','landing-legs-small','landing-legs-large','landing-legs-powered','heat-shield-mk1','heat-shield-mk2','heat-shield-solar','heat-shield-heavy','decoupler-stack-tr18','decoupler-radial','docking-port-std','docking-port-small','nose-cone','tube-connector','station-habitat','station-truss','relay-antenna','launch-clamp-1','satellite-mk1','satellite-comm','satellite-gps','satellite-relay','satellite-science','satellite-weather','science-module-mk1','thermometer-mk1','sample-return-container','surface-instrument-package','science-lab','solar-panel-small','solar-panel-large','battery-small','battery-large','mission-module-extended','booster-reusable'];
      s.facilities[FacilityId.LAUNCH_PAD]={built:true,tier:3};s.facilities[FacilityId.VAB]={built:true,tier:3};s.facilities[FacilityId.MISSION_CONTROL]={built:true,tier:3};s.facilities[FacilityId.CREW_ADMIN]={built:true,tier:3};s.facilities[FacilityId.RD_LAB]={built:true,tier:3};s.facilities[FacilityId.TRACKING_STATION]={built:true,tier:3};s.facilities[FacilityId.SATELLITE_OPS]={built:true,tier:3};s.facilities[FacilityId.LIBRARY]={built:true,tier:1};
      s.techTree = { researched: ['prop-t1','prop-t2','prop-t3','prop-t4','prop-t5','struct-t1','struct-t2','struct-t3','struct-t4','struct-t5','recov-t1','recov-t2','recov-t3','recov-t4','recov-t5','sci-t1','sci-t2','sci-t3','sci-t4','sci-t5'], unlockedInstruments: ['barometer','surface-sampler','radiation-detector','gravity-gradiometer','magnetometer','deep-space-scanner','cosmic-ray-telescope'] };
      s.sciencePoints = 999; s.reputation = 100;
      return s;
    },
  },

  {
    id: 'near-bankrupt', name: 'Near Bankruptcy',
    description: 'Very low funds, high loan, struggling agency. Tests financial pressure UI.', category: 'Special',
    generate() {
      const s = createGameState();
      s.agencyName = 'Struggling Space Co'; s.gameMode = GameMode.TUTORIAL; s.currentPeriod = 15;
      s.missions.completed = [completedMission('mission-001','First Flight',15_000),completedMission('mission-002','Higher Ambitions',20_000),completedMission('mission-003','Breaking the Kilometre',25_000),completedMission('mission-004','Speed Test Alpha',30_000)];
      s.missions.available = []; s.missions.accepted = [];
      s.money = 15_000; s.loan = {balance:2_200_000,interestRate:0.03,totalInterestAccrued:200_000};
      s.parts = ['probe-core-mk1','tank-small','engine-spark','parachute-mk1'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:10,engineering:5})];
      s.facilities[FacilityId.CREW_ADMIN] = { built: true, tier: 1 };
      s.flightHistory = [flightRecord('fr-001','mission-001','SUCCESS',15_000),flightRecord('fr-002','mission-002','SUCCESS',20_000),flightRecord('fr-003','mission-003','SUCCESS',25_000),flightRecord('fr-004','mission-004','SUCCESS',30_000),flightRecord('fr-005','mission-005','FAILURE',0),flightRecord('fr-006','mission-005','FAILURE',0),flightRecord('fr-007','mission-006','FAILURE',0)];
      s.reputation = 35; s.playTimeSeconds = 2400; s.flightTimeSeconds = 600;
      return s;
    },
  },

  {
    id: 'lunar-orbit-with-fuel-depot', name: 'Lunar Orbit Capable',
    description: 'Advanced orbital agency with Moon transfer capability. Satellites deployed, docking available.', category: 'Special',
    generate() {
      const s = createGameState();
      s.agencyName = 'Debug Lunar Ops'; s.gameMode = GameMode.FREEPLAY; s.tutorialMode = false; s.currentPeriod = 50;
      s.missions.completed = [completedMission('mission-001','First Flight',15_000),completedMission('mission-002','Higher Ambitions',20_000),completedMission('mission-003','Breaking the Kilometre',25_000),completedMission('mission-004','Speed Test Alpha',30_000),completedMission('mission-005','Safe Return I',35_000),completedMission('mission-006','Controlled Descent',40_000),completedMission('mission-007','Leg Day',40_000),completedMission('mission-008','Black Box Test',55_000),completedMission('mission-009','Ejector Seat Test',45_000),completedMission('mission-010','Science Experiment Alpha',75_000),completedMission('mission-011','Emergency Systems Verified',55_000),completedMission('mission-012','Stage Separation Test',90_000),completedMission('mission-013','High Altitude Record',120_000),completedMission('mission-014','K\u00e1rm\u00e1n Line Approach',200_000),completedMission('mission-015','Orbital Satellite Deployment I',250_000),completedMission('mission-016','Low Earth Orbit',500_000),completedMission('mission-017','Tracked Satellite Deployment',350_000),completedMission('mission-018','First Crew Flight',60_000),completedMission('mission-019','Research Division',120_000),completedMission('mission-020','Eyes on the Sky',250_000),completedMission('mission-021','Orbital Survey',200_000),completedMission('mission-022','Network Control',400_000)];
      s.missions.available = []; s.missions.accepted = [];
      s.money = 5_500_000; s.loan = {balance:500_000,interestRate:0.03,totalInterestAccrued:80_000};
      s.parts = ['probe-core-mk1','cmd-mk1','tank-small','tank-medium','tank-large','engine-spark','engine-spark-improved','engine-reliant','engine-poodle','engine-nerv','engine-ion','srb-small','srb-large','parachute-mk1','parachute-mk2','parachute-drogue','landing-legs-small','landing-legs-large','landing-legs-powered','heat-shield-mk1','heat-shield-mk2','decoupler-stack-tr18','decoupler-radial','docking-port-std','docking-port-small','nose-cone','tube-connector','relay-antenna','satellite-mk1','satellite-comm','satellite-gps','satellite-relay','science-module-mk1','thermometer-mk1','sample-return-container','surface-instrument-package','solar-panel-small','solar-panel-large','battery-small','battery-large','mission-module-extended'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:55,engineering:35,science:25}),makeCrew('crew-d-002','Jordan Lee',1500,{piloting:25,engineering:50,science:30}),makeCrew('crew-d-003','Sam Rivera',1300,{piloting:30,engineering:20,science:50}),makeCrew('crew-d-004','Casey Park',1400,{piloting:40,engineering:30,science:35})];
      s.facilities[FacilityId.LAUNCH_PAD]={built:true,tier:3};s.facilities[FacilityId.VAB]={built:true,tier:3};s.facilities[FacilityId.MISSION_CONTROL]={built:true,tier:3};s.facilities[FacilityId.CREW_ADMIN]={built:true,tier:2};s.facilities[FacilityId.RD_LAB]={built:true,tier:3};s.facilities[FacilityId.TRACKING_STATION]={built:true,tier:3};s.facilities[FacilityId.SATELLITE_OPS]={built:true,tier:2};s.facilities[FacilityId.LIBRARY]={built:true,tier:1};
      s.sciencePoints = 280;
      s.scienceLog = [{instrumentId:'thermometer-mk1',biomeId:'LOW_ATMOSPHERE',count:10},{instrumentId:'thermometer-mk1',biomeId:'MID_ATMOSPHERE',count:8},{instrumentId:'thermometer-mk1',biomeId:'UPPER_ATMOSPHERE',count:6},{instrumentId:'barometer',biomeId:'LOW_ATMOSPHERE',count:6},{instrumentId:'radiation-detector',biomeId:'NEAR_SPACE',count:4},{instrumentId:'radiation-detector',biomeId:'LOW_EARTH_ORBIT',count:3},{instrumentId:'gravity-gradiometer',biomeId:'LOW_EARTH_ORBIT',count:3}];
      s.techTree = { researched: ['prop-t1','prop-t2','prop-t3','prop-t4','struct-t1','struct-t2','struct-t3','struct-t4','recov-t1','recov-t2','recov-t3','recov-t4','sci-t1','sci-t2','sci-t3'], unlockedInstruments: ['barometer','surface-sampler','radiation-detector','gravity-gradiometer','magnetometer'] };
      s.orbitalObjects = [{id:'sat-obj-001',bodyId:'EARTH',type:'SATELLITE',name:'CommSat Alpha',elements:{semiMajorAxis:6_571_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}},{id:'sat-obj-002',bodyId:'EARTH',type:'SATELLITE',name:'GPS Network 1',elements:{semiMajorAxis:7_000_000,eccentricity:0.002,argPeriapsis:0.5,meanAnomalyAtEpoch:1,epoch:0}},{id:'sat-obj-003',bodyId:'EARTH',type:'SATELLITE',name:'Relay Hub',elements:{semiMajorAxis:42_164_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}];
      s.satelliteNetwork = { satellites: [{id:'sat-rec-001',orbitalObjectId:'sat-obj-001',satelliteType:'COMM' as any,partId:'satellite-comm',bodyId:'EARTH',bandId:'LEO',health:80,autoMaintain:true,deployedPeriod:22},{id:'sat-rec-002',orbitalObjectId:'sat-obj-002',satelliteType:'GPS' as any,partId:'satellite-gps',bodyId:'EARTH',bandId:'LEO',health:88,autoMaintain:true,deployedPeriod:30},{id:'sat-rec-003',orbitalObjectId:'sat-obj-003',satelliteType:'RELAY' as any,partId:'satellite-relay',bodyId:'EARTH',bandId:'HEO',health:95,autoMaintain:true,deployedPeriod:40}] };
      s.achievements = [{id:'first-flight',earnedPeriod:1},{id:'first-orbit',earnedPeriod:18},{id:'first-satellite',earnedPeriod:22}];
      s.flightHistory = Array.from({length:35},(_,i)=>flightRecord(`fr-${String(i+1).padStart(3,'0')}`,i<22?`mission-${String(i+1).padStart(3,'0')}`:`contract-${i}`,'SUCCESS'));
      s.reputation = 90; s.playTimeSeconds = 14_000; s.flightTimeSeconds = 5000;
      return s;
    },
  },

  {
    id: 'freeplay-mid-progress', name: 'Freeplay \u2014 Mid Progress',
    description: 'Non-tutorial freeplay game at mid-progression. Contracts active, some tech researched.', category: 'Special',
    generate() {
      const s = createGameState();
      s.agencyName = 'Freeplay Agency'; s.gameMode = GameMode.FREEPLAY; s.tutorialMode = false; s.currentPeriod = 25;
      s.missions.completed = []; s.missions.available = []; s.missions.accepted = [];
      s.money = 3_500_000; s.loan = {balance:1_000_000,interestRate:0.03,totalInterestAccrued:40_000};
      s.parts = ['probe-core-mk1','cmd-mk1','tank-small','tank-medium','tank-large','engine-spark','engine-spark-improved','engine-reliant','engine-poodle','srb-small','srb-large','parachute-mk1','parachute-mk2','parachute-drogue','landing-legs-small','landing-legs-large','heat-shield-mk1','decoupler-stack-tr18','decoupler-radial','docking-port-std','nose-cone','satellite-mk1','satellite-comm','science-module-mk1','thermometer-mk1','solar-panel-small','battery-small'];
      s.crew = [makeCrew('crew-d-001','Alex Mitchell',1200,{piloting:30,engineering:20,science:15}),makeCrew('crew-d-002','Jordan Lee',1500,{piloting:15,engineering:35,science:20}),makeCrew('crew-d-003','Sam Rivera',1300,{piloting:20,engineering:15,science:30})];
      s.facilities[FacilityId.LAUNCH_PAD]={built:true,tier:2};s.facilities[FacilityId.VAB]={built:true,tier:2};s.facilities[FacilityId.MISSION_CONTROL]={built:true,tier:2};s.facilities[FacilityId.CREW_ADMIN]={built:true,tier:1};s.facilities[FacilityId.RD_LAB]={built:true,tier:1};s.facilities[FacilityId.TRACKING_STATION]={built:true,tier:1};
      s.sciencePoints = 80;
      s.techTree = { researched: ['prop-t1','prop-t2','struct-t1','struct-t2','recov-t1','recov-t2','recov-t3','sci-t1'], unlockedInstruments: ['barometer','surface-sampler'] };
      s.contracts = {
        board: [{id:'contract-b-001',title:'Orbital Survey Delta',description:'Perform an orbital science survey.',category:'SCIENCE' as any,objectives:[],reward:80_000,penaltyFee:10_000,reputationReward:5,reputationPenalty:2,deadlinePeriod:35,boardExpiryPeriod:30,generatedPeriod:24,acceptedPeriod:null,chainId:null,chainPart:null,chainTotal:null}],
        active: [{id:'contract-a-001',title:'Deploy Comm Satellite',description:'Deploy a communications satellite to LEO.',category:'SATELLITE' as any,objectives:[],reward:120_000,penaltyFee:15_000,reputationReward:4,reputationPenalty:3,deadlinePeriod:40,boardExpiryPeriod:28,generatedPeriod:20,acceptedPeriod:25,chainId:null,chainPart:null,chainTotal:null}],
        completed: [], failed: [],
      };
      s.orbitalObjects = [{id:'sat-obj-001',bodyId:'EARTH',type:'SATELLITE',name:'CommSat 1',elements:{semiMajorAxis:6_571_000,eccentricity:0.001,argPeriapsis:0,meanAnomalyAtEpoch:0,epoch:0}}];
      s.satelliteNetwork = { satellites: [{id:'sat-rec-001',orbitalObjectId:'sat-obj-001',satelliteType:'COMM' as any,partId:'satellite-comm',bodyId:'EARTH',bandId:'LEO',health:92,autoMaintain:false,deployedPeriod:18}] };
      s.flightHistory = Array.from({length:15},(_,i)=>flightRecord(`fr-${String(i+1).padStart(3,'0')}`,`flight-${i+1}`,'SUCCESS'));
      s.reputation = 68; s.playTimeSeconds = 7200; s.flightTimeSeconds = 2400;
      return s;
    },
  },
];
