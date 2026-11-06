import {STRINGS} from '@/lib/gravity/strings';
import './ImportProgress.css';

// Estimated progress approaches 97%. Only a successful response reaches 100%.
export const progressAfterMs = (elapsedMs: number) =>
  Math.round(Math.min(97, 100 * (1 - Math.exp(-elapsedMs / 11_000))));

export function ImportProgress({progress, busy}: {progress:number; busy:boolean}) {
  return <div className="GravityImportQuizlet-progress">
    <div className="GravityImportQuizlet-progressHeader">
      <span className="GravityImportQuizlet-progressLabel" role="status">
        {progress >= 100 ? STRINGS.import.quizlet.progress_done : STRINGS.import.quizlet.progress_label}
      </span>
      <span className="GravityImportQuizlet-progressPct" aria-hidden="true">{progress}%</span>
    </div>
    <div className="GravityImportQuizlet-progressTrack" role="progressbar" aria-label="Importing Quizlet set"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
      <div className="GravityImportQuizlet-progressFill" style={{width:`${progress}%`}}/>
    </div>
    {busy && <p className="GravityImportQuizlet-progressHint">{STRINGS.import.quizlet.progress_hint}</p>}
  </div>;
}
