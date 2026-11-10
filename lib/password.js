'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new TypeError('Password must be between 12 and 128 characters.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLEL, maxmem: MAXMEM });
  return ['scrypt', COST, BLOCK_SIZE, PARALLEL, salt.toString('hex'), derived.toString('hex')].join('$');
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string' || encoded.length > 300) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (n !== COST || r !== BLOCK_SIZE || p !== PARALLEL || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  try {
    const expected = Buffer.from(parts[5], 'hex');
    const actual = await scrypt(password, Buffer.from(parts[4], 'hex'), expected.length, { N: n, r, p, maxmem: MAXMEM });
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
