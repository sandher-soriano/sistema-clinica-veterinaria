// utils/correo.js
// Envío de correos. Se usa el primer proveedor configurado en .env:
//
//   1) SMTP (recomendado, gratis y envía a CUALQUIER correo):
//        CORREO_PROVEEDOR=gmail   -> smtp.gmail.com (500 correos/día)
//        CORREO_PROVEEDOR=brevo   -> smtp-relay.brevo.com (300 correos/día)
//        CORREO_PROVEEDOR=smtp    -> cualquier otro: SMTP_HOST / SMTP_PORT
//      + SMTP_USER, SMTP_PASS y (opcional) CORREO_REMITENTE
//   2) Mailgun (MAILGUN_API_KEY + MAILGUN_DOMAIN). Ojo: el plan gratis
//      "sandbox" solo envía a correos autorizados uno por uno.
//
// Si no hay nada configurado, NO envía nada y devuelve { enviado: false }:
// quien llama decide qué hacer (por ejemplo, mostrar la contraseña en pantalla).
const nodemailer = require('nodemailer');
const formData = require('form-data');
const Mailgun = require('mailgun.js');

const PRESETS_SMTP = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: false },
};

let transporteSmtp = null;
let clienteMailgun = null;

function obtenerSmtp() {
  if (transporteSmtp) return transporteSmtp;
  const proveedor = (process.env.CORREO_PROVEEDOR || '').toLowerCase();
  if (!proveedor || proveedor === 'mailgun' || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  const preset = PRESETS_SMTP[proveedor] || {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
  };
  if (!preset.host) return null;

  transporteSmtp = nodemailer.createTransport({
    ...preset,
    auth: {
      user: process.env.SMTP_USER,
      // Gmail muestra la "contraseña de aplicación" con espacios: se quitan
      pass: String(process.env.SMTP_PASS).replace(/\s+/g, ''),
    },
  });
  return transporteSmtp;
}

function obtenerMailgun() {
  if (clienteMailgun) return clienteMailgun;
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return null;
  const mailgun = new Mailgun(formData);
  // MAILGUN_REGION=eu si tu dominio está en la región de Europa
  const url = process.env.MAILGUN_REGION === 'eu' ? 'https://api.eu.mailgun.net' : undefined;
  clienteMailgun = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY, ...(url ? { url } : {}) });
  return clienteMailgun;
}

/** Nombre del proveedor activo (para mostrarlo en logs / pantalla de prueba). */
function proveedorActivo() {
  if (obtenerSmtp()) return `SMTP (${process.env.CORREO_PROVEEDOR})`;
  if (obtenerMailgun()) return 'Mailgun';
  return null;
}

/**
 * Envía un correo con el proveedor configurado.
 * @returns {Promise<{enviado: boolean, motivo?: string}>}
 */
async function enviarCorreo({ para, asunto, html }) {
  const smtp = obtenerSmtp();
  if (smtp) {
    try {
      await smtp.sendMail({
        from: process.env.CORREO_REMITENTE || `Premier Can <${process.env.SMTP_USER}>`,
        to: para,
        subject: asunto,
        html,
      });
      return { enviado: true };
    } catch (err) {
      console.error(`Error enviando correo por SMTP (${process.env.CORREO_PROVEEDOR}):`, err.message);
      return { enviado: false, motivo: err.message };
    }
  }

  const mg = obtenerMailgun();
  if (mg) {
    try {
      await mg.messages.create(process.env.MAILGUN_DOMAIN, {
        from: process.env.MAILGUN_FROM || `Premier Can <no-responder@${process.env.MAILGUN_DOMAIN}>`,
        to: [para],
        subject: asunto,
        html,
      });
      return { enviado: true };
    } catch (err) {
      console.error('Error enviando correo con Mailgun:', err.message);
      return { enviado: false, motivo: err.message };
    }
  }

  return { enviado: false, motivo: 'No hay proveedor de correo configurado (ver CORREO_PROVEEDOR en .env)' };
}

/**
 * Plantilla HTML común de los correos de Premier Can (encabezado turquesa,
 * cuerpo y pie). `contenido` es HTML ya armado por quien llama.
 */
function plantillaCorreo({ titulo, contenido }) {
  return `
  <div style="background:#f4f8f9;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#0d2226">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e1eaec">
      <div style="background:linear-gradient(135deg,#0d7a87,#00505a);padding:22px 24px;color:#ffffff">
        <div style="font-size:13px;opacity:.85">🐾 Premier Can · Clínica veterinaria</div>
        <div style="font-size:21px;font-weight:800;margin-top:4px">${titulo}</div>
      </div>
      <div style="padding:22px 24px;font-size:15px;line-height:1.55">${contenido}</div>
      <div style="padding:14px 24px;background:#f3f8f8;color:#6b7f82;font-size:12px">
        Este es un mensaje automático de Premier Can. Si tienes dudas, responde a este correo o llámanos.
      </div>
    </div>
  </div>`;
}

module.exports = { enviarCorreo, plantillaCorreo, proveedorActivo };
