process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

require('dotenv').config({ override: false });
const express = require('express');
const { Resend } = require('resend');

console.log('[init] RESEND_API_KEY présente:', !!process.env.RESEND_API_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);

const LOGO_URL = 'https://raw.githubusercontent.com/juliensargin-svg/dromy-webhook/main/logo-dromy.jpg';
console.log('[init] Logo URL:', LOGO_URL);


const app = express();
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.use(express.json());

const NOTES_PATTERN = /Bene\s+Bono\s+\d+/i;
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

app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/webhook/onfleet', (req, res) => {
  res.send(req.query.check || '');
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
    const trackingUrl = task.trackingURL;
    const etaMs = task.estimatedArrivalTime || task.estimatedCompletionTime;
    const etaMinutes = etaMs ? Math.round((etaMs - Date.now()) / 60000) : null;
    const subject = `Votre livraison Bene Bono du ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })} est en route`;
    const html = buildTrackingEmailHtml({ ref: notes, trackingUrl });

    try {
      const { data: sent, error } = await resend.emails.send({ from, to: [recipientEmail], cc, subject, html });
      if (error) throw new Error(JSON.stringify(error));
      console.log(`[webhook] Email tracking envoyé pour ${notes} — id: ${sent.id}`);
      return res.status(200).json({ sent: true, id: sent.id });
    } catch (err) {
      console.error('[webhook] Erreur email tracking:', err.message);
      await resend.emails.send({
        from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
        subject: `⚠️ Erreur tracking Dromy — ${notes}`,
        html: `<p>Erreur lors de l'envoi de l'email de tracking pour <strong>${notes}</strong>.</p><p><strong>Destinataire :</strong> ${recipientEmail}</p><p><strong>Erreur :</strong> ${err.message}</p>`,
      }).catch(e => console.error('[webhook] Erreur alerte:', e.message));
      return res.status(500).json({ error: 'Email send failed', detail: err.message });
    }
  }

  // taskCompleted (trigger 3) — email de confirmation
  // Priorité aux completionDetails du payload webhook (plus frais que l'API re-fetch)
  const addr = task.destination?.address;
  const address = addr
    ? [addr.number, addr.street, addr.city, addr.country].filter(Boolean).join(', ')
    : 'Adresse inconnue';

  const webhookCd = webhookTask?.completionDetails;
  console.log('[webhook] completionDetails payload:', JSON.stringify(webhookCd));
  console.log('[webhook] completionDetails API:', JSON.stringify(task.completionDetails));
  const cd = (webhookCd?.time || webhookCd?.photoUploadIds?.length || webhookCd?.photoUploadId || webhookCd?.signatureUploadId)
    ? webhookCd
    : (task.completionDetails || {});
  const completedAt = cd.time ? formatDate(cd.time) : 'N/A';
  const photoUploadId = cd.photoUploadIds?.[0] || cd.photoUploadId;
  const photoUrl = photoUploadId ? `${ONFLEET_CDN}/${photoUploadId}/800x.png` : null;
  const signatureUrl = cd.signatureUploadId ? `${ONFLEET_CDN}/${cd.signatureUploadId}/282x.png` : null;

  const subject = `Livraison du ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })} Bene Bono effectuée`;
  const html = buildEmailHtml({ ref: notes, address, completedAt, photoUrl, signatureUrl, signatureText: cd.signatureText || null });

  try {
    const { data: sent, error } = await resend.emails.send({ from, to: [recipientEmail], cc, subject, html });
    if (error) throw new Error(JSON.stringify(error));
    console.log(`[webhook] Email confirmation envoyé pour ${notes} — id: ${sent.id}`);
    return res.status(200).json({ sent: true, id: sent.id });
  } catch (err) {
    console.error('[webhook] Erreur envoi email:', err.message);
    await resend.emails.send({
      from, to: ['julien.sargin@gmail.com'], cc: ['oweis@dromy.fr'],
      subject: `⚠️ Erreur webhook Dromy — ${notes}`,
      html: `
        <p>Bonjour,</p>
        <p>L'email de confirmation de livraison n'a <strong>pas pu être envoyé</strong> au client suite à une erreur technique.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold;width:40%">Référence</td><td style="padding:8px;border:1px solid #eee">${notes}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Destinataire visé</td><td style="padding:8px;border:1px solid #eee">${recipientEmail}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Cause de l'erreur</td><td style="padding:8px;border:1px solid #eee;color:#c0392b">${err.message}</td></tr>
        </table>
        <p><strong>Action requise :</strong> contacter manuellement le client ou vérifier la configuration du webhook.</p>
        <p style="color:#888;font-size:12px">Ce message est généré automatiquement par le webhook Dromy.</p>
      `,
    }).catch(e => console.error('[webhook] Erreur alerte:', e.message));
    return res.status(500).json({ error: 'Email send failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('PORT env:', process.env.PORT);
  console.log('Listening on:', PORT);
});
