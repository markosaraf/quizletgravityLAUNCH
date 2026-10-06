import { memo } from 'react';

/* ----------------------------------------------------------------------------
   SPECIAL CHARACTER SQUARES — the letter boxes ABOVE the typing field,
   one per special character that exists in the currently-learned set.

   There is deliberately NO surrounding bar: the squares themselves are
   the whole widget and carry the rgb(217, 220, 238) fill directly (each
   square is exactly as tall as the old bar was — see gravity.css).

   The squares always rest in the same place above the MAIN typing field;
   they never move to the top when the copy-the-answer view opens. Every
   click is routed by GameplayView to the field that is currently active.

   The buttons use onMouseDown preventDefault so clicking one NEVER
   steals focus from the active typing field — the caret (and the open
   mobile keyboard) stays exactly where it was, and the character is
   inserted at the caret position.
---------------------------------------------------------------------------- */

interface Props {
  chars: string[];
  onInsert: (char: string) => void;
}

function SpecialCharBarBase({ chars, onInsert }: Props) {
  if (!chars.length) return null; // set has no special characters -> no squares

  return (
    <div className="GravitySpecialChars" role="group" aria-label="Special characters">
      {chars.map((ch) => (
        <button
          key={ch}
          type="button"
          className="GravitySpecialChars-button"
          onMouseDown={(e) => e.preventDefault() /* keep textarea focus + caret */}
          onClick={() => onInsert(ch)}
          title={`Insert "${ch}"`}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}

export const SpecialCharBar = memo(SpecialCharBarBase);
