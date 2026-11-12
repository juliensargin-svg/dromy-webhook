const test = require('node:test');
const assert = require('node:assert/strict');
const { smsBlockReason, normalizePhone } = require('./sms-phone');

test('les portables 06 et 07 reçoivent le SMS', () => {
  assert.equal(smsBlockReason('+33612345678'), null);
  assert.equal(smsBlockReason('+33768038733'), null);
});

test('fixes, box et numéros spéciaux sont bloqués', () => {
  assert.equal(smsBlockReason('+33144751234'), 'numéro fixe');   // +331
  assert.equal(smsBlockReason('+33299001122'), 'numéro fixe');   // +332
  assert.equal(smsBlockReason('+33381001122'), 'numéro fixe');   // +333
  assert.equal(smsBlockReason('+33491001122'), 'numéro fixe');   // +334
  assert.equal(smsBlockReason('+33561001122'), 'numéro fixe');   // +335
  assert.equal(smsBlockReason('+33972001122'), 'ligne box (09)'); // +339
  assert.equal(smsBlockReason('+33800001122'), 'numéro spécial (08)');
});

test('formats d’écriture courants', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('0033 6 12 34 56 78'), '+33612345678');
  assert.equal(normalizePhone('+33 (0)6.12.34.56.78'), '+33612345678');
  assert.equal(smsBlockReason('01 44 05 12 34'), 'numéro fixe');
  assert.equal(smsBlockReason('07-68-03-87-33'), null);
});

test('numéro absent ou tronqué', () => {
  assert.equal(smsBlockReason(''), 'pas de numéro');
  assert.equal(smsBlockReason(null), 'pas de numéro');
  assert.equal(smsBlockReason('+336123'), 'numéro français invalide');
});

test('les numéros étrangers ne sont pas filtrés', () => {
  assert.equal(smsBlockReason('+32470123456'), null); // Belgique
  assert.equal(smsBlockReason('+41791234567'), null); // Suisse
});
