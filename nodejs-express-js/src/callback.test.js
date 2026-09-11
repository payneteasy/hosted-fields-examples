// The 3DS return is only as good as this checksum: it is what separates a payer coming back from
// the bank from somebody typing an order id into the address bar. The vectors below were computed
// outside this code, so a change in how the string is assembled shows up here as a failure rather
// than agreeing with itself.

import assert from 'node:assert/strict';
import test from 'node:test';
import { stubSettings } from './settings-stub.js';

stubSettings();
const { SIGNED_CALLBACK_FIELDS, validCallback } = await import('./callback.js');

// sha1('approved' + '1234567' + 'hf-abc' + 'test-merchant-control')
const CONTROL = '652ace404c4dfe8bba069ecee594ec23a89340e1';
const CALLBACK = {
  status: 'approved',
  orderid: '1234567',
  merchant_order: 'hf-abc',
  control: CONTROL,
};

test('a callback the gateway signed is accepted', () => {
  assert.equal(validCallback(CALLBACK), true);
});

test('every signed field is part of the checksum', () => {
  for (const field of ['status', 'orderid', 'merchant_order']) {
    assert.equal(validCallback({ ...CALLBACK, [field]: 'edited' }), false, `${field} is not signed`);
  }
});

test('a wrong control of the right length is rejected', () => {
  const wrong = `${CONTROL.slice(0, -1)}${CONTROL.endsWith('1') ? '2' : '1'}`;
  assert.equal(wrong.length, CONTROL.length);
  assert.equal(validCallback({ ...CALLBACK, control: wrong }), false);
});

test('a control of the wrong length is rejected, not thrown on', () => {
  // timingSafeEqual throws when the lengths differ, so this is the case that would surface as a
  // 500 rather than as a 403 if the length check were dropped.
  assert.equal(validCallback({ ...CALLBACK, control: 'short' }), false);
  assert.equal(validCallback({ ...CALLBACK, control: `${CONTROL}extra` }), false);
});

test('a request with nothing in it is rejected', () => {
  // sha1('' + '' + '' + 'test-merchant-control') — an empty callback still has a checksum, and it
  // is not the empty string, so a bare /result must not pass.
  assert.equal(validCallback({}), false);
  assert.equal(validCallback({ control: '1a66987ac24e927ff2979f83a41cb818936a9e62' }), true);
});

test('the signed fields travel in the order the page wants them', () => {
  assert.deepEqual(SIGNED_CALLBACK_FIELDS, ['status', 'orderid', 'merchant_order', 'control']);
});
