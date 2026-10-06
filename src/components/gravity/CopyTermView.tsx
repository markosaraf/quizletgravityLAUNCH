import { memo, useEffect, useRef, useState } from 'react';
import { COPY_SUBMIT_DEBOUNCE, COPY_SUBMIT_INITIAL_DELAY, COPY_FOCUS_DELAY } from '@/lib/gravity/constants';
import { STRINGS } from '@/lib/gravity/strings';
import type { GravityTerm } from '@/lib/gravity/types';
import { SpecialCharBar } from './SpecialCharBar';

interface Props {
  term: GravityTerm;
  showingSide: 'word' | 'definition';
  previouslyTypedText: string;
  specialChars: string[];
  onSubmit: (liveTermId: string, answer: string) => void;
  liveTermId: string;
}

function CopyTermViewBase({
  term,
  showingSide,
  previouslyTypedText,
  specialChars,
  onSubmit,
  liveTermId,
}: Props) {
  const [inputValue, setInputValue] = useState(previouslyTypedText);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // caret to restore after a special-char button insertion
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      // preventScroll: no mobile auto-scroll-to-input jump when the modal opens
      inputRef.current?.focus({ preventScroll: true });
      // place caret at end
      const el = inputRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    }, COPY_FOCUS_DELAY);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // initial auto-submit of the previously typed text (original behavior)
    submitTimer.current = setTimeout(() => {
      onSubmit(liveTermId, previouslyTypedText);
    }, COPY_SUBMIT_INITIAL_DELAY);
    return () => {
      if (submitTimer.current) clearTimeout(submitTimer.current);
    };
  }, [liveTermId, onSubmit, previouslyTypedText]);

  // restore the caret after a special-character insertion
  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = inputRef.current;
    if (el) {
      el.setSelectionRange(pos, pos);
      el.focus({ preventScroll: true });
    }
  }, [inputValue]);

  const scheduleSubmit = (value: string) => {
    if (submitTimer.current) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      onSubmit(liveTermId, value);
    }, COPY_SUBMIT_DEBOUNCE);
  };

  /** insert a special character at the caret (replacing any selection) */
  const insertSpecialChar = (char: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + char + el.value.slice(end);
    pendingCaretRef.current = start + char.length;
    setInputValue(next);
    scheduleSubmit(next);
  };

  // original: prompt section shows the side that was falling,
  // answer section shows the other side
  const promptSideContent =
    showingSide === 'word' ? term.word : term.definition;
  const answerSideContent =
    showingSide === 'word' ? term.definition : term.word;

  return (
    <div className="GravityCopyTermView">
      <div className="GravityCopyTermView-inner">
        <div className="GravityCopyTermView-heading">
          {STRINGS.copy_answer_modal.prompt}
        </div>
        <div className="GravityCopyTermView-prompt">
          <div className="GravityCopyTermView-promptText">{promptSideContent}</div>
          {showingSide === 'definition' && term._imageUrl ? (
            <img
              alt={term.definition}
              className="GravityCopyTermView-definitionImage"
              src={term._imageUrl}
            />
          ) : null}
        </div>
        <div className="GravityCopyTermView-heading">
          {STRINGS.copy_answer_modal.correct_answer}
        </div>
        <div className="GravityCopyTermView-answer">
          <div>{answerSideContent}</div>
        </div>
        <div className="GravityCopyTermView-inputWrapper">
          {/* Same special-character bar as the main typing field */}
          <SpecialCharBar chars={specialChars} onInsert={insertSpecialChar} />
          <textarea
            ref={inputRef}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="GravityCopyTermView-input"
            rows={1}
            spellCheck={false}
            value={inputValue}
            placeholder={STRINGS.copy_answer_modal.placeholder}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setInputValue(v);
              scheduleSubmit(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
          />
        </div>
      </div>
    </div>
  );
}

export const CopyTermView = memo(CopyTermViewBase);
