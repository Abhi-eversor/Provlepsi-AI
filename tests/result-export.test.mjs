import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, forecastCSV } from '../src/lib/result-export.ts';

test('CSV cells escape delimiters, quotes, newlines, and formula labels', () => {
  assert.equal(csvCell('quoted, "label"\nnext'), '"quoted, ""label""\nnext"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(-2), '-2');
  assert.equal(csvCell(null), '');
});
test('forecast export preserves actual source indices and missing truth', () => {
  const result = {
    history: [{ index: 998, value: 3 }, { index: 999, value: null }],
    evaluation: { actual: [{ index: 999, value: null }], predicted: [{ index: 999, value: 4 }] },
    forecast: [{ index: 1000, value: 5 }],
  };
  const csv = forecastCSV(result);
  assert.match(csv, /historical,998,3,\r\n/);
  assert.match(csv, /evaluation,999,,4\r\n/);
  assert.match(csv, /forecast,1000,,5\r\n/);
  assert.doesNotMatch(csv, /undefined|NaN|\[object Object\]/);
});
