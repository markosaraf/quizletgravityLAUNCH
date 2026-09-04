import type { Difficulty, GameState, Side } from './constants';

export interface GravityTerm {
  id: string;
  luid: string; // "term-<id>"
  word: string;
  definition: string;
  _imageUrl?: string;
  starred?: boolean;
}

export interface GravitySet {
  id: string;
  title: string;
  wordLang: string;
  defLang: string;
}

export interface LiveTerm {
  luid: string;
  side: 'word' | 'definition';
  answerLang: string;
  promptLang: string;
}

export type LiveTerms = Record<string, LiveTerm>;

export interface DifficultyPublic {
  difficultyLevel: Difficulty;
}

export interface GameData {
  // static
  set: GravitySet;
  terms: Record<string, GravityTerm>; // keyed by luid
  wordAccents: string[];
  defAccents: string[];
  hasPhotoOnlyDefinitions: boolean;
  acceptsPartialAnswer: boolean;

  // options
  showingTermSide: Side;
  selectedOnly: boolean;
  difficultyLevel: Difficulty;
  gravityConstant: number;
  newTermInterval: number;

  // game state
  gameState: GameState;
  level: number;
  points: number;
  consecutiveCorrect: number;
  termLife: number;
  percentLoaded: number;
  isMeteorIncoming: boolean;
  isShowingDontKnowTip: boolean;
  mainTypingPromptValue: string;
  termBeingCopied: string | null;
  liveTerms: LiveTerms;
  planetsLoaded: Record<number, boolean>;

  // bookkeeping (not rendered directly)
  currentLevelTerms: string[];
  currentLevelTermsRemaining: string[];
  currentLevelMissedTermLuids: string[];
  allRemainingTermLuids: string[];
  allUsedTermLuids: string[];
  termLuidToMissedCount: Record<string, number>;
  missedTermsToSide: Record<string, 'word' | 'definition'>;
}

export interface GradingResult {
  isCorrect: boolean;
  suggestion?: string;
}
