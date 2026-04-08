// Validation constants
export const VALIDATION = {
  AMOUNT_SUM_TARGET: 100,
  AMOUNT_SUM_TOLERANCE: (numRows: number) => 0.009 * numRows,
  MASS_MIN_MULTIPLIER: 100, // mass must be >= 100 * volume
  BATCH_SIZE: 50, // auto-flush after 50 scans
  DECIMAL_PLACES: 2, // for amount
} as const;

// Storage keys
export const STORAGE_KEYS = {
  USER_PROFILE: 'scanlake:user',
  USER_SETTINGS: 'scanlake:settings',
  SESSIONS: 'scanlake:sessions', // IndexedDB
  SCANS: 'scanlake:scans', // IndexedDB
  COMPOSITIONS: 'scanlake:compositions', // IndexedDB
} as const;

// UI constants
export const UI = {
  CLUSTER_ID_DISPLAY_LENGTH: 8, // chars to show from uuid
} as const;
