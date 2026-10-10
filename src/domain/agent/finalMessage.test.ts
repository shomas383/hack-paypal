import { describe, expect, it } from 'vitest';
import { finalMessage, finalMessageIssues, sentenceCount } from './finalMessage';

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

describe('finalMessageIssues', () => {
  it('flags a checkout path or URL', () => {
    expect(finalMessageIssues('Open the checkout link (/checkout/f52ad534-c933-4dac-8e4f-efc002038f28) to approve. It is $344.00.')).toContain('contains a checkout path');
    expect(finalMessageIssues('See https://example.test/x for details. It is $344.00.')).toContain('contains a URL');
  });

  it('flags quoted official text and a length outside 2–4 sentences', () => {
    expect(finalMessageIssues('It covers "articles the product of a member state of the European Union, with an ad valorem rate". Pick L-P14.')).toContain('quotes official text');
    expect(finalMessageIssues('One sentence only.')).toContain('1 sentence(s), expected 2–4');
  });

  it('a good final message has no issues', () => {
    expect(
      finalMessageIssues(
        "I recommend the German watch (L-P14) at **$344.00 delivered**, within your $400.00 budget. It's the cheapest delivered because its duty is lowest ($29.00). Review the duty lines on the proposal card and approve if you agree.",
      ),
    ).toEqual([]);
  });
});
