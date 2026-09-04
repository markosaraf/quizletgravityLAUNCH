import { memo, useEffect, useRef, useState } from 'react';
import { COPY_SUBMIT_DEBOUNCE, COPY_SUBMIT_INITIAL_DELAY, COPY_FOCUS_DELAY } from '@/lib/gravity/constants';
import { STRINGS } from '@/lib/gravity/strings';
import type { GravityTerm } from '@/lib/gravity/types';

interface Props {
  term: GravityTerm;
  showingSide: 'word' | 'definition';
  previouslyTypedText: string;
  onSubmit: (liveTermId: string, answer: string) => void;
  liveTermId: string;
}

function CopyTermViewBase({
  term,
  showingSide,
  previouslyTypedText,
  onSubmit,
  liveTermId,
}: Props) {
  const [inputValue, setInputValue] = useState(previouslyTypedText);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
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

  const scheduleSubmit = (value: string) => {
    if (submitTimer.current) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(() => {
      onSubmit(liveTermId, value);
    }, COPY_SUBMIT_DEBOUNCE);
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
