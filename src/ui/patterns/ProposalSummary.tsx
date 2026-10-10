// The agent's proposal — the one bordered block on /agent (it holds the page's decision). Not an approval: the buyer
// reviews and approves at checkout. A refusal shows the code's message verbatim.
import { ButtonLink } from '../Button';
import { Disclosure } from '../Disclosure';
import { Icon } from '../Icon';
import s from './ProposalSummary.module.css';

export const ESTIMATE_SENTENCE =
  'Includes US import duty, estimated from verified rates and paid here at checkout (delivered duty paid). Not a customs ruling.';

export function ProposalSummary({
  proposed,
  listingId,
  origin,
  title,
  delivered,
  budget,
  checkoutUrl,
  reasoning,
  refusal,
}: {
  proposed: boolean;
  listingId?: string | undefined;
  origin?: string | undefined;
  title?: string | undefined;
  delivered?: string | undefined;
  budget?: string | undefined;
  checkoutUrl?: string | undefined;
  reasoning?: string | undefined;
  refusal?: string | undefined;
}) {
  if (!proposed) {
    return (
      <section className={`${s.box} ${s.refused}`} aria-labelledby="proposal-h">
        <h2 id="proposal-h" className={s.h}>
          Purchase not prepared
        </h2>
        <p data-testid="agent-refusal" className={s.refusal}>
          <Icon name="x-circle" />
          <span>{refusal}</span>
        </p>
      </section>
    );
  }
  return (
    <section className={s.box} aria-labelledby="proposal-h" data-testid="agent-proposal">
      <h2 id="proposal-h" className={s.h}>
        Proposed purchase, not yet approved
      </h2>
      <p className={s.item}>
        <span className={s.mono}>{listingId}</span>
        {origin ? ` (${origin})` : ''}
        {title ? ` · ${title}` : ''}
      </p>
      <p className={s.total}>
        Delivered <strong>{delivered}</strong>
        <span className={s.muted}> · within your confirmed budget of {budget}</span>
      </p>
      <p className={s.muted}>{ESTIMATE_SENTENCE}</p>
      {reasoning ? (
        <Disclosure summary="Agent's reasoning">
          <p>{reasoning}</p>
        </Disclosure>
      ) : null}
      <div className={s.actions}>
        <ButtonLink href={checkoutUrl} data-testid="agent-checkout-link">
          Review and approve at checkout
        </ButtonLink>
        <span className={s.muted}>Nothing is bought until you approve and pay with your own PayPal login.</span>
      </div>
    </section>
  );
}
