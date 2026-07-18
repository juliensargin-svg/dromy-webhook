process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

require('dotenv').config({ override: false });
const express = require('express');
const { Resend } = require('resend');
const twilio = require('twilio');
const cron = require('node-cron');

console.log('[init] RESEND_API_KEY présente:', !!process.env.RESEND_API_KEY);
console.log('[init] TWILIO_ACCOUNT_SID présente:', !!process.env.TWILIO_ACCOUNT_SID);

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const resend = new Resend(process.env.RESEND_API_KEY);

// Log en mémoire des emails envoyés (max 500 entrées)
const emailLog = [];

const LOGO_URL = 'https://raw.githubusercontent.com/juliensargin-svg/dromy-webhook/main/logo-dromy.jpg';
console.log('[init] Logo URL:', LOGO_URL);


const app = express();
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.use(express.json());

const NOTES_PATTERN = /Bene\s+Bono\s+\d+/i;
const QUITOQUE_PATTERN = /^03/;
const ONFLEET_CDN = 'https://d15p8tr8p0vffz.cloudfront.net';


async function fetchOnfleetTask(taskId) {
  const auth = Buffer.from(`${process.env.ONFLEET_API_KEY}:`).toString('base64');
  const res = await fetch(
    `https://onfleet.com/api/v2/tasks/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`Onfleet API ${res.status}: ${await res.text()}`);
  return res.json();
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildTrackingEmailHtml({ ref, trackingUrl }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header { background: #4CAF50; padding: 28px 32px; text-align: center; }
    .header img { max-width: 180px; height: auto; display: block; margin: 0 auto 12px; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px; font-weight: 600; }
    .body { padding: 32px; color: #333; }
    .badge { display: inline-block; background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; margin-bottom: 24px; }
    .btn { display: block; width: fit-content; margin: 32px auto 0; background: #4CAF50; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold; text-align: center; }
    .footer { background: #f9f9f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Dromy" />
      <h1>Votre livraison est en route</h1>
    </div>
    <div class="body">
      <span class="badge">🚚 En cours de livraison</span>
      <p style="margin: 0 0 8px; font-size: 15px; color: #444;">Bonjour,</p>
      <p style="margin: 0 0 24px; font-size: 15px; color: #444;">Votre livraison Bene Bono est en route. Suivez votre livraison sur le lien ci-dessous.</p>
      <p style="margin: 0; font-size: 13px; color: #888; text-align: center;">Référence : ${ref}</p>
      <a href="${trackingUrl}" class="btn">Suivre ma livraison</a>
    </div>
    <div class="footer">Dromy — Ce message est généré automatiquement</div>
  </div>
</body>
</html>`;
}

function buildEmailHtml({ ref, address, completedAt, photoUrl, signatureUrl, signatureText }) {
  const photoSection = photoUrl ? `
      <div class="field">
        <label>Preuve de livraison</label>
        <img src="${photoUrl}" alt="Photo de livraison" style="max-width:100%;border-radius:6px;margin-top:6px;" />
      </div>` : '';

  const signatureSection = signatureUrl ? `
      <div class="field">
        <label>Signature${signatureText ? ` — ${signatureText}` : ''}</label>
        <img src="${signatureUrl}" alt="Signature" style="max-width:282px;border-radius:6px;margin-top:6px;background:#fff;padding:8px;" />
      </div>` : '';

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header { background: #4CAF50; padding: 28px 32px; text-align: center; }
    .header img { max-width: 180px; height: auto; display: block; margin: 0 auto 12px; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px; font-weight: 600; }
    .body { padding: 32px; color: #333; }
    .badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; margin-bottom: 24px; }
    .field { margin-bottom: 20px; }
    .field label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #888; margin-bottom: 4px; }
    .field p { margin: 0; font-size: 15px; font-weight: 600; color: #1a1a2e; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    .footer { background: #f9f9f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Dromy" />
      <h1>Confirmation de livraison</h1>
    </div>
    <div class="body">
      <span class="badge">✓ Livraison effectuée</span>
      <p style="margin: 0 0 24px; font-size: 15px; color: #444;">Bonjour, votre livraison Bene Bono a bien été effectuée.</p>
      <div class="field">
        <label>Référence commande</label>
        <p>${ref}</p>
      </div>
      <div class="field">
        <label>Adresse de livraison</label>
        <p>${address}</p>
      </div>
      <div class="field">
        <label>Heure de livraison</label>
        <p>${completedAt}</p>
      </div>
      ${photoSection || signatureSection ? '<hr class="divider" />' : ''}
      ${photoSection}
      ${signatureSection}
    </div>
    <div class="footer">Dromy — Ce message est généré automatiquement</div>
  </div>
</body>
</html>`;
}

async function sendSms(to, body) {
  if (!twilioClient) {
    console.warn('[sms] Twilio non configuré, SMS ignoré');
    return;
  }
  if (!to) {
    console.warn('[sms] Pas de numéro de téléphone, SMS ignoré');
    return;
  }
  const message = await twilioClient.messages.create({
    from: process.env.TWILIO_FROM,
    to,
    body,
  });
  console.log(`[sms] Envoyé à ${to} — sid: ${message.sid}`);
  return message;
}

app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/webhook/onfleet', (req, res) => {
  res.send(req.query.check || '');
});

app.get('/email-status', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: 'Paramètre email manquant. Ex: /email-status?email=client@gmail.com' });
  }

  const matches = emailLog.filter(e => e.to.toLowerCase() === email.toLowerCase());
  if (matches.length === 0) {
    return res.status(200).json({ email, found: false, message: 'Aucun email trouvé (log depuis le dernier démarrage du serveur)' });
  }
  return res.status(200).json({
    email,
    found: true,
    emails: matches.map(e => ({
      ref: e.ref,
      subject: e.subject,
      status: e.status,
      sentAt: new Date(e.sentAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    })),
  });
});

app.get('/sms-status', async (req, res) => {
  const { ref, phone: phoneParam, token } = req.query;

  if (process.env.CHECK_TOKEN && token !== process.env.CHECK_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  if (!ref && !phoneParam) {
    return res.status(400).json({ error: 'Paramètre ref ou phone manquant. Ex: /sms-status?ref=Bene+Bono+2244090 ou /sms-status?phone=0612345678' });
  }

  try {
    let phone = phoneParam;

    // Si numéro fourni directement, on normalise en E.164
    if (phone) {
      phone = phone.replace(/\s/g, '');
      if (phone.startsWith('0')) phone = '+33' + phone.slice(1);
      if (!phone.startsWith('+')) phone = '+33' + phone;
    } else {
      // Sinon on cherche la tâche Onfleet par référence
      const from = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const auth = Buffer.from(`${process.env.ONFLEET_API_KEY}:`).toString('base64');
      const tasksRes = await fetch(
        `https://onfleet.com/api/v2/tasks/all?from=${from}`,
        { headers: { Authorization: `Basic ${auth}` } }
      );
      if (!tasksRes.ok) throw new Error(`Onfleet API ${tasksRes.status}`);
      const tasksData = await tasksRes.json();
      const tasks = Array.isArray(tasksData) ? tasksData : (tasksData.tasks || []);
      const task = tasks.find(t => t.notes && t.notes.toLowerCase().includes(ref.toLowerCase()));
      if (!task) {
        return res.status(404).json({ found: false, message: `Aucune tâche trouvée pour la référence "${ref}" dans les 30 derniers jours` });
      }
      phone = task.recipients?.[0]?.phone;
      if (!phone) {
        return res.status(200).json({ found: true, sms: false, message: 'Tâche trouvée mais aucun numéro de téléphone associé' });
      }
    }

    // Cherche les SMS Twilio envoyés à ce numéro
    const twilioAuth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const messagesRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json?To=${encodeURIComponent(phone)}&From=${encodeURIComponent(process.env.TWILIO_FROM)}&PageSize=5`,
      { headers: { Authorization: `Basic ${twilioAuth}` } }
    );
    if (!messagesRes.ok) throw new Error(`Twilio API ${messagesRes.status}`);
    const messagesData = await messagesRes.json();
    const messages = messagesData.messages || [];

    if (messages.length === 0) {
      return res.status(200).json({ phone, sms: false, message: 'Aucun SMS trouvé pour ce numéro' });
    }

    const latest = messages[0];
    return res.status(200).json({
      phone,
      sms: true,
      status: latest.status,
      sentAt: new Date(latest.date_sent).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      body: latest.body,
    });

  } catch (err) {
    console.error('[sms-status] Erreur:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/onfleet', async (req, res) => {
  const { taskId, triggerId, data } = req.body;

  // Onfleet webhook shape: { taskId, triggerId, data: { task: {...} } }
  // triggerId: 0 = taskStarted, 3 = taskCompleted
  const webhookTask = data?.task;
  if (!webhookTask && !taskId) {
    return res.status(400).json({ error: 'Missing task in payload' });
  }

  const id = webhookTask?.id || taskId;
  const notes = webhookTask?.notes || '';

  if (!NOTES_PATTERN.test(notes)) {
    console.log(`[webhook] Task ${id} — notes "${notes}" don't match pattern, skipping`);
    return res.status(200).json({ skipped: true, reason: 'notes pattern mismatch' });
  }

  let task;
  try {
    task = await fetchOnfleetTask(id);
    console.log(`[onfleet] Tâche récupérée : ${task.id}, triggerId: ${triggerId}`);

  } catch (err) {
    console.error('[onfleet] Erreur API:', err.message);
    return res.status(502).json({ error: 'Onfleet API error', detail: err.message });
  }

  const recipientEmail = task.recipients?.[0]?.notes?.trim() || process.env.EMAIL_TO;
  console.log(`[webhook] Destinataire : ${recipientEmail}`);

  const from = process.env.EMAIL_FROM || 'Dromy Livraisons <onboarding@resend.dev>';
  const cc = process.env.SMTP_CC ? [process.env.SMTP_CC] : undefined;

  // taskStarted (trigger 0) — email de tracking
  console.log(`[webhook] triggerId reçu:`, triggerId);
  if (triggerId === 0) {
    const trackingUrl = `https://www.dashboard-dromy.fr/track/${task.id}`;
    const etaMs = task.estimatedArrivalTime || task.estimatedCompletionTime;
    const etaMinutes = etaMs ? Math.round((etaMs - Date.now()) / 60000) : null;
    const subject = `Votre livraison Bene Bono du ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })} est en route`;
    const html = buildTrackingEmailHtml({ ref: notes, trackingUrl });

    const recipientPhone = task.recipients?.[0]?.phone || null;

    try {
      const { data: sent, error } = await resend.emails.send({ from, to: [recipientEmail], cc, subject, html });
      if (error) throw new Error(JSON.stringify(error));
      console.log(`[webhook] Email tracking envoyé pour ${notes} — id: ${sent.id}`);
      emailLog.unshift({ to: recipientEmail, subject, sentAt: new Date().toISOString(), status: 'delivered', ref: notes });
      if (emailLog.length > 500) emailLog.pop();
    } catch (err) {
      console.error('[webhook] Erreur email tracking:', err.message);
      await resend.emails.send({
        from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
        subject: `⚠️ Erreur tracking Dromy — ${notes}`,
        html: `<p>Erreur lors de l'envoi de l'email de tracking pour <strong>${notes}</strong>.</p><p><strong>Destinataire :</strong> ${recipientEmail}</p><p><strong>Erreur :</strong> ${err.message}</p>`,
      }).catch(e => console.error('[webhook] Erreur alerte:', e.message));
    }

    return res.status(200).json({ sent: true });
  }

  // taskCompleted (trigger 3) — SMS uniquement
  const addr = task.destination?.address;
  const addressLine1 = addr
    ? [addr.number, addr.street, addr.postalCode, addr.city].filter(Boolean).join(', ')
    : 'Adresse inconnue';
  const addressLine2 = addr?.apartment || null;

  const recipientPhone = task.recipients?.[0]?.phone || null;

  try {
    const smsBody = [
      `Cher Client, Votre commande Bene Bono a été livrée au point relais suivant :`,
      addressLine1,
      addressLine2,
    ].filter(Boolean).join('\n');
    await sendSms(recipientPhone, smsBody);
  } catch (err) {
    console.error('[webhook] Erreur SMS confirmation:', err.message);
    await resend.emails.send({
      from,
      to: ['julien.sargin@gmail.com'],
      cc: ['oweis@dromy.fr'],
      subject: `⚠️ Erreur SMS Dromy — ${notes}`,
      html: `
        <p>Bonjour,</p>
        <p>Le SMS de confirmation de livraison n'a <strong>pas pu être envoyé</strong> au client.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;width:40%">Référence</td><td style="padding:8px;border:1px solid #eee">${notes}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Numéro visé</td><td style="padding:8px;border:1px solid #eee">${recipientPhone || 'inconnu'}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Cause de l'erreur</td><td style="padding:8px;border:1px solid #eee;color:#c0392b">${err.message}</td></tr>
        </table>
        <p style="color:#888;font-size:12px">Ce message est généré automatiquement par le webhook Dromy.</p>
      `,
    }).catch(e => console.error('[webhook] Erreur alerte SMS:', e.message));
  }

  return res.status(200).json({ sent: true });
});

function buildQuitoqueEmailHtml({ deliveryDate, missionHour, missionHourMax }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header { background: #4CAF50; padding: 28px 32px; text-align: center; }
    .header img { max-width: 180px; height: auto; display: block; margin: 0 auto 12px; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; letter-spacing: 1px; font-weight: 600; }
    .body { padding: 32px; color: #333; font-size: 15px; line-height: 1.6; }
    .footer { background: #f9f9f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #aaa; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Dromy" />
      <h1>Livraison de votre box Quitoque</h1>
    </div>
    <div class="body">
      <p>Cher client,</p>
      <p>Dromy se chargera de la livraison de votre box Quitoque qui arrivera le <strong>${deliveryDate}</strong> entre <strong>${missionHour}</strong> et <strong>${missionHourMax}</strong>. Vous recevrez un SMS le jour J, dès la prise en charge de votre commande par un de nos livreurs.</p>
      <p>Pour toute question ou imprévu, vous pouvez nous contacter : <a href="mailto:dispatch@dromy.fr">dispatch@dromy.fr</a>.</p>
      <p>L'équipe Dromy</p>
    </div>
    <div class="footer">Dromy — Ce message est généré automatiquement</div>
  </div>
</body>
</html>`;
}

async function fetchQuitoqueTasksForDay(offsetDays) {
  const now = new Date();
  const day = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  day.setDate(day.getDate() + offsetDays);
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  const auth = Buffer.from(`${process.env.ONFLEET_API_KEY}:`).toString('base64');
  const res = await fetch(
    `https://onfleet.com/api/v2/tasks/all?from=${day.getTime()}&to=${dayEnd.getTime()}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) throw new Error(`Onfleet API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const tasks = Array.isArray(data) ? data : (data.tasks || []);
  return tasks.filter(t => t.notes && QUITOQUE_PATTERN.test(t.notes.trim()));
}

const fetchTomorrowQuitoqueTasks = () => fetchQuitoqueTasksForDay(1);
const fetchTodayQuitoqueTasks = () => fetchQuitoqueTasksForDay(0);

async function sendQuitoqueEmails() {
  console.log('[quitoque] Démarrage envoi emails veille...');
  const from = process.env.EMAIL_FROM || 'Dromy Livraisons <onboarding@resend.dev>';

  let tasks;
  try {
    tasks = await fetchTomorrowQuitoqueTasks();
    console.log(`[quitoque] ${tasks.length} tâche(s) Quitoque pour demain`);
  } catch (err) {
    console.error('[quitoque] Erreur récupération tâches Onfleet:', err.message);
    await resend.emails.send({
      from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
      subject: '⚠️ Erreur cron Quitoque — récupération tâches Onfleet',
      html: `<p>Erreur lors de la récupération des tâches Quitoque pour demain.</p><p><strong>Erreur :</strong> ${err.message}</p>`,
    }).catch(e => console.error('[quitoque] Erreur alerte:', e.message));
    return;
  }

  for (const task of tasks) {
    const recipientEmail = task.recipients?.[0]?.notes?.trim();
    if (!recipientEmail) {
      console.warn(`[quitoque] Pas d'email pour la tâche ${task.id} (${task.notes})`);
      continue;
    }

    const deliveryDate = new Date(task.completeAfter || task.completeBefore).toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    const missionHour = task.completeAfter
      ? new Date(task.completeAfter).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
      : '?';
    const missionHourMax = task.completeBefore
      ? new Date(task.completeBefore).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
      : '?';

    try {
      const { data: sent, error } = await resend.emails.send({
        from,
        to: [recipientEmail],
        cc: ['dispatch@dromy.fr'],
        subject: 'Livraison de votre box Quitoque',
        html: buildQuitoqueEmailHtml({ deliveryDate, missionHour, missionHourMax }),
      });
      if (error) throw new Error(JSON.stringify(error));
      console.log(`[quitoque] Email envoyé à ${recipientEmail} pour ${task.notes} — id: ${sent.id}`);
    } catch (err) {
      console.error(`[quitoque] Erreur envoi email pour ${task.notes}:`, err.message);
      await resend.emails.send({
        from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
        subject: `⚠️ Erreur email Quitoque — ${task.notes}`,
        html: `<p>Erreur lors de l'envoi de l'email Quitoque veille.</p><p><strong>Référence :</strong> ${task.notes}</p><p><strong>Destinataire :</strong> ${recipientEmail}</p><p><strong>Erreur :</strong> ${err.message}</p>`,
      }).catch(e => console.error('[quitoque] Erreur alerte:', e.message));
    }
  }
  console.log('[quitoque] Fin envoi emails veille');
}

async function shortenUrl(url) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`TinyURL ${res.status}`);
    return (await res.text()).trim();
  } catch (err) {
    console.warn('[shortenUrl] Erreur:', err.message, '— URL originale utilisée');
    return url;
  }
}

async function sendQuitoqueSms() {
  console.log('[quitoque] Démarrage envoi SMS jour J...');
  const from = process.env.EMAIL_FROM || 'Dromy Livraisons <onboarding@resend.dev>';

  let tasks;
  try {
    tasks = await fetchTodayQuitoqueTasks();
    console.log(`[quitoque] ${tasks.length} tâche(s) Quitoque aujourd'hui`);
  } catch (err) {
    console.error('[quitoque] Erreur récupération tâches Onfleet (SMS):', err.message);
    await resend.emails.send({
      from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
      subject: '⚠️ Erreur cron Quitoque SMS — récupération tâches Onfleet',
      html: `<p>Erreur lors de la récupération des tâches Quitoque pour aujourd'hui.</p><p><strong>Erreur :</strong> ${err.message}</p>`,
    }).catch(e => console.error('[quitoque] Erreur alerte:', e.message));
    return;
  }

  for (const task of tasks) {
    const phone = task.recipients?.[0]?.phone;
    const trackingUrl = task.trackingURL;
    if (!phone) {
      console.warn(`[quitoque] Pas de téléphone pour ${task.notes}`);
      continue;
    }
    if (!trackingUrl) {
      console.warn(`[quitoque] Pas de lien tracking pour ${task.notes}`);
      continue;
    }

    const shortUrl = await shortenUrl(trackingUrl);
    const smsBody = `Votre box Quitoque sera livrée aujourd'hui. Suivi : ${shortUrl}\nUn souci? dispatch@dromy.fr`;
    try {
      await sendSms(phone, smsBody);
    } catch (err) {
      console.error(`[quitoque] Erreur SMS pour ${task.notes}:`, err.message);
      await resend.emails.send({
        from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
        subject: `⚠️ Erreur SMS Quitoque — ${task.notes}`,
        html: `<p>Erreur lors de l'envoi du SMS Quitoque.</p><p><strong>Référence :</strong> ${task.notes}</p><p><strong>Numéro :</strong> ${phone}</p><p><strong>Erreur :</strong> ${err.message}</p>`,
      }).catch(e => console.error('[quitoque] Erreur alerte:', e.message));
    }
  }
  console.log('[quitoque] Fin envoi SMS jour J');
}

app.get('/send-quitoque-emails', async (req, res) => {
  sendQuitoqueEmails().catch(e => console.error('[quitoque] Erreur:', e.message));
  res.status(200).json({ triggered: true, message: 'Envoi emails Quitoque lancé, vérifiez les logs' });
});

app.get('/send-quitoque-sms', async (req, res) => {
  sendQuitoqueSms().catch(e => console.error('[quitoque] Erreur SMS:', e.message));
  res.status(200).json({ triggered: true, message: 'Envoi SMS Quitoque lancé, vérifiez les logs' });
});

// Cron emails : tous les jours à 21h Europe/Paris (veille de livraison)
cron.schedule('0 21 * * *', sendQuitoqueEmails, { timezone: 'Europe/Paris' });
// Cron SMS : tous les jours à 8h Europe/Paris (jour de livraison)
cron.schedule('0 8 * * *', sendQuitoqueSms, { timezone: 'Europe/Paris' });
console.log('[init] Cron Quitoque planifié à 21h Europe/Paris');

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('PORT env:', process.env.PORT);
  console.log('Listening on:', PORT);
});
