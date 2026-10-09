import { describe, expect, it } from 'vitest';
import { checkCh99Headings, parseCh99Headings } from './ch99Headings';

const lookup = {
  '9903.05.31': 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of China, as provided for in U.S. note 52 to this subchapter',
  '9903.88.15': 'Except as provided in headings 9903.88.39, … articles the product of China, as provided for in U.S. note 20(r) …',
  '9903.88.16': "Articles the product of China, as provided for in U.S. note 20(t) … [Compiler's note: provision suspended.]",
};

describe('parseCh99Headings — sheet column O may list several Chapter 99 headings joined by " + "', () => {
  it('reads one or several headings, in order', () => {
    expect(parseCh99Headings('9903.05.49')).toEqual(['9903.05.49']);
    expect(parseCh99Headings('9903.05.31 + 9903.88.15')).toEqual(['9903.05.31', '9903.88.15']);
    expect(parseCh99Headings(' 9903.05.31+9903.88.15 ')).toEqual(['9903.05.31', '9903.88.15']);
  });

  it('rejects anything that is not 99NN.NN.NN headings, and duplicates', () => {
    for (const bad of ['', '9903.05', '9903.05.31 and 9903.88.15', '9903.05.31 + 9903.05.31', '6203.42.45']) {
      expect(() => parseCh99Headings(bad)).toThrow();
    }
  });
});

describe('checkCh99Headings — every heading must be in the official Ch. 99 lookup and not suspended', () => {
  it('passes active headings', () => {
    expect(checkCh99Headings(['9903.05.31', '9903.88.15'], lookup)).toEqual([]);
  });

  it('fails a heading that is missing or marked suspended (e.g. List 4B 9903.88.16)', () => {
    expect(checkCh99Headings(['9903.99.99'], lookup).join('\n')).toMatch(/9903\.99\.99.*not in the HTS Ch\. 99 lookup/);
    expect(checkCh99Headings(['9903.88.16'], lookup).join('\n')).toMatch(/9903\.88\.16.*suspended/);
  });
});
