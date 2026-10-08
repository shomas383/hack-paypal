import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Classifier output never writes to the rate data (or any file): it goes to stdout and to the DB tables only.
const root = process.cwd();
const sources = [
  ...readdirSync(join(root, 'src/domain/classifier'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join('src/domain/classifier', f)),
  'src/server/classifier.ts',
  'scripts/eval-classifier.ts',
];

const FILE_WRITES = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|rename|rm|unlink|mkdir)\s*\(/;
const RATE_DATA_PATH = /data[\\/'"\s,]+rates/;

describe('classifier code never writes files or touches the rate data', () => {
  it.each(sources)('%s', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    expect(src).not.toMatch(FILE_WRITES);
    expect(src).not.toMatch(RATE_DATA_PATH);
  });

  it('covers the eval script and the server service', () => {
    expect(sources).toEqual(expect.arrayContaining(['scripts/eval-classifier.ts', 'src/server/classifier.ts', join('src/domain/classifier', 'classify.ts')]));
  });
});
