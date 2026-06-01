import { expect, test } from 'vitest';
import { BRAND_COLOR, logo } from './brand';

// 着色版でも ascii 本文（wordmark 行）を含む
test('logo contains the ascii art body', () => {
  const out = logo(true);

  expect(out).toContain('G I T');
  expect(out).toContain('H A R V E S T');
});

// 着色版は truecolor の ANSI を含む
test('logo colored output contains the brand truecolor escape', () => {
  const out = logo(true);

  expect(out).toContain(`\u001B[38;2;${BRAND_COLOR}m`);
  expect(out).toContain('\u001B[0m');
});

// プレーン版は ANSI を一切含まない
test('logo plain output contains no ANSI escape', () => {
  const out = logo(false);

  expect(out).not.toContain('\u001B[');
  expect(out).toContain('G I T');
  expect(out).toContain('H A R V E S T');
});
