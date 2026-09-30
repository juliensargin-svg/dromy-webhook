const test = require('node:test');
const assert = require('node:assert/strict');
const { formatHour, buildLcmSms, selectDueLcmTasks, sentTaskIds } = require('./lcm-sms');

// 30/09/2026 en heure de Paris (UTC+2)
const paris = (hhmm) => Date.parse(`2026-09-30T${hhmm}:00+02:00`);
const task = (over = {}) => ({
  id: 'kH14ZyjOASmzRrHQe4oPbUc2', notes: 'LCM', state: 1, pickupTask: false,
  completeAfter: paris('12:00'), completeBefore: paris('14:00'),
  recipients: [{ phone: '+33600000000' }], ...over,
});

test('heures au format français, en heure de Paris', () => {
  assert.equal(formatHour(paris('12:00')), '12h');
  assert.equal(formatHour(paris('09:00')), '9h');
  assert.equal(formatHour(paris('17:30')), '17h30');
});

test('texte du SMS', () => {
  assert.equal(
    buildLcmSms(task()),
    "Les Cuistots Migrateurs : livraison aujourd'hui entre 12h et 14h. Suivi : https://dromy.vercel.app/t/kH14ZyjOASmzRrHQe4oPbUc2\nUn souci ? dispatch@dromy.fr"
  );
});

test('le SMS part dans l’heure qui précède le créneau, pas avant, pas après', () => {
  const t = [task()];
  assert.equal(selectDueLcmTasks(t, paris('10:59')).length, 0, 'trop tôt');
  assert.equal(selectDueLcmTasks(t, paris('11:00')).length, 1, 'pile 1h avant');
  assert.equal(selectDueLcmTasks(t, paris('11:50')).length, 1, 'rattrapage dans l’heure');
  assert.equal(selectDueLcmTasks(t, paris('12:00')).length, 0, 'créneau commencé');
});

test('exclut les autres clients, les récupérations, les tâches terminées, sans téléphone', () => {
  const now = paris('11:10');
  assert.equal(selectDueLcmTasks([task({ notes: '03-12345' })], now).length, 0, 'autre client');
  assert.equal(selectDueLcmTasks([task({ pickupTask: true })], now).length, 0, 'récupération');
  assert.equal(selectDueLcmTasks([task({ state: 3 })], now).length, 0, 'déjà livrée');
  assert.equal(selectDueLcmTasks([task({ recipients: [{}] })], now).length, 0, 'sans téléphone');
  assert.equal(selectDueLcmTasks([task({ notes: 'LCM_LIVRAISON PTD' })], now).length, 1, 'variante de notes');
  assert.equal(selectDueLcmTasks([task({ notes: '  LCM\n\n4 cartons' })], now).length, 1, 'espaces et détails');
});

test('dédup par livraison : un créneau replanifié reçoit son propre SMS', () => {
  const envoye = buildLcmSms(task());
  const deja = sentTaskIds([envoye, 'Votre box Quitoque sera livrée aujourd\'hui. Suivi : https://dromy.vercel.app/t/autreQuitoque01']);
  assert.ok(deja.has('kH14ZyjOASmzRrHQe4oPbUc2'));
  // Clone replanifié : même numéro, autre identifiant de tâche -> pas encore envoyé
  assert.ok(!deja.has('QIELzhG9cloneAbcdefghijk'));
});

test('identifiants Onfleet contenant * et ~', () => {
  const t = task({ id: 'WKvOUAl*saYB8o7PSXRMfZuL' });
  assert.ok(sentTaskIds([buildLcmSms(t)]).has('WKvOUAl*saYB8o7PSXRMfZuL'));
  const t2 = task({ id: 'eALoJxAe~abc*def~ghijklm' });
  assert.ok(sentTaskIds([buildLcmSms(t2)]).has('eALoJxAe~abc*def~ghijklm'));
});

// Alphabet GSM-7 de base : un seul caractère hors de cet alphabet fait passer
// le SMS en UCS-2, limité à 70 caractères par SMS.
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

test('tient en UN seul SMS, même dans le pire cas', () => {
  // Créneau le plus long à écrire, identifiant Onfleet de longueur maximale.
  const pire = buildLcmSms(task({
    id: 'x'.repeat(24), completeAfter: paris('17:30'), completeBefore: paris('19:30'),
  }));
  const horsGsm = [...pire].filter((c) => !GSM7.includes(c));
  assert.deepEqual(horsGsm, [], 'caractère hors GSM-7 : le SMS passerait à 70 caractères max');
  assert.ok(pire.length <= 160, `${pire.length} caractères : facturé 2 SMS`);
});
