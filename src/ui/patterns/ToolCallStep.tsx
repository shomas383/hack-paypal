// One step of the agent transcript: status icon + verb/object + right-aligned meta; details underneath, no card.
import type { ReactNode } from 'react';
import { Icon } from '../Icon';
import s from './ToolCallStep.module.css';

export type StepState = 'running' | 'done' | 'failed';

export function ToolCallStep({ state, title, meta, children, ...rest }: { state: StepState; title: ReactNode; meta?: ReactNode; children?: ReactNode; 'data-testid'?: string }) {
  return (
    <li className={s.step} {...rest}>
      <div className={s.head}>
        <span className={`${s.icon} ${s[state]}`}>
          <Icon name={state === 'running' ? 'spinner' : state === 'done' ? 'check-circle' : 'x-circle'} label={state === 'running' ? 'In progress' : state === 'done' ? 'Done' : 'Failed'} />
        </span>
        <span className={s.title}>{title}</span>
        {meta ? <span className={s.meta}>{meta}</span> : null}
      </div>
      {children ? <div className={s.body}>{children}</div> : null}
    </li>
  );
}
