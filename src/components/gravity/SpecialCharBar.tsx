import { memo } from 'react';

/* ----------------------------------------------------------------------------
   SPECIAL CHARACTER BAR — the rectangle box ABOVE the typing field
   (and above the copy-the-answer input) with one button per special
   character that exists in the currently-learned set.

   Colour: rgb(217, 220, 238) box background, white chips inside.

   The buttons use onMouseDown preventDefault so clicking one NEVER
   steals focus from the typing field — the caret (and the open mobile
   keyboard) stays exactly where it was, and the character is inserted
   at the caret position by the parent component.
---------------------------------------------------------------------------- */

interface Props {
  chars: string[];
  onInsert: (char: string) => void;
}

function SpecialCharBarBase({ chars, onInsert }: Props) {
  if (!chars.length) return null; // set has no special characters -> no bar

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
