'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadImportedSet,
  loadStoredSeparator,
  loadStoredTheme,
  parseCsv,
  parsePastedList,
  readFileAsText,
  saveImportedSet,
  saveStoredSeparator,
  saveStoredTheme,
} from '@/lib/gravity/parse';
import type { Separator, Theme } from '@/lib/gravity/parse';
import { STRINGS, format } from '@/lib/gravity/strings';
import type { GravitySet, GravityTerm } from '@/lib/gravity/types';

interface Props {
  onStart: (set: GravitySet, terms: GravityTerm[]) => void;
}

const SAMPLE = 'helio-, sun\ngeo-, earth\nbio-, life\nchrom-, color';

const SEPARATOR_ORDER: Separator[] = ['comma', 'semicolon', 'dash'];
const THEME_ORDER: Theme[] = ['light', 'dark'];

export function ImportScreen({ onStart }: Props) {
  const [tab, setTab] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // User-selected separator (comma / semicolon / dash). Persisted to
  // localStorage so it survives reloads. Defaults to 'comma' (most common CSV
  // separator). Read post-hydration via setTimeout to avoid the
  // set-state-in-effect lint rule (same pattern as `lastSet` below).
  const [separator, setSeparator] = useState<Separator>('comma');
  useEffect(() => {
    const t = setTimeout(() => setSeparator(loadStoredSeparator()), 0);
    return () => clearTimeout(t);
  }, []);

  // User-selected theme (dark / light). Persisted to localStorage. Defaults
  // to 'light' (the site-wide default — see also the pre-paint theme script
  // in src/app/layout.tsx). Applied to <html data-theme> post-hydration to
  // avoid SSR mismatch.
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const t = setTimeout(() => {
      const stored = loadStoredTheme();
      setTheme(stored);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', stored);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const handleThemeChange = useCallback((next: Theme) => {
    setTheme(next);
    saveStoredTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
  }, []);

  // Quizlet set import — one-click fetch of a public Quizlet set's terms &
  // definitions through the site's own /api/import-quizlet route (browsers
  // can't request quizlet.com directly: Quizlet sends no CORS headers, so
  // the fetch happens server-side). On success the cards are poured into
  // the textarea as tab-separated lines so they flow through the exact
  // same parse → preview-table pipeline as pasted terms, fully editable.
  const [quizletOpen, setQuizletOpen] = useState(false);
  const [quizletUrl, setQuizletUrl] = useState('');
  const [quizletBusy, setQuizletBusy] = useState(false);
  const [quizletStatus, setQuizletStatus] = useState<string | null>(null);
  const [quizletError, setQuizletError] = useState<string | null>(null);

  const handleQuizletImport = useCallback(async () => {
    const link = quizletUrl.trim();
    if (!link) {
      setQuizletError(STRINGS.import.quizlet.error_no_url);
      return;
    }
    setQuizletBusy(true);
    setQuizletError(null);
    setQuizletStatus(null);
    try {
      const res = await fetch(`/api/import-quizlet?url=${encodeURIComponent(link)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : STRINGS.import.error_generic,
        );
      }
      const cards = (data?.cards ?? []) as Array<{ term: string; definition: string }>;
      if (cards.length < 2) throw new Error(STRINGS.import.error_single);
      // Tab-separated on purpose: the paste parser always tries tab FIRST
      // (see splitPastedLine), so pairs split correctly no matter which
      // separator is selected — and commas inside terms/definitions
      // ("le client, la cliente") stay safe.
      setText(cards.map((c) => `${c.term}\t${c.definition}`).join('\n'));
      // Reuse the existing "file name" slot so the Quizlet set title becomes
      // the study-set title on Start.
      setFileName(typeof data?.title === 'string' ? data.title : 'Quizlet set');
      setTab('paste');
      setError(null);
      const skippedNote =
        typeof data?.skipped === 'number' && data.skipped > 0
          ? format(STRINGS.import.quizlet.skipped_note, { count: data.skipped })
          : '';
      setQuizletStatus(
        format(STRINGS.import.quizlet.success, {
          count: cards.length,
          title: typeof data?.title === 'string' ? data.title : 'Quizlet set',
        }) + skippedNote,
      );
      setQuizletOpen(false);
    } catch (err) {
      setQuizletError(err instanceof Error ? err.message : STRINGS.import.error_generic);
    } finally {
      setQuizletBusy(false);
    }
  }, [quizletUrl]);

  /**
   * Editable terms table.
   *
   * `text` (the textarea) is the parsing source-of-truth: every keystroke in
   * the textarea re-parses and overwrites `terms`. After parsing, the user can
   * edit any cell to fix mis-splits (e.g. "hello, world, foo" — the comma
   * splitter would put "hello" as term and "world, foo" as definition, but the
   * user can move text between the two cells directly). Row edits do NOT write
   * back to the textarea.
   *
   * We use the "adjust state during render" pattern (see React docs:
   * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
   * to re-parse whenever `text` / `tab` / `separator` changes, without an
   * effect.
   */
  const [terms, setTerms] = useState<GravityTerm[]>([]);
  const [lastSource, setLastSource] = useState<{
    text: string;
    tab: 'paste' | 'file';
    separator: Separator;
  }>({ text: '', tab: 'paste', separator: 'comma' });
  if (
    lastSource.text !== text ||
    lastSource.tab !== tab ||
    lastSource.separator !== separator
  ) {
    setLastSource({ text, tab, separator });
    setTerms(
      tab === 'paste'
        ? parsePastedList(text, separator)
        : parseCsv(text, separator).terms,
    );
  }

  // offer to restore the last set (read post-hydration to avoid SSR mismatch)
  const [lastSet, setLastSet] = useState<{
    title: string;
    terms: GravityTerm[];
  } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setLastSet(loadImportedSet()), 0);
    return () => clearTimeout(t);
  }, []);
  const restored = !!lastSet;

  const handleFile = useCallback(async (file: File) => {
    try {
      const content = await readFileAsText(file);
      setText(content);
      setFileName(file.name);
      setError(null);
    } catch {
      setError(STRINGS.import.error_generic);
    }
  }, []);

  const handleStart = useCallback(() => {
    // filter out empty rows so the user can leave blanks while editing
    const cleaned = terms
      .map((t) => ({ ...t, word: t.word.trim(), definition: t.definition.trim() }))
      .filter((t) => t.word !== '' || t.definition !== '');
    if (cleaned.length < 2) {
      setError(
        cleaned.length === 0
          ? STRINGS.import.error_generic
          : STRINGS.import.error_single,
      );
      return;
    }
    const set: GravitySet = {
      id: 'imported',
      title: fileName ?? 'My study set',
      wordLang: 'en',
      defLang: 'en',
    };
    saveImportedSet(set.title, cleaned);
    onStart(set, cleaned);
  }, [terms, fileName, onStart]);

  const handleRestore = useCallback(() => {
    if (!lastSet) return;
    onStart(
      { id: 'imported', title: lastSet.title, wordLang: 'en', defLang: 'en' },
      lastSet.terms,
    );
  }, [lastSet, onStart]);

  // ---- editable cell helpers ----
  const updateTermWord = useCallback((id: string, word: string) => {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, word } : t)));
  }, []);

  const updateTermDefinition = useCallback((id: string, definition: string) => {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, definition } : t)));
  }, []);

  const deleteTerm = useCallback((id: string) => {
    setTerms((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleStarred = useCallback((id: string) => {
    setTerms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, starred: !t.starred } : t)),
    );
  }, []);

  const handleSeparatorChange = useCallback((sep: Separator) => {
    setSeparator(sep);
    saveStoredSeparator(sep);
    setError(null);
  }, []);

  const addBlankTerm = useCallback(() => {
    setTerms((prev) => [
      ...prev,
      {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        luid: '',
        word: '',
        definition: '',
        starred: false,
      },
    ]);
  }, []);

  // show all terms (no truncation) — the user needs to see them all to edit
  const visibleTerms = terms;
  const previewLabel = useMemo(
    () => format(STRINGS.import.detected, { count: terms.length }),
    [terms.length],
  );

  return (
    <div className="gravity-root">
      <div className="GravityImportView">
        <div className="GravityImportView-inner">
          <h1 className="GravityImportView-title">{STRINGS.import.title}</h1>
          <p className="GravityImportView-subtitle">{STRINGS.import.subtitle}</p>

          <div className="GravityImportCard">
            <div className="GravityImportTheme" role="group" aria-label={STRINGS.import.theme_selector.label}>
              <span className="GravityImportTheme-label">
                {STRINGS.import.theme_selector.label}:
              </span>
              <div className="GravityImportTheme-toggle">
                {THEME_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`GravityImportTheme-option ${theme === t ? 'is-selected' : ''}`}
                    onClick={() => handleThemeChange(t)}
                    aria-pressed={theme === t}
                  >
                    {STRINGS.import.theme_selector[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Option row — "Import Quizlet Set" button sits LEFT of the
                existing "Paste terms" / "Upload CSV" tabs. */}
            <div className="GravityImportTopbar">
              <button
                type="button"
                className={`GravityImportQuizlet-button ${quizletOpen ? 'is-open' : ''}`}
                onClick={() => {
                  setQuizletOpen((o) => !o);
                  setQuizletError(null);
                }}
                aria-expanded={quizletOpen}
                aria-controls="quizlet-import-panel"
              >
                {STRINGS.import.quizlet.button}
              </button>

              <div className="GravityImportTabs">
                <button
                  type="button"
                  className={`GravityImportTab ${tab === 'paste' ? 'is-active' : ''}`}
                  onClick={() => {
                    setTab('paste');
                    setError(null);
                  }}
                >
                  {STRINGS.import.paste_tab}
                </button>
                <button
                  type="button"
                  className={`GravityImportTab ${tab === 'file' ? 'is-active' : ''}`}
                  onClick={() => {
                    setTab('file');
                    setError(null);
                  }}
                >
                  {STRINGS.import.file_tab}
                </button>
              </div>
            </div>

            {/* Quizlet import panel — URL input + fetch; terms land in the
                same preview table used by paste/CSV. */}
            {quizletOpen ? (
              <div className="GravityImportQuizlet" id="quizlet-import-panel">
                <div className="GravityImportQuizlet-row">
                  <label className="GravityImportQuizlet-label" htmlFor="quizlet-url-input">
                    {STRINGS.import.quizlet.url_label}
                  </label>
                  <input
                    id="quizlet-url-input"
                    type="url"
                    className="GravityImportQuizlet-input"
                    value={quizletUrl}
                    placeholder={STRINGS.import.quizlet.url_placeholder}
                    onChange={(e) => {
                      setQuizletUrl(e.target.value);
                      setQuizletError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleQuizletImport();
                      }
                    }}
                    disabled={quizletBusy}
                  />
                  <button
                    type="button"
                    className="GravityImportQuizlet-fetch"
                    onClick={() => void handleQuizletImport()}
                    disabled={quizletBusy || quizletUrl.trim() === ''}
                  >
                    {quizletBusy
                      ? STRINGS.import.quizlet.fetching
                      : STRINGS.import.quizlet.fetch_button}
                  </button>
                </div>
                <p className="GravityImportQuizlet-hint">{STRINGS.import.quizlet.hint}</p>
                {quizletStatus ? (
                  <div className="GravityImportQuizlet-status" role="status">
                    {quizletStatus}
                  </div>
                ) : null}
                {quizletError ? (
                  <div className="GravityImportQuizlet-error" role="alert">
                    {quizletError}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="GravityImportSeparator" role="group" aria-label={STRINGS.import.separator_selector.title}>
              <span className="GravityImportSeparator-label">
                {STRINGS.import.separator_selector.title}:
              </span>
              <div className="GravityImportSeparator-toggle">
                {SEPARATOR_ORDER.map((sep) => (
                  <button
                    key={sep}
                    type="button"
                    className={`GravityImportSeparator-option ${separator === sep ? 'is-selected' : ''}`}
                    onClick={() => handleSeparatorChange(sep)}
                    aria-pressed={separator === sep}
                  >
                    {STRINGS.import.separator_selector[sep]}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'paste' ? (
              <>
                <textarea
                  className="GravityImportTextarea"
                  value={text}
                  placeholder={SAMPLE}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  aria-label={STRINGS.import.paste_tab}
                />
                <p className="GravityImportMeta">{STRINGS.import.meta_paste}</p>
              </>
            ) : (
              <>
                <label className="GravityImportFileLabel">
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    className="GravityImportFileInput"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  />
                  {fileName ? `📄 ${fileName}` : STRINGS.import.file_label}
                </label>
                <p className="GravityImportMeta">{STRINGS.import.file_hint}</p>
              </>
            )}

            {visibleTerms.length > 0 ? (
              <div className="GravityImportPreview" aria-live="polite">
                <div className="GravityImportPreview-header">
                  <span>{previewLabel}</span>
                  <button
                    type="button"
                    className="GravityImportPreview-addRow"
                    onClick={addBlankTerm}
                    aria-label="Add a row"
                  >
                    + row
                  </button>
                </div>
                <div
                  className="GravityImportPreview-columnLabels"
                  role="row"
                  aria-label="Column labels"
                >
                  <span className="GravityImportPreview-columnLabels-spacer" />
                  <span className="GravityImportPreview-columnLabel GravityImportPreview-columnLabel--term">
                    {STRINGS.options.side_selector.term}
                  </span>
                  <span className="GravityImportPreview-columnLabel GravityImportPreview-columnLabel--definition">
                    {STRINGS.options.side_selector.definition}
                  </span>
                  <span className="GravityImportPreview-columnLabels-spacer--end" />
                </div>
                <div className="GravityImportPreview-table">
                  {visibleTerms.map((t, i) => (
                    <div key={t.id} className="GravityImportPreview-row">
                      <span className="GravityImportPreview-index">{i + 1}</span>
                      <input
                        className="GravityImportPreview-input GravityImportPreview-input--term"
                        type="text"
                        value={t.word}
                        placeholder="term"
                        onChange={(e) => updateTermWord(t.id, e.target.value)}
                        aria-label={`Row ${i + 1} term`}
                      />
                      <input
                        className="GravityImportPreview-input GravityImportPreview-input--definition"
                        type="text"
                        value={t.definition}
                        placeholder="definition"
                        onChange={(e) => updateTermDefinition(t.id, e.target.value)}
                        aria-label={`Row ${i + 1} definition`}
                      />
                      <button
                        type="button"
                        className={`GravityImportPreview-starRow ${t.starred ? 'is-starred' : ''}`}
                        onClick={() => toggleStarred(t.id)}
                        aria-pressed={!!t.starred}
                        aria-label={t.starred ? `Unstar row ${i + 1}` : `Star row ${i + 1}`}
                        title={t.starred ? 'Starred — will appear in Starred-only mode' : 'Click to star this term'}
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        className="GravityImportPreview-deleteRow"
                        onClick={() => deleteTerm(t.id)}
                        aria-label={`Delete row ${i + 1}`}
                        title="Delete row"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="GravityImportError" role="alert">
                {error}
              </div>
            ) : null}

            <div className="GravityImportActions">
              <button
                className="UIButton UIButton--hero"
                onClick={handleStart}
                disabled={terms.length < 2}
              >
                {STRINGS.import.start_button}
              </button>
              <button
                className="UIButton UIButton--default"
                onClick={() => {
                  setText('');
                  setFileName(null);
                  setError(null);
                }}
              >
                {STRINGS.import.clear_button}
              </button>
            </div>
          </div>

          {restored && lastSet ? (
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <button className="UILink" onClick={handleRestore}>
                {STRINGS.import.last_set} ({lastSet.terms.length} terms) →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
