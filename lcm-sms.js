// SMS de suivi pour le client LCM (les Cuistots Migrateurs).
//
// Logique pure, sans réseau : sélection des tâches dues, texte du SMS,
// déduplication. Séparée de webhook-server.js pour pouvoir être testée
// (ce dernier démarre le serveur dès son chargement).

// Notes Onfleet : « LCM », « LCM_LIVRAISON PTD », « LCM\n\n4 cartons »…
const LCM_PATTERN = /^LCM/;

// Le SMS part 1h avant le début du créneau.
const LCM_SMS_LEAD_MS = 60 * 60 * 1000;

// Domaine réputé : les opérateurs FR bloquent les SMS contenant nos domaines
// (Twilio 30007). dromy.vercel.app redirige vers la page de suivi.
function trackingUrl(task) {
  return `https://dromy.vercel.app/t/${task.id}`;
}

// 12:00 -> « 12h », 17:30 -> « 17h30 », en heure de Paris.
function formatHour(timestamp) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = parts.find((p) => p.type === 'minute').value;
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

function buildLcmSms(task) {
  const debut = formatHour(task.completeAfter);
  const fin = formatHour(task.completeBefore);
  // Formulation choisie pour tenir en UN seul SMS (160 caractères GSM-7) dans
  // le pire cas (créneau 17h30-19h30) : 158. La version « Votre commande les
  // Cuistots Migrateurs sera livrée… » faisait 169-174 → facturée 2 SMS.
  return `Les Cuistots Migrateurs : livraison aujourd'hui entre ${debut} et ${fin}. Suivi : ${trackingUrl(task)}\nUn souci ? dispatch@dromy.fr`;
}

// Tâches dont le SMS doit partir maintenant : on est dans l'heure qui précède
// le début du créneau, et le créneau n'a pas commencé.
function selectDueLcmTasks(tasks, now = Date.now()) {
  return tasks.filter((t) => {
    if (!t.notes || !LCM_PATTERN.test(t.notes.trim())) return false;
    // Une récupération n'est pas une livraison : pas de « votre commande
    // sera livrée » pour venir reprendre des thermostats.
    if (t.pickupTask) return false;
    if (t.state > 2) return false; // déjà livrée ou en échec
    if (!t.completeAfter || !t.completeBefore) return false;
    if (!t.recipients?.[0]?.phone) return false;
    return t.completeAfter - LCM_SMS_LEAD_MS <= now && now < t.completeAfter;
  });
}

// Identifiants des tâches ayant déjà reçu un SMS, retrouvés dans le lien de
// suivi de chaque message envoyé.
//
// Dédup PAR LIVRAISON et non par numéro (contrairement à Quitoque) : chez LCM,
// un même client peut avoir deux tâches le même jour — créneau replanifié
// (clone Onfleet), commande en deux passages. Dédupliquer par numéro
// supprimerait le SMS annonçant le nouveau créneau.
function sentTaskIds(messageBodies) {
  const ids = new Set();
  for (const body of messageBodies) {
    for (const m of (body || '').matchAll(/dromy\.vercel\.app\/t\/([A-Za-z0-9*~_-]+)/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

module.exports = {
  LCM_PATTERN, LCM_SMS_LEAD_MS, trackingUrl, formatHour, buildLcmSms, selectDueLcmTasks, sentTaskIds,
};
