// Three real steps of a grounded classification (labels and states come from progressView on the server).
// The current step is announced politely (progress, not token streaming).
import type { ProgressStep } from '@/domain/classifier/progress';
import { Icon } from '../Icon';
import s from './ClassificationProgress.module.css';

const ICON = { pending: 'dot', active: 'spinner', done: 'check-circle', failed: 'x-circle' } as const;
const WORD = { pending: 'Not started', active: 'In progress', done: 'Done', failed: 'Failed' } as const;

export function ClassificationProgress({ steps }: { steps: ProgressStep[] }) {
  const current = steps.find((x) => x.state === 'active') ?? steps.filter((x) => x.state !== 'pending').at(-1);
  return (
    <div className={s.wrap} data-testid="classification-progress">
      <ol className={s.steps}>
        {steps.map((st, i) => (
          <li key={i} className={`${s.step} ${s[st.state]}`}>
            <Icon name={ICON[st.state]} label={WORD[st.state]} />
            <span>{st.label}</span>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {current?.label ?? ''}
      </p>
    </div>
  );
}
