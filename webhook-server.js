require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const logoPath = path.join(__dirname, 'logo-dromy.jpg');
console.log(`[init] Logo path: ${logoPath}, exists: ${fs.existsSync(logoPath)}`);

const app = express();
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
app.use(express.json());

const NOTES_PATTERN = /^\d{2}-\d+$/;
const ONFLEET_CDN = 'https://d15p8tr8p0vffz.cloudfront.net';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
      <img src="cid:logo-dromy" alt="Dromy" />
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
  const { taskId, data } = req.body;

  // Onfleet webhook shape: { taskId, status, data: { task: {...} } }
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

  // Fetch full task from Onfleet API for complete completionDetails
  let task;
  try {
    task = await fetchOnfleetTask(id);
    console.log(`[onfleet] Tâche récupérée : ${task.id}`);
  } catch (err) {
    console.error('[onfleet] Erreur API:', err.message);
    return res.status(502).json({ error: 'Onfleet API error', detail: err.message });
  }

  const addr = task.destination?.address;
  const addressParts = addr
    ? [addr.number, addr.street, addr.city, addr.country].filter(Boolean)
    : [];
  const address = addressParts.join(', ') || 'Adresse inconnue';

  const cd = task.completionDetails || {};
  const completedAt = cd.time ? formatDate(cd.time) : 'N/A';

  const photoUploadId = cd.photoUploadIds?.[0] || cd.photoUploadId;
  const photoUrl = photoUploadId ? `${ONFLEET_CDN}/${photoUploadId}/800x.png` : null;

  const signatureUrl = cd.signatureUploadId
    ? `${ONFLEET_CDN}/${cd.signatureUploadId}/282x.png`
    : null;

  const mailOptions = {
    from: `"Dromy Livraisons" <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_TO,
    cc: process.env.SMTP_CC || undefined,
    subject: `Livraison du ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })} Bene Bono effectuée`,
    html: buildEmailHtml({
      ref: notes,
      address,
      completedAt,
      photoUrl,
      signatureUrl,
      signatureText: cd.signatureText || null,
    }),
    text: `Livraison confirmée\nRéférence : ${notes}\nAdresse : ${address}\nHeure : ${completedAt}`,
    attachments: [
      {
        filename: 'logo-dromy.jpg',
        path: logoPath,
        cid: 'logo-dromy',
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[webhook] Email envoyé pour ${notes} — messageId: ${info.messageId}`);
    return res.status(200).json({ sent: true, messageId: info.messageId });
  } catch (err) {
    console.error('[webhook] Erreur envoi email:', err.message);
    return res.status(500).json({ error: 'Email send failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('PORT env:', process.env.PORT);
  console.log('Listening on:', PORT);
});
