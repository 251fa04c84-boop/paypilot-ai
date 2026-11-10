'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../lib/password');

test('scrypt password hashes are salted, encoded and verified safely', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('correct horse battery staple', 'invalid'), false);
});
test('rejects weak or oversized passwords', async () => {
  await assert.rejects(() => hashPassword('short'), /12 and 128/);
  await assert.rejects(() => hashPassword('x'.repeat(129)), /12 and 128/);
});
