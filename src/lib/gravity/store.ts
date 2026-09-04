import { CORRECT_STORE_KEY } from './parse';

/**
 * GravityStore — a method-for-method port of the original store found in
 * gravity.1e63caa21a5af6d5.js. Timers, formulas and state transitions
 * reproduce the 2020–2024 production behavior.
 */
import {
  COPY_SUBMIT_DEBOUNCE,
  COPY_SUBMIT_INITIAL_DELAY,
  DEFAULT_DIFFICULTY,
  DIFFICULTY,
  GAME_STATES,
  GRAVITY_START,
  INITIAL_TERM_DELAY,
  INITIAL_TERM_LIFE,
  INCORRECT_POINTS,
  LEVEL_UP_MS,
  LOAD_PERCENT_STEP_1_MS,
  LOAD_PERCENT_STEP_MS,
  MIN_TERM_INTERVAL,
  MIN_TERM_LIFE,
  MISSES_ALLOWED,
  PLANET_COUNT,
  SHOW_WHICH_SIDE_STORAGE_KEY,
  TERMS_PER_LEVEL,
  TERM_INTERVAL_START,
  TIP_AFTER_MS,
  TIP_SHOW_MS,
  TIMER_TICK,
  correctAnswerPointsFormula,
  gravityIncreaseFormula,
  newTermIntervalFormula,
} from './constants';
import { grade } from './grader';
import type { Difficulty, GameState, Side } from './constants';
import type { GameData, GravitySet, GravityTerm } from './types';

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getStoredSide(): Side {
  if (typeof window === 'undefined') return 'word';
  const v = window.localStorage.getItem(SHOW_WHICH_SIDE_STORAGE_KEY);
  return v === 'word' || v === 'definition' || v === 'random' ? v : 'word';
}

export class GravityStore {
  data: GameData | null = null;
  private listeners = new Set<() => void>();

  // timers
  private timer = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private initialTermTimer: ReturnType<typeof setTimeout> | null = null;
  private tipTimer: ReturnType<typeof setTimeout> | null = null;
  private loadTimeouts: ReturnType<typeof setTimeout>[] = [];
  private levelUpTimeout: ReturnType<typeof setTimeout> | null = null;
  private loadedInitialPlanets = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): GameData => this.data as GameData;

  private change() {
    // clone so useSyncExternalStore sees a new snapshot reference
    if (this.data) this.data = { ...this.data };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------
  // setup (mirrors GravityStore.setup)
  // ------------------------------------------------------------------
  setup(opts: {
    set: GravitySet;
    terms: GravityTerm[];
    acceptsPartialAnswer?: boolean;
  }) {
    const { set, terms } = opts;
    const termsMap: Record<string, GravityTerm> = {};
    for (const t of terms) {
      const luid = `term-${t.id}`;
      termsMap[luid] = { ...t, luid };
    }
    const hasPhotoOnlyDefinitions = terms.some(
      (t) => !t.definition && t._imageUrl,
    );

    this.data = {
      set,
      terms: termsMap,
      wordAccents: [],
      defAccents: [],
      hasPhotoOnlyDefinitions,
      acceptsPartialAnswer: opts.acceptsPartialAnswer ?? false,

      showingTermSide: getStoredSide(),
      selectedOnly: false,
      difficultyLevel: DEFAULT_DIFFICULTY,
      gravityConstant: GRAVITY_START[DEFAULT_DIFFICULTY],
      newTermInterval: TERM_INTERVAL_START[DEFAULT_DIFFICULTY],

      gameState: GAME_STATES.INTRO,
      level: 1,
      points: 0,
      consecutiveCorrect: 0,
      termLife: INITIAL_TERM_LIFE,
      percentLoaded: 5,
      isMeteorIncoming: false,
      isShowingDontKnowTip: false,
      mainTypingPromptValue: '',
      termBeingCopied: null,
      liveTerms: {},
      planetsLoaded: {},

      currentLevelTerms: [],
      currentLevelTermsRemaining: [],
      currentLevelMissedTermLuids: [],
      allRemainingTermLuids: [],
      allUsedTermLuids: [],
      termLuidToMissedCount: {},
      missedTermsToSide: {},
    };

    this._setDifficultyLevel(DEFAULT_DIFFICULTY);
    this._initNewGame();
    this.change();
  }

  // ------------------------------------------------------------------
  // public actions (mirrors the `U` action creators)
  // ------------------------------------------------------------------
  displayGameOptions() {
    this._updateGameState(GAME_STATES.OPTIONS);
    this.change();
  }

  displayGameDirections() {
    this._updateGameState(GAME_STATES.DIRECTIONS);
    this.change();
  }

  startGame() {
    let didSeeLoadingBar = false;
    if (this._isInitialPlanetsLoaded()) {
      this._startGameplay();
    } else {
      this._enterLoadingState();
      didSeeLoadingBar = true;
    }
    this.change();
  }

  pauseGame() {
    this._pauseTimer();
    this._updateGameState(GAME_STATES.PAUSED);
    this.change();
  }

  resumeGame() {
    this._resumeTimer();
    this._updateGameState(GAME_STATES.FREE_FALL);
    this.change();
  }

  /**
   * Restart — clears the current game and returns the user to the Options
   * screen so they can pick a different difficulty / side before playing
   * again. (Originally this jumped straight back into gameplay.)
   */
  restartGame() {
    this._clearGame();
    this._initNewGame();
    this._setDifficultyLevel(this.data?.difficultyLevel ?? DEFAULT_DIFFICULTY);
    this._updateGameState(GAME_STATES.OPTIONS);
    this.change();
  }

  changeDifficultyLevel(level: Difficulty) {
    this._setDifficultyLevel(level);
    this.change();
  }

  changeShowingSide(side: Side) {
    if (!this.data) return;
    this.data.showingTermSide = side;
    try {
      window.localStorage.setItem(SHOW_WHICH_SIDE_STORAGE_KEY, side);
    } catch {
      /* ignore */
    }
    if (side !== 'random') {
      for (const lt of Object.values(this.data.liveTerms)) {
        lt.side = side === 'word' ? 'word' : 'definition';
      }
    }
    this.change();
  }

  /** Toggle "study starred terms only" mode. When enabled, only terms with
      `starred: true` will be available to fall during gameplay. */
  changeSelectedOnly(selectedOnly: boolean) {
    if (!this.data) return;
    this.data.selectedOnly = selectedOnly;
    this.change();
  }

  updateAlternateAnswerOption(enabled: boolean) {
    if (!this.data) return;
    this.data.acceptsPartialAnswer = enabled;
    try {
      window.localStorage.setItem(CORRECT_STORE_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.change();
  }

  updateMainTypingPromptValue(value: string) {
    if (!this.data) return;
    this.data.mainTypingPromptValue = value;
    this.change();
  }

  markPlanetLoaded(level: number) {
    if (!this.data) return;
    this.data.planetsLoaded[level] = true;
    if (this._isInitialPlanetsLoaded()) {
      this.loadedInitialPlanets = true;
      if (this.data.gameState === GAME_STATES.LOADING) {
        this._updateLoadingPercent(100, 0).then(() =>
          this._startGameplayAfterDelay(LOAD_PERCENT_STEP_MS + 500),
        );
      }
    }
    this.change();
  }

  gradeAnswer() {
    if (!this.data) return;
    const value = this.data.mainTypingPromptValue;
    for (const liveTermId of Object.keys(this.data.liveTerms)) {
      if (this._isCorrectAnswerForTerm(value, liveTermId).isCorrect) {
        this._markCorrectAndAdvanceGame(liveTermId);
        this.change();
        return;
      }
    }
    this._scoreIncorrect();
    this.change();
  }

  missTerm(liveTermId: string, wasSkipped: boolean) {
    if (!this.data) return;
    const value = this.data.mainTypingPromptValue;
    if (this._isCorrectAnswerForTerm(value, liveTermId).isCorrect) {
      this._markCorrectAndAdvanceGame(liveTermId);
    } else {
      if (wasSkipped && this.tipTimer) clearTimeout(this.tipTimer);
      this._resetConsecutive();
      this._addMissed(liveTermId);
      this._promptCopyAnswer(liveTermId);
    }
    this.change();
  }

  checkCopiedAnswer(liveTermId: string, answer: string) {
    if (!this.data || !this.data.termBeingCopied) return;
    const correct = this._getCorrectAnswer(liveTermId);
    if (
      grade(correct, answer, {
        acceptsPartialAnswer: this.data.acceptsPartialAnswer,
      }).isCorrect
    ) {
      this.data.termBeingCopied = null;
      this.data.mainTypingPromptValue = '';
      const missedEnough = this._getMissedCount(liveTermId) === MISSES_ALLOWED;
      this._removeFromLiveTerms(liveTermId);
      if (missedEnough) {
        this._endGame();
      } else {
        this._advanceGameAfterCorrect();
      }
      this.change();
    }
  }

  reload() {
    if (typeof window !== 'undefined') window.location.reload();
  }

  dispose() {
    this._clearAllTimers();
    // Intentionally NOT clearing `this.listeners` here. The listeners are
    // owned by React's useSyncExternalStore, which adds a listener on mount
    // and removes it on unmount via the unsubscribe function returned by
    // `subscribe`. If we cleared the set here, the React subscription would
    // be silently dropped, and subsequent setup() / change() calls would
    // never notify React — the UI would get stuck (e.g. clicking "Start" on
    // the splash screen after "New set" would do nothing). React will clean
    // up its own listener when the component unmounts.
  }

  // ------------------------------------------------------------------
  // internal store logic (mirrors the original private methods)
  // ------------------------------------------------------------------
  isMeteor(liveTermId: string): boolean {
    return this._getMissedCount(liveTermId) === MISSES_ALLOWED - 1;
  }

  _getTermLuids(): string[] {
    return Object.keys(this.data?.terms ?? {});
  }

  _getAvailableTermLuids(): string[] {
    const d = this.data;
    if (!d) return [];
    return this._getTermLuids().filter((luid) => {
      const term = d.terms[luid];
      const showing = d.showingTermSide;
      // Starred-only filter: when the user selects "Starred terms" on the
      // options screen, drop any term that isn't flagged as starred.
      if (d.selectedOnly && !term.starred) return false;
      return (
        term.word !== '' &&
        (term.definition !== '' || !!term._imageUrl) &&
        (showing !== 'word' || term.definition !== '')
      );
    });
  }

  _getTermLuidFromLiveTermId(liveTermId: string): string {
    return this.data?.liveTerms[liveTermId]?.luid ?? '';
  }

  _getMissedCount(liveTermId: string): number {
    const luid = this._getTermLuidFromLiveTermId(liveTermId);
    return this.data?.termLuidToMissedCount[luid] ?? 0;
  }

  _isWordShowing(liveTermId: string): boolean {
    return this.data?.liveTerms[liveTermId]?.side === 'word';
  }

  _getPromptSide(liveTermId: string): 'word' | 'definition' {
    return this._isWordShowing(liveTermId) ? 'word' : 'definition';
  }

  _getAnswerSide(liveTermId: string): 'word' | 'definition' {
    return this._isWordShowing(liveTermId) ? 'definition' : 'word';
  }

  _getCorrectAnswer(liveTermId: string): string {
    const d = this.data;
    if (!d) return '';
    const side = this._getAnswerSide(liveTermId);
    const luid = this._getTermLuidFromLiveTermId(liveTermId);
    return side === 'word' ? d.terms[luid].word : d.terms[luid].definition;
  }

  _getLangFor(luid: string, side: 'word' | 'definition'): string {
    const d = this.data;
    if (!d) return 'en';
    return side === 'definition' ? d.set.defLang : d.set.wordLang;
  }

  _getAnswerLang(liveTermId: string): string {
    const luid = this._getTermLuidFromLiveTermId(liveTermId);
    return this._getLangFor(luid, this._getAnswerSide(liveTermId));
  }

  _isCorrectAnswerForTerm(value: string, liveTermId: string) {
    const correct = this._getCorrectAnswer(liveTermId);
    return grade(correct, value, {
      acceptsPartialAnswer: this.data?.acceptsPartialAnswer,
    });
  }

  _initNewGame() {
    const d = this.data;
    if (!d) return;
    d.level = 1;
    d.points = 0;
    d.gameState = GAME_STATES.INTRO;
    d.isMeteorIncoming = false;
    d.termLife = INITIAL_TERM_LIFE;
    d.consecutiveCorrect = 0;
    d.currentLevelTerms = [];
    d.currentLevelTermsRemaining = [];
    d.liveTerms = {};
    d.termBeingCopied = null;
    d.allRemainingTermLuids = [];
    d.allUsedTermLuids = [];
    d.currentLevelMissedTermLuids = [];
    d.missedTermsToSide = {};
    d.percentLoaded = 5;
    d.mainTypingPromptValue = '';
    this._initTermLuidToMissedCount();
    this.loadedInitialPlanets =
      !!(d.planetsLoaded[1] && d.planetsLoaded[2] && d.planetsLoaded[3]);
  }

  _initTermLuidToMissedCount() {
    const d = this.data;
    if (!d) return;
    const map: Record<string, number> = {};
    this._getTermLuids().forEach((luid) => {
      map[luid] = 0;
    });
    d.termLuidToMissedCount = map;
  }

  _startGame() {
    const d = this.data;
    if (!d) return;
    if (this._isInitialPlanetsLoaded()) {
      this._startGameplay();
    } else {
      this._enterLoadingState();
    }
  }

  _isInitialPlanetsLoaded(): boolean {
    const d = this.data;
    if (!d) return false;
    if (this.loadedInitialPlanets) return true;
    return !!(d.planetsLoaded[1] && d.planetsLoaded[2] && d.planetsLoaded[3]);
  }

  _enterLoadingState() {
    this._updateGameState(GAME_STATES.LOADING);
    this._updateLoadingPercent(30, LOAD_PERCENT_STEP_1_MS)
      .then(() => this._updateLoadingPercent(50, LOAD_PERCENT_STEP_MS))
      .then(() => this._updateLoadingPercent(80, LOAD_PERCENT_STEP_MS))
      .then(() => this._updateLoadingPercent(100, LOAD_PERCENT_STEP_MS))
      .then(() => this._startGameplayAfterDelay(LOAD_PERCENT_STEP_MS + 500))
      .catch(() => {
        /* loading percent chain superseded by planet load */
      });
  }

  _updateLoadingPercent(percent: number, delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => {
        if (this.data?.percentLoaded === 100 && percent !== 100) {
          reject();
        } else {
          if (this.data) {
            this.data.percentLoaded = percent;
            this.change();
          }
          resolve();
        }
      }, delayMs);
      this.loadTimeouts.push(to);
    });
  }

  _startGameplayAfterDelay(delayMs: number) {
    const to = setTimeout(() => {
      this._startGameplay();
      this.change();
    }, delayMs);
    this.loadTimeouts.push(to);
  }

  _startGameplay() {
    const d = this.data;
    if (!d) return;
    const available = this._getAvailableTermLuids();
    if (available.length === 0) {
      this._updateGameState(GAME_STATES.ERROR_NO_AVAILABLE_TERMS);
      return;
    }
    d.allRemainingTermLuids = shuffle(available);
    this._updateGameState(GAME_STATES.FREE_FALL);
    this._getNewLevelTerms();
    this._resetTimer();
    this.tipTimer = setTimeout(() => this._showDontKnowTip(), TIP_AFTER_MS);
  }

  _showDontKnowTip() {
    const d = this.data;
    if (!d) return;
    d.isShowingDontKnowTip = true;
    this.change();
    setTimeout(() => {
      if (this.data) {
        this.data.isShowingDontKnowTip = false;
        this.change();
      }
    }, TIP_SHOW_MS);
  }

  _pauseGame() {
    this._pauseTimer();
    this._updateGameState(GAME_STATES.PAUSED);
    this.change();
  }

  _resumeGame() {
    this._resumeTimer();
    this._updateGameState(GAME_STATES.FREE_FALL);
    this.change();
  }

  _clearGame() {
    const d = this.data;
    if (!d) return;
    d.isShowingDontKnowTip = false;
    d.isMeteorIncoming = false;
    d.mainTypingPromptValue = '';
    this._pauseTimer();
    if (this.tipTimer) clearTimeout(this.tipTimer);
  }

  _endGame() {
    this._clearGame();
    this._updateGameState(GAME_STATES.GAME_OVER);
    this._clearAllTimers();
    this.change();
  }

  _updateGameState(state: GameState) {
    if (!this.data) return;
    this.data.gameState = state;
  }

  _advanceLevel() {
    const d = this.data;
    if (!d) return;
    d.level += 1;
    const increase = gravityIncreaseFormula[d.difficultyLevel];
    d.gravityConstant = increase(d.gravityConstant);
    this._updateGameState(GAME_STATES.LEVEL_UP);
    this.change();
    if (this.levelUpTimeout) clearTimeout(this.levelUpTimeout);
    this.levelUpTimeout = setTimeout(() => {
      this._beginNextLevel();
      this.change();
    }, LEVEL_UP_MS);
  }

  _beginNextLevel() {
    this._getNewLevelTerms();
    this._setNewTermInterval();
    this._setTermLife();
    this._resetTimer();
    this._updateGameState(GAME_STATES.FREE_FALL);
  }

  _promptCopyAnswer(liveTermId: string) {
    this._pauseTimer();
    this._updateGameState(GAME_STATES.COPY_ANSWER);
    if (this.data) this.data.termBeingCopied = liveTermId;
  }

  _updatePoints(delta: number) {
    const d = this.data;
    if (!d) return;
    d.points = Math.max(0, d.points + delta);
  }

  _scoreIncorrect() {
    this._updatePoints(INCORRECT_POINTS);
    if (this.data) this.data.mainTypingPromptValue = '';
  }

  _scoreCorrect() {
    const d = this.data;
    if (!d) return;
    const pts = correctAnswerPointsFormula(
      d.consecutiveCorrect,
      d.gravityConstant,
    );
    this._updatePoints(pts);
  }

  _resetConsecutive() {
    if (this.data) this.data.consecutiveCorrect = 0;
  }

  _addConsecutive() {
    if (this.data) this.data.consecutiveCorrect += 1;
  }

  _addMissed(liveTermId: string) {
    const d = this.data;
    if (!d) return;
    const luid = this._getTermLuidFromLiveTermId(liveTermId);
    d.termLuidToMissedCount[luid] = (d.termLuidToMissedCount[luid] ?? 0) + 1;
    d.missedTermsToSide[luid] = d.liveTerms[liveTermId].side;
    d.currentLevelMissedTermLuids.push(luid);
  }

  _markCorrectAndAdvanceGame(liveTermId: string) {
    this._markCorrect(liveTermId);
    this._removeFromLiveTerms(liveTermId);
    this._advanceGameAfterCorrect();
    if (this.data) this.data.mainTypingPromptValue = '';
  }

  _markCorrect(liveTermId: string) {
    this._addConsecutive();
    this._scoreCorrect();
  }

  _advanceGameAfterCorrect() {
    const d = this.data;
    if (!d) return;
    const liveEmpty = Object.keys(d.liveTerms).length === 0;
    const levelEmpty = d.currentLevelTermsRemaining.length === 0;
    if (liveEmpty && levelEmpty) {
      this._advanceLevel();
    } else {
      if (liveEmpty && this.timer < d.newTermInterval - INITIAL_TERM_DELAY) {
        this._resetTimer();
      }
      if (d.gameState !== GAME_STATES.FREE_FALL) {
        this._resumeGame();
      }
    }
  }

  _getNewLevelTerms() {
    const d = this.data;
    if (!d) return;
    let remaining = d.allRemainingTermLuids;
    let used = d.allUsedTermLuids;
    let missed = d.currentLevelMissedTermLuids;
    // carry over previous level's terms that were not missed
    const previousLevelNotMissed = d.currentLevelTerms.filter(
      (luid) => !missed.includes(luid),
    );
    used = used.concat(previousLevelNotMissed);
    while (missed.length < TERMS_PER_LEVEL) {
      if (used.length === 0 && remaining.length === 0) {
        remaining = shuffle(this._getAvailableTermLuids());
      } else if (remaining.length === 0) {
        remaining = shuffle(used);
        used = [];
      }
      const last = remaining.pop();
      if (!last) break;
      missed.push(last);
    }
    missed = shuffle(missed);
    d.allUsedTermLuids = used;
    d.allRemainingTermLuids = remaining;
    d.currentLevelTerms = missed;
    d.currentLevelTermsRemaining = missed.slice();
    d.currentLevelMissedTermLuids = [];
  }

  _setDifficultyLevel(level: Difficulty) {
    const d = this.data;
    if (!d) return;
    d.difficultyLevel = level;
    d.gravityConstant = GRAVITY_START[level];
    d.newTermInterval = TERM_INTERVAL_START[level];
  }

  _setNewTermInterval() {
    const d = this.data;
    if (!d) return;
    const formula = newTermIntervalFormula[d.difficultyLevel];
    d.newTermInterval = formula(d.newTermInterval);
  }

  _setTermLife() {
    const d = this.data;
    if (!d) return;
    d.termLife = Math.max(0.9 * d.termLife, MIN_TERM_LIFE);
  }

  _resetTimer() {
    this.timer = 0;
    if (this.initialTermTimer) clearTimeout(this.initialTermTimer);
    this.initialTermTimer = setTimeout(
      () => {
        this._fireTerm();
        this._pauseTimer();
        this._resumeTimer();
      },
      INITIAL_TERM_DELAY,
    );
  }

  _resumeTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this._incrementTimer(), TIMER_TICK);
  }

  _pauseTimer() {
    if (this.initialTermTimer) clearTimeout(this.initialTermTimer);
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
  }

  _incrementTimer() {
    const d = this.data;
    if (!d) return;
    if (d.gameState !== GAME_STATES.FREE_FALL) return;
    if (this.timer >= d.newTermInterval) {
      this._fireTerm();
      this.timer -= d.newTermInterval;
    }
    this.timer += TIMER_TICK;
  }

  _updateLiveTerms(liveTermId: string, value: {
    luid: string;
    side: 'word' | 'definition';
    answerLang: string;
    promptLang: string;
  }) {
    if (!this.data) return;
    this.data.liveTerms[liveTermId] = value;
  }

  _updateIsMeteorIncoming() {
    const d = this.data;
    if (!d) return;
    const hasMeteor = Object.keys(d.liveTerms).some((id) => this.isMeteor(id));
    if (d.isMeteorIncoming !== hasMeteor) d.isMeteorIncoming = hasMeteor;
  }

  _removeFromLiveTerms(liveTermId: string) {
    const d = this.data;
    if (!d) return;
    delete d.liveTerms[liveTermId];
    this._updateIsMeteorIncoming();
  }

  _getNewTermShowingSide(luid: string): 'word' | 'definition' {
    const d = this.data;
    if (!d) return 'word';
    let side = d.showingTermSide;
    if (side === 'random') {
      const term = d.terms[luid];
      side =
        term.definition === ''
          ? 'definition'
          : Math.random() >= 0.5
            ? 'word'
            : 'definition';
    }
    return side as 'word' | 'definition';
  }

  _getNextSide(luid: string): 'word' | 'definition' {
    const d = this.data;
    if (!d) return 'word';
    return d.missedTermsToSide[luid] ?? this._getNewTermShowingSide(luid);
  }

  _getNextTermToFire(): string | null {
    const d = this.data;
    if (!d) return null;
    return d.currentLevelTermsRemaining[0] ?? null;
  }

  _getNextLiveTermId(luid: string): string {
    const d = this.data;
    const n = TERMS_PER_LEVEL - (d?.currentLevelTermsRemaining.length ?? 0);
    return `${luid}-${d?.level ?? 1}-${n}`;
  }

  _fireTerm() {
    const d = this.data;
    if (!d) return;
    if (d.currentLevelTermsRemaining.length === 0) {
      this._pauseTimer();
      return;
    }
    const luid = this._getNextTermToFire();
    if (!luid) return;
    const liveTermId = this._getNextLiveTermId(luid);
    const side = this._getNextSide(luid);
    const lang = this._getLangFor(luid, side);
    d.liveTerms[liveTermId] = {
      luid,
      side,
      answerLang: lang,
      promptLang: lang,
    };
    d.currentLevelTermsRemaining = d.currentLevelTermsRemaining.slice(1);
    this._updateIsMeteorIncoming();
    this.change();
  }

  _clearAllTimers() {
    this._pauseTimer();
    if (this.tipTimer) clearTimeout(this.tipTimer);
    if (this.levelUpTimeout) clearTimeout(this.levelUpTimeout);
    this.loadTimeouts.forEach((t) => clearTimeout(t));
    this.loadTimeouts = [];
  }
}

// export a singleton like the original module-level `ht` store
export const gravityStore = new GravityStore();
