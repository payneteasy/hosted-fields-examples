// The signature base string is where OAuth quietly breaks: every part has to be percent-encoded
// to RFC 3986, and encodeURIComponent is not. A wrong byte here is a 401 from the gateway with
// nothing in the log to say why, so these are the vectors that pin it down.

import assert from 'node:assert/strict';
import test from 'node:test';
import { stubSettings } from './settings-stub.js';

stubSettings();
const { baseString, encode } = await import('./oauth.js');

test('encode is RFC 3986, not encodeURIComponent', () => {
  // The five characters encodeURIComponent leaves alone and OAuth does not
  assert.equal(encode("!'()*"), '%21%27%28%29%2A');
  // A space is %20, never +
  assert.equal(encode('John Smith'), 'John%20Smith');
  // + is a literal plus, and must not survive as one
  assert.equal(encode('a+b'), 'a%2Bb');
  // Unreserved characters are left exactly as they are
  assert.equal(encode("abcXYZ019-._~"), 'abcXYZ019-._~');
  // Non-ASCII is encoded per UTF-8 byte
  assert.equal(encode('é'), '%C3%A9');
});

test('baseString sorts the parameters and encodes each part once', () => {
  const base = baseString('post', 'https://gateway.example/paynet/api/v4/sale/123', {
    oauth_consumer_key: 'merchant',
    amount: '1.00',
    client_orderid: 'hf-1',
  });

  // METHOD is upper-cased, the URL is encoded whole, and the parameter list is encoded again
  assert.equal(
    base,
    'POST&https%3A%2F%2Fgateway.example%2Fpaynet%2Fapi%2Fv4%2Fsale%2F123&' +
      'amount%3D1.00%26client_orderid%3Dhf-1%26oauth_consumer_key%3Dmerchant',
  );
});

test('baseString orders by key, not by insertion', () => {
  const ordered = baseString('POST', 'https://gateway.example/x', { a: '1', b: '2' });
  const shuffled = baseString('POST', 'https://gateway.example/x', { b: '2', a: '1' });
  assert.equal(ordered, shuffled);
});
