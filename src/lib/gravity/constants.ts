/**
 * Gravity constants — extracted verbatim from the original
 * gravity.1e63caa21a5af6d5.js bundle (GravityConstants module).
 */

export const GAME_STATES = {
  INTRO: 'INTRO',
  OPTIONS: 'OPTIONS',
  DIRECTIONS: 'DIRECTIONS',
  LOADING: 'LOADING',
  FREE_FALL: 'FREE_FALL',
  LEVEL_UP: 'LEVEL_UP',
  COPY_ANSWER: 'COPY_ANSWER',
  GAME_OVER: 'GAME_OVER',
  PAUSED: 'PAUSED',
  ERROR_NO_AVAILABLE_TERMS: 'ERROR_NO_AVAILABLE_TERMS',
} as const;

export type GameState = (typeof GAME_STATES)[keyof typeof GAME_STATES];

export const DIFFICULTY = {
  SLOTH: 'SLOTH',
  BEGINNER: 'BEGINNER',
  INTERMEDIATE: 'INTERMEDIATE',
  EXPERT: 'EXPERT',
  MAD_MAX: 'MAD_MAX',
} as const;

export type Difficulty = (typeof DIFFICULTY)[keyof typeof DIFFICULTY];

/**
 * Ordered list of difficulties, easiest → hardest.
 * Sloth extends Easy by the same step Easy takes from Medium (gravity-increase per level -0.2).
 * Mad Max extends Hard by the same step Hard takes from Medium (gravity start +1.2, interval ÷5).
 */
export const DIFFICULTY_ORDER: Difficulty[] = [
  DIFFICULTY.SLOTH,
  DIFFICULTY.BEGINNER,
  DIFFICULTY.INTERMEDIATE,
  DIFFICULTY.EXPERT,
  DIFFICULTY.MAD_MAX,
];

export type Side = 'word' | 'definition' | 'random';

// --- numeric constants (minified names preserved in comments) ---
export const LOAD_PERCENT_STEP_1_MS = 300; // c
export const LOAD_PERCENT_STEP_MS = 2000; // u
export const MIN_TERM_INTERVAL = 500; // p
export const INITIAL_TERM_LIFE = 17000; // h (17s)
export const MIN_TERM_LIFE = 1000; // m
export const TIMER_TICK = 100; // g
export const INITIAL_TERM_DELAY = 1000; // f
export const COPY_FOCUS_DELAY = 500; // _
export const COPY_SUBMIT_DEBOUNCE = 400; // y
export const COPY_SUBMIT_INITIAL_DELAY = 1500; // v
export const RESIZE_DEBOUNCE = 300; // b
export const TIP_SHOW_MS = 3000; // S
export const TIP_AFTER_MS = 12000; // E
export const LEVEL_UP_MS = 3141; // j — π seconds, matches the zoomBadge animation duration exactly
export const INCORRECT_POINTS = -10; // x
export const MISSES_ALLOWED = 2; // T (game over threshold)
export const GRAVITY_STEP = 0.2; // w
export const TERMS_PER_LEVEL = 7; // C
/**
 * Gravity start per difficulty.
 *  - Easy/Medium/Sloth all start at 9.8 (Earth gravity)
 *  - Hard starts at 11 (+1.2 from Medium — the "Hard step")
 *  - Mad Max starts at 12.2 (+1.2 from Hard — same step applied again)
 */
export const GRAVITY_START: Record<Difficulty, number> = {
  // L
  SLOTH: 9.8,
  BEGINNER: 9.8,
  INTERMEDIATE: 9.8,
  EXPERT: 11,
  MAD_MAX: 12.2,
};
/**
 * Initial new-asteroid interval per difficulty (ms).
 *  - Easy/Medium/Sloth all start at 17s
 *  - Hard starts at 3.5s (≈ ÷5 from Medium — the "Hard step")
 *  - Mad Max starts at 0.7s (÷5 from Hard — same step applied again)
 */
export const TERM_INTERVAL_START: Record<Difficulty, number> = {
  // k
  SLOTH: 17000,
  BEGINNER: 17000,
  INTERMEDIATE: 17000,
  EXPERT: 3500,
  MAD_MAX: 700,
};
export const SKIP_KEY = 'esc'; // N
export const DEFAULT_DIFFICULTY: Difficulty = 'INTERMEDIATE'; // D
export const SHOW_WHICH_SIDE_STORAGE_KEY = 'gravityShowWhichSide'; // A
export const PLANET_COUNT = 10;

// --- score formulas (Be in the original store) ---
export const correctAnswerPointsFormula = (
  consecutiveCorrect: number,
  gravityConstant: number,
): number =>
  20 * consecutiveCorrect + 150 * (1 + Math.round((gravityConstant - 9.8) / 0.2));

/**
 * Gravity-increase-per-level formula by difficulty.
 *  - Sloth: gravity DECREASES by 0.2 per level (mirror of Medium→Easy step), floored at 9.8
 *  - Easy: gravity stays the same (the Medium→Easy step is "stop increasing")
 *  - Medium/Hard/Mad Max: gravity increases by 0.2 per level
 */
export const gravityIncreaseFormula: Record<Difficulty, (g: number) => number> = {
  SLOTH: (g) => Math.max(g - GRAVITY_STEP, 9.8),
  BEGINNER: (g) => g,
  INTERMEDIATE: (g) => g + GRAVITY_STEP,
  EXPERT: (g) => g + GRAVITY_STEP,
  MAD_MAX: (g) => g + GRAVITY_STEP,
};

export const newTermIntervalFormula: Record<
  Difficulty,
  (interval: number) => number
> = {
  SLOTH: (i) => Math.max(0.8 * i, MIN_TERM_INTERVAL),
  BEGINNER: (i) => Math.max(0.8 * i, MIN_TERM_INTERVAL),
  INTERMEDIATE: (i) => Math.max(0.8 * i, MIN_TERM_INTERVAL),
  EXPERT: (i) => Math.max(0.9 * i, MIN_TERM_INTERVAL),
  MAD_MAX: (i) => Math.max(0.9 * i, MIN_TERM_INTERVAL),
};

// --- term sizing (GravityTerm view) ---
const FONT_SCALE = 1.5; // Ae
export function maxTextLengthFactor(lang: string): number {
  // approximation of utils.FontSize.getLanguageFontSizeScale
  const cjk = /^(zh|ja|ko|th|vi)/i.test(lang || 'en');
  return cjk ? 0.6 : 1;
}

export function getMaxTextLength(promptLang: string, hasImage: boolean): number {
  return (hasImage ? 140 : 190) * maxTextLengthFactor(promptLang);
}

export function getTermSize(textLength: number, maxLen: number, hasImage: boolean): number {
  if (hasImage) return 364;
  const ratio = textLength / maxLen;
  return Math.max(180, Math.min(364, Math.sqrt(132496 * ratio) + 20));
}

// --- planet helpers (original: _e / ye / be) ---
export const planetLevelFor = (level: number): number =>
  ((level - 1) % PLANET_COUNT) + 1;

export const planetSize = (windowWidth: number): number => 2 * windowWidth;

export function shouldShowPlanet(currentLevel: number, planetLevel: number): boolean {
  const cur = planetLevelFor(currentLevel);
  return (
    planetLevel === cur ||
    planetLevel === planetLevelFor(currentLevel + 1) ||
    planetLevel === planetLevelFor(currentLevel + 2)
  );
}

export const PLANET_ASSET_PATHS: Record<number, string> = {
  1: '/assets/gravity/planets/level1.png',
  2: '/assets/gravity/planets/level2.png',
  3: '/assets/gravity/planets/level3.png',
  4: '/assets/gravity/planets/level4.png',
  5: '/assets/gravity/planets/level5.png',
  6: '/assets/gravity/planets/level6.png',
  7: '/assets/gravity/planets/level7.png',
  8: '/assets/gravity/planets/level8.png',
  9: '/assets/gravity/planets/level9.png',
  10: '/assets/gravity/planets/level10.png',
};
