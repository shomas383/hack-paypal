import { describe, expect, it } from 'vitest';
import { agentTextFailures, agentTextWarnings, finalMessage, finalMessageWarnings, sentenceCount } from './finalMessage';

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

describe('agentTextFailures with the official levels a search matched (HTS-description matches)', () => {
  const levels = ['With automatic winding:', 'Other wrist watches, whether or not incorporating a stop watch facility:'];

  it('quoting a matched official level is a failure (the search card shows it)', () => {
    expect(agentTextFailures('L-C-469846d7 is written in Japanese and matched on "With automatic winding".', levels)).toEqual(['quotes official text']);
    expect(agentTextFailures('It matched “other wrist watches, whether or not incorporating a stop watch facility”.', levels)).toEqual(['quotes official text']);
  });

  it('saying it was matched on its official HTS description, without quoting it, is fine', () => {
    expect(agentTextFailures('L-C-469846d7 is written in Japanese and was matched on its official HTS description.', levels)).toEqual([]);
    expect(agentTextFailures('Short quotes like "automatic" are not official-text quotes.', levels)).toEqual([]);
  });
});

describe('agentTextWarnings (warnings only, never failures)', () => {
  const toolStrings = ['自動巻き ダイバーズウォッチ ステンレスケース ステンレスブレス 1990年代', 'Automatic diver watch, 21 jewels, stainless case, steel bracelet (Germany)'];

  it('a quoted span of ≥ 3 words that no tool returned (e.g. an invented translation) is a WARN', () => {
    expect(agentTextWarnings('The Japanese listing says "automatic diver watch from the 1990s".', { toolStrings, chainOnlyIds: [] })).toEqual([
      'quoted text not in any tool result: "automatic diver watch from the 1990s"',
    ]);
  });

  it('quotes taken verbatim from tool results, and short quotes, are fine', () => {
    expect(agentTextWarnings('It is listed as "Automatic diver watch, 21 jewels" from Germany; the "1990年代" era is the seller\'s claim.', { toolStrings, chainOnlyIds: [] })).toEqual([]);
  });

  it('naming a chain-only listing without saying it was matched on the HTS description is a WARN', () => {
    expect(agentTextWarnings('L-C-469846d7 costs the same as L-P03.', { toolStrings, chainOnlyIds: ['L-C-469846d7'] })).toEqual([
      'names L-C-469846d7 (an HTS-description match) without saying so: "L-C-469846d7 costs the same as L-P03."',
    ]);
    expect(agentTextWarnings('L-C-469846d7 is written in Japanese and was matched on its official HTS description.', { toolStrings, chainOnlyIds: ['L-C-469846d7'] })).toEqual([]);
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
