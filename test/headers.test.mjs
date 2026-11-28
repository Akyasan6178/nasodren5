// Cloudflare Pages güvenlik başlıkları (public/_headers): oyun yalnızca kendi sitesinde ve
// yasasinsaglik.com içinde (iframe) açılabilir; başka sitelerin çerçevelemesi engellenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const headers = readFileSync(join(ROOT, 'public', '_headers'), 'utf8');

test('X-Frame-Options yok (frame-ancestors ile çakışıp yasasinsaglik.com içinde açılmayı engeller)', () => {
  assert.doesNotMatch(headers, /x-frame-options/i);
});

test('frame-ancestors yalnızca kendi sitesine ve yasasinsaglik.com\'a izin verir', () => {
  const line = headers.split(/\r?\n/).find((l) => /content-security-policy/i.test(l));
  assert.ok(line, 'Content-Security-Policy satırı yok');
  const value = line.split(':').slice(1).join(':').trim();
  const sources = value.replace(/^frame-ancestors\s+/i, '').split(/\s+/);
  assert.match(value, /^frame-ancestors\s/i);
  assert.deepEqual(sources.sort(), ["'self'", 'https://www.yasasinsaglik.com', 'https://yasasinsaglik.com'].sort());
  assert.ok(!sources.includes('*'), 'her siteye izin verilmemeli');
});

test('diğer güvenlik başlıkları korunuyor', () => {
  for (const h of ['X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'Strict-Transport-Security:', 'Permissions-Policy:']) {
    assert.ok(headers.includes(h), h);
  }
});
