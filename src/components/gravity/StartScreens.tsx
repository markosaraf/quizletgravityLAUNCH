import { useState } from 'react';
import { DIFFICULTY_ORDER, GAME_STATES } from '@/lib/gravity/constants';
import { STRINGS, format } from '@/lib/gravity/strings';
import type { Difficulty, Side } from '@/lib/gravity/constants';
import type { GameData } from '@/lib/gravity/types';

/** Map a Difficulty enum value → its display label key. */
const DIFFICULTY_LABEL_KEY: Record<Difficulty, keyof typeof STRINGS.options.difficulty_selector> = {
  SLOTH: 'sloth',
  BEGINNER: 'easy',
  INTERMEDIATE: 'medium',
  EXPERT: 'hard',
  MAD_MAX: 'mad_max',
};

interface StartScreenProps {
  data: GameData;
  onStart: () => void;
  onOptions: () => void;
  onDirections: () => void;
  onSelectedOnlyChange?: (selectedOnly: boolean) => void;
}

/* ---------------- Splash (INTRO) ---------------- */
export function SplashView({ onStart }: { onStart: () => void }) {
  return (
    <div className="GravitySplashView">
      <h1 className="GravitySplashView-title">{STRINGS.splash.title}</h1>
      <p className="GravitySplashView-description">
        {STRINGS.splash.description}
      </p>
      <p
        className="GravitySplashView-description"
        style={{ color: '#ff725b', marginTop: '0.75rem' }}
      >
        {STRINGS.splash.warning_red}
      </p>
      <p className="GravitySplashView-description">
        {STRINGS.splash.warning_miss}
      </p>
      <button
        className="UIButton UIButton--hero"
        aria-label={STRINGS.splash.start_button}
        onClick={onStart}
      >
        {STRINGS.splash.start_button}
      </button>
    </div>
  );
}

/* ---------------- Options ---------------- */
export function OptionsView({
  data,
  onDifficultyChange,
  onSideChange,
  onPartialChange,
  onSelectedOnlyChange,
  onNext,
}: {
  data: GameData;
  onDifficultyChange: (d: Difficulty) => void;
  onSideChange: (s: Side) => void;
  onPartialChange: (b: boolean) => void;
  onSelectedOnlyChange?: (selectedOnly: boolean) => void;
  onNext: () => void;
}) {
  const [showMultipleAnswersOption, setShowMultipleAnswersOption] = useState(false);
  const [acceptsPartialAnswer, setAcceptsPartialAnswer] = useState(
    data.acceptsPartialAnswer,
  );

  // Count how many terms are starred — used to disable the "Starred terms"
  // toggle when there are zero starred terms (would otherwise produce an
  // empty game / "ran out of terms" error screen).
  const starredCount = Object.values(data.terms).filter((t) => t.starred).length;

  // The dropdown value is the ANSWER side; showing side is flipped
  const answerSideValue: 'word' | 'definition' | 'random' =
    data.showingTermSide === 'word'
      ? 'definition'
      : data.showingTermSide === 'definition'
        ? 'word'
        : 'random';

  const wordLabel =
    data.set.wordLang !== data.set.defLang
      ? data.set.wordLang
      : STRINGS.options.side_selector.term;
  const defLabel =
    data.set.wordLang !== data.set.defLang
      ? data.set.defLang
      : STRINGS.options.side_selector.definition;

  return (
    <div className="GravityUIModal">
      <div className="GravityUIModal-box">
        <div className="GravityUIModal-boxHeader">{STRINGS.options.title}</div>
        <div className="GravityOptionsView">
          <div className="GravityUIRow">
            <div className="GravityUIColumn">
              <fieldset className="GravityUIFieldset">
                <div className="GravityUIFieldset-legend">
                  {STRINGS.options.study_starred_selector.title}
                </div>
                <div className="GravityUIToggle">
                  <button
                    type="button"
                    className={`GravityUIToggle-option ${!data.selectedOnly ? 'is-selected' : ''}`}
                    onClick={() => onSelectedOnlyChange?.(false)}
                  >
                    {STRINGS.options.study_starred_selector.all}
                  </button>
                  <button
                    type="button"
                    className={`GravityUIToggle-option ${data.selectedOnly ? 'is-selected' : ''}`}
                    disabled={starredCount === 0}
                    title={
                      starredCount === 0
                        ? 'Star terms on the import screen first (click ★ next to a row)'
                        : `Study only your ${starredCount} starred term${starredCount === 1 ? '' : 's'}`
                    }
                    onClick={() => onSelectedOnlyChange?.(true)}
                  >
                    {STRINGS.options.study_starred_selector.starred}
                  </button>
                </div>
              </fieldset>
            </div>
            <div className="GravityUIColumn">
              <fieldset className="GravityUIFieldset">
                <div className="GravityUIFieldset-legend">
                  {STRINGS.options.side_selector.title}
                </div>
                {/* Custom toggle group — replaces the native <select> dropdown
                    (whose option popup is OS-rendered and can't be styled with
                    CSS, so it looked like a "weird grey popup" in both modes).
                    Now three toggle buttons that match the difficulty selector
                    pattern below, so they pick up the same blue/gold light-mode
                    styling and the same twilight-500 dark-mode styling. */}
                <div
                  className="GravityUIToggle"
                  role="radiogroup"
                  aria-label={STRINGS.options.side_selector.title}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={answerSideValue === 'word'}
                    disabled={data.hasPhotoOnlyDefinitions}
                    className={`GravityUIToggle-option ${answerSideValue === 'word' ? 'is-selected' : ''}`}
                    onClick={() => onSideChange('definition')}
                  >
                    {wordLabel}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={answerSideValue === 'definition'}
                    disabled={data.hasPhotoOnlyDefinitions}
                    className={`GravityUIToggle-option ${answerSideValue === 'definition' ? 'is-selected' : ''}`}
                    onClick={() => onSideChange('word')}
                  >
                    {defLabel}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={answerSideValue === 'random'}
                    disabled={data.hasPhotoOnlyDefinitions}
                    className={`GravityUIToggle-option ${answerSideValue === 'random' ? 'is-selected' : ''}`}
                    onClick={() => onSideChange('random')}
                  >
                    {STRINGS.options.side_selector.random}
                  </button>
                </div>
              </fieldset>
            </div>
          </div>

          <div className="GravityOptionsView-row">
            <fieldset className="GravityUIFieldset">
              <div className="GravityUIFieldset-legend">
                {STRINGS.options.difficulty_selector.title}
              </div>
              <div
                className="GravityUIToggle"
                role="radiogroup"
                aria-label={STRINGS.options.difficulty_selector.title}
              >
                {DIFFICULTY_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={data.difficultyLevel === d}
                    className={`GravityUIToggle-option ${data.difficultyLevel === d ? 'is-selected' : ''}`}
                    onClick={() => onDifficultyChange(d)}
                  >
                    {STRINGS.options.difficulty_selector[DIFFICULTY_LABEL_KEY[d]]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="GravityOptionsView-row">
            {showMultipleAnswersOption ? (
              <div>
                <label className="GravityUICheckbox">
                  <input
                    type="checkbox"
                    checked={acceptsPartialAnswer}
                    onChange={() => {
                      const next = !acceptsPartialAnswer;
                      setAcceptsPartialAnswer(next);
                      onPartialChange(next);
                    }}
                  />
                  <span className="GravityUICheckbox-label">
                    {STRINGS.options.multiple_answers.label}
                  </span>
                </label>
                <div className="GravityUISmall">
                  {STRINGS.options.multiple_answers.description}
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="UILink"
                onClick={() => setShowMultipleAnswersOption(true)}
              >
                {STRINGS.options.multiple_answers.show_feedback_options}
              </button>
            )}
          </div>

          <div className="GravityOptionsView-nextButtonWrapper">
            <button
              className="UIButton UIButton--hero UIButton--fill"
              aria-label={STRINGS.options.next_button}
              onClick={onNext}
            >
              {STRINGS.options.next_button}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Directions ---------------- */
export function DirectionsView({ onStart }: { onStart: () => void }) {
  return (
    <div className="GravityUIModal">
      <div className="GravityUIModal-box">
        <div className="GravityDirectionsView">
          <div className="GravityDirectionsView-asteroidImage" />
          <div className="GravityDirectionsView-title">
            {STRINGS.directions.title}
          </div>
          {STRINGS.directions.body.map((p, i) => (
            <p key={i} className="GravityUIParagraph">
              {p}
            </p>
          ))}
          <div className="GravityDirectionsView-startButton">
            <button
              className="UIButton UIButton--hero"
              aria-label={STRINGS.directions.start_button}
              onClick={onStart}
            >
              {STRINGS.directions.start_button}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Error: no available terms ---------------- */
export function ErrorNoAvailableTermsView() {
  return (
    <div className="GravityUIModal">
      <div className="GravityUIModal-box">
        <div className="GravityErrorNoAvailableTermsView">
          <h2 className="GravityUIHeading">
            {STRINGS.error_no_available_terms.heading}
          </h2>
          <p className="GravityUIParagraph">
            {STRINGS.error_no_available_terms.message}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- StartView switch ---------------- */
export function StartView({
  data,
  onStart,
  onOptions,
  onDirections,
  onDifficultyChange,
  onSideChange,
  onPartialChange,
  onSelectedOnlyChange,
}: StartScreenProps) {
  return (
    <div className="GravityStartView">
      <div className="GravityStartView-backdrop" />
      {(() => {
        switch (data.gameState) {
          case GAME_STATES.INTRO:
            // splash start → options (original: displayGameOptions)
            return <SplashView onStart={onOptions} />;
          case GAME_STATES.OPTIONS:
            return (
              <OptionsView
                data={data}
                onDifficultyChange={onDifficultyChange}
                onSideChange={onSideChange}
                onPartialChange={onPartialChange}
                onSelectedOnlyChange={onSelectedOnlyChange}
                onNext={onDirections}
              />
            );
          case GAME_STATES.DIRECTIONS:
            // directions start → gameplay (original: startGame)
            return <DirectionsView onStart={onStart} />;
          case GAME_STATES.ERROR_NO_AVAILABLE_TERMS:
            return <ErrorNoAvailableTermsView />;
          default:
            return null;
        }
      })()}
    </div>
  );
}

/* ---------------- Game over view ---------------- */

/** A single session-score entry: the score and the index of the try it represents. */
export interface LeaderboardEntry {
  /** Original chronological index of this try (0-based). */
  tryIndex: number;
  points: number;
  level: number;
}

export function GameOverView({
  points,
  level,
  leaderboard,
  currentTryIndex,
  onRestart,
  onNewSet,
}: {
  points: number;
  level: number;
  /** All tries this session, sorted descending by points. */
  leaderboard: LeaderboardEntry[];
  /** Chronological index of the try that just ended. */
  currentTryIndex: number;
  onRestart: () => void;
  onNewSet: () => void;
}) {
  const sortedByPoints = [...leaderboard].sort((a, b) => b.points - a.points);
  const rank = sortedByPoints.findIndex((e) => e.tryIndex === currentTryIndex) + 1;
  const isNewHighScore = rank === 1 && leaderboard.length > 1;

  return (
    <div className="GravityUIModal">
      <div className="GravityUIModal-box">
        <div style={{ textAlign: 'center' }}>
          {/* congrats.svg — celebratory graphic shown on every game-over screen */}
          <img
            src="/assets/gravity/congrats.svg"
            alt=""
            aria-hidden="true"
            style={{
              width: '4rem',
              height: '4rem',
              margin: '0 auto 0.5rem',
              display: 'block',
            }}
          />
          <h2 className="GravityUIHeading" style={{ fontSize: '1.875rem' }}>
            {isNewHighScore
              ? STRINGS.game_over.title_high_score
              : STRINGS.game_over.title}
          </h2>
          <p className="GravityUIParagraph" style={{ fontSize: '1.125rem' }}>
            {format(STRINGS.game_over.score_label, { points, level })}
          </p>

          {isNewHighScore ? (
            <p className="GravityGameOverView-highScoreLabel">
              {STRINGS.game_over.high_score_label}
            </p>
          ) : (
            <p className="GravityGameOverView-rankLabel">
              {format(STRINGS.game_over.rank_label, {
                rank,
                total: leaderboard.length,
              })}
            </p>
          )}

          {/* Session leaderboard — ranked list of all tries in this session */}
          {leaderboard.length > 0 ? (
            <div className="GravityGameOverView-leaderboard">
              <div className="GravityGameOverView-leaderboardTitle">
                {STRINGS.game_over.leaderboard_title}
              </div>
              <ol className="GravityGameOverView-leaderboardList">
                {sortedByPoints.map((entry, i) => {
                  const isCurrent = entry.tryIndex === currentTryIndex;
                  return (
                    <li
                      key={entry.tryIndex}
                      className={`GravityGameOverView-leaderboardRow ${isCurrent ? 'is-current' : ''}`}
                    >
                      <span className={`GravityGameOverView-leaderboardRank ${i === 0 ? 'is-top' : ''}`}>
                        {i + 1}.
                      </span>
                      <span
                        className={`GravityGameOverView-leaderboardPoints ${isCurrent ? 'is-current' : ''}`}
                      >
                        {entry.points.toLocaleString()} pts
                        <span className="GravityGameOverView-leaderboardLevel">
                          {' '}· L{entry.level}
                        </span>
                      </span>
                      {isCurrent ? (
                        <span className="GravityGameOverView-leaderboardYou">
                          {STRINGS.game_over.you_label}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              marginTop: '1.5rem',
            }}
          >
            <button className="UIButton UIButton--hero" onClick={onRestart}>
              {STRINGS.game_over.play_again_button}
            </button>
            <button className="UIButton UIButton--default" onClick={onNewSet}>
              {STRINGS.game_over.new_set_button}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
