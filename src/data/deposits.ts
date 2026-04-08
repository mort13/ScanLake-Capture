export const DEPOSIT_TYPES = [
  'agricium',
  'beryl',
  'borase',
  'copper',
  'gold',
  'hephaestanite',
  'ice',
  'iron',
  'laranite',
  'none',
  'quartz',
  'riccite',
  'silicon',
  'stileron',
  'tin',
  'titanium',
  'tungsten',
] as const

export const SYSTEMS = [
  'Pyro',
  'Stanton',
] as const

export const GRAVITY_WELLS: Record<string, string[]> = {
  Pyro: [
    'Bloom',
    'Pyro I',
    'Pyro II',
    'Pyro III',
    'Pyro IV',
    'Pyro V',
    'Pyro VI',
    'Ruin Station',
  ],
  Stanton: [
    'ArcCorp',
    'Crusader',
    'Hurston',
    'MicroTech',
    'Aaron Halo',
    'Delamar',
  ],
}
