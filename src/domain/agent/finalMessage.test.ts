import { describe, expect, it } from 'vitest';
import { agentTextFailures, finalMessage, finalMessageWarnings, sentenceCount } from './finalMessage';

type E = { type: string; text?: string };

describe('finalMessage: the agent text after its last tool call', () => {
  it('joins the text deltas after the last tool event', () => {
    const events: E[] = [
      { type: 'text', text: 'Searching. ' },
      { type: 'tool-call' },
      { type: 'tool-result' },
      { type: 'text', text: 'I recommend L-P14. ' },
      { type: 'text', text: 'It is **$344.00 delivered**.' },
      { type: 'done' },
    ];
    expect(finalMessage(events)).toBe('I recommend L-P14. It is **$344.00 delivered**.');
  });

  it('empty when the run ended on a tool call', () => {
    expect(finalMessage([{ type: 'text', text: 'x' }, { type: 'tool-call' }])).toBe('');
  });
});

describe('sentenceCount', () => {
  it('counts sentences; amounts and "U.S." do not split', () => {
    expect(sentenceCount('I recommend the German watch at $344.00 delivered, under your $400.00 budget. It has the lowest duty under U.S. note 52(k). Open the checkout to approve.')).toBe(3);
    expect(sentenceCount('')).toBe(0);
  });
});

describe('agentTextFailures (hard failures, anywhere in the agent text)', () => {
  it('a checkout path, a URL, quoted official text', () => {
    expect(agentTextFailures('Open the checkout link (/checkout/f52ad534-c933-4dac-8e4f-efc002038f28) to approve.')).toEqual(['contains a checkout path']);
    expect(agentTextFailures('See https://example.test/x for details.')).toEqual(['contains a URL']);
    expect(agentTextFailures('It covers "articles the product of a member state of the European Union, with an ad valorem rate".')).toEqual(['quotes official text']);
  });

  it('none for a good message', () => {
    expect(agentTextFailures("I recommend the German watch (L-P14) at **$344.00 delivered**, within your $400.00 budget. It's the cheapest delivered because its duty (9903.05.39) is lowest.")).toEqual([]);
  });
});

describe('finalMessageWarnings (length is a warning, not a failure)', () => {
  it('warns above 4 sentences and on an empty final message', () => {
    expect(finalMessageWarnings('One. Two. Three. Four. Five.')).toEqual(['5 sentences (more than 4)']);
    expect(finalMessageWarnings('')).toEqual(['no final message']);
  });

  it('no warning for 1–4 sentences', () => {
    expect(finalMessageWarnings('I recommend L-P14 at $344.00 delivered, within your $400.00 budget.')).toEqual([]);
    expect(finalMessageWarnings('One. Two. Three. Four.')).toEqual([]);
  });
});
