// Numéros français qui ne peuvent pas recevoir de SMS.
//
// En France, seuls les 06 et 07 sont des portables. Les 01 à 05 (fixes
// géographiques), 08 (numéros spéciaux) et 09 (lignes box / VoIP) sont refusés
// par Twilio (erreur 21635 « cannot be a landline ») : chaque tentative
// générait une erreur et un email d'alerte, pour rien.
//
// Les numéros étrangers ne sont pas filtrés : on ne connaît pas leurs plans de
// numérotation, Twilio tranchera.

// Ramène les écritures courantes au format international : « 01 45 … »,
// « 0033 1 45 … », « +33 (0)1 45 … ».
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s.\-()]/g, '');
  if (p.startsWith('0033')) p = '+33' + p.slice(4);
  if (p.startsWith('+330')) p = '+33' + p.slice(4); // « +33 (0)1 … »
  if (/^0\d{9}$/.test(p)) p = '+33' + p.slice(1);
  return p;
}

// `null` si le numéro peut recevoir un SMS, sinon la raison du refus.
function smsBlockReason(raw) {
  const p = normalizePhone(raw);
  if (!p) return 'pas de numéro';
  if (!p.startsWith('+33')) return null;
  if (/^\+33[67]\d{8}$/.test(p)) return null;
  if (/^\+33[1-5]/.test(p)) return 'numéro fixe';
  if (/^\+339/.test(p)) return 'ligne box (09)';
  if (/^\+338/.test(p)) return 'numéro spécial (08)';
  return 'numéro français invalide';
}

module.exports = { normalizePhone, smsBlockReason };
