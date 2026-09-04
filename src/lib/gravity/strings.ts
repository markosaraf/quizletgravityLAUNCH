/**
 * Gravity UI strings — reconstructed from the original
 * i18n locale keys (gravity.*) used by the 2020–2024 build.
 */
export const STRINGS = {
  study_mode_name: 'Gravity',
  splash: {
    title: 'Defend Your Planet!',
    description:
      'Protect your planet from incoming asteroids by typing the correct answers before they land.',
    warning_red: 'Watch out for red asteroids!',
    warning_miss: 'If you miss a term twice they will destroy your planet.',
    start_button: 'Start',
  },
  options: {
    title: 'Options',
    next_button: 'Next',
    side_selector: {
      title: 'Answer with',
      term: 'Term',
      definition: 'Definition',
      random: 'Both',
    },
    difficulty_selector: {
      title: 'Difficulty',
      sloth: 'Sloth',
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard',
      mad_max: 'Mad Max',
    },
    study_starred_selector: {
      title: 'Study',
      all: 'All terms',
      starred: 'Starred terms',
    },
    multiple_answers: {
      label: 'Allow partial answers',
      description:
        'Type part of the answer and still get it right.',
      show_feedback_options: 'Show advanced options',
    },
  },
  directions: {
    title: 'How to play',
    body: [
      'Type the answer to destroy each asteroid before it reaches your planet.',
      "If you miss one, you'll have to type the correct answer to keep playing. Miss the same term twice and the game is over.",
      "Don't know an answer? Press ESC to skip it.",
      'Asteroids fall faster as you level up. Good luck!',
    ],
    start_button: 'Start',
  },
  sidebar: {
    score_label: 'Score',
    level_label: 'Level',
    pause_button: 'Pause',
    resume_button: 'Resume',
    restart_button: 'Restart',
  },
  alerts: {
    asteroid_incoming: 'WARNING: RED ASTEROID INCOMING',
    skip: "Don't know the answer? Press esc to skip.",
  },
  level_up: 'LEVEL UP',
  copy_answer_modal: {
    prompt: 'Prompt',
    correct_answer: 'Correct answer',
    placeholder: 'Type here',
  },
  default_prompt_placeholder: 'Type the answer',
  language_prompt_placeholder: 'Type the answer in {languageName}',
  game_over: {
    title: 'Nice try!',
    title_high_score: 'Congratulations',
    score_label: 'You scored {points} points and reached level {level}.',
    high_score_label: 'New high score!',
    rank_label: 'Rank {rank} of {total}',
    leaderboard_title: 'Session leaderboard',
    you_label: 'you',
    play_again_button: 'Play again',
    new_set_button: 'New set',
  },
  error_no_available_terms: {
    heading: 'Ran out of terms',
    message:
      'None of the terms in this set can be studied with the current settings. Try answering with the other side of the terms.',
    back_to_set_button: 'Back',
  },
  desktop_blocker: '', // removed — game is playable at any window size (mobile layout in top bar)
  mobile_blocker: 'Gravity is not supported on mobile devices.',
  import: {
    title: 'Quizlet Gravity',
    subtitle:
      'Paste your terms and definitions (one per line) or upload a CSV file to start studying.',
    paste_tab: 'Paste terms',
    file_tab: 'Upload CSV',
    paste_placeholder: 'term, definition\nterm, definition\n…',
    file_label: 'Click to choose a CSV file',
    file_hint: 'Format: one term and definition per line, separated by a comma, semicolon or tab.',
    meta_paste:
      'Accepted separators per line: comma (,), semicolon (;), tab, or a dash (-) between term and definition. First column = term.',
    detected: '{count} terms detected',
    start_button: 'Start studying',
    clear_button: 'Clear',
    error_generic: 'Could not read any term/definition pairs. Check the format and try again.',
    error_single: 'At least 2 term/definition pairs are required to play.',
    last_set: 'Loaded your last set from this browser.',
    separator_selector: {
      title: 'Separator',
      comma: 'Comma  ,',
      semicolon: 'Semicolon  ;',
      dash: 'Dash  -',
    },
    theme_selector: {
      label: 'Theme',
      dark: 'Dark',
      light: 'Light',
    },
  },
} as const;

export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}
