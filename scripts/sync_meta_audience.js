// sync_meta_audience.js
// Reemplaza al flujo viejo de N8N/Railway (que dejó de andar en marzo 2026) para
// mantener actualizado el público "PUBLICO CALIDAD BAJA" de Meta con los leads de
// Kommo marcados como calidad baja. En Kommo esto NO es una etiqueta: es la "razón"
// que se elige en el desplegable del status "Otro" del embudo (config.LOW_QUALITY_LOSS_REASONS,
// por defecto "Comentarios basura" — se usa tanto si el lead no contesta como si
// pregunta algo que no tiene nada que ver), para que las campañas activas los
// excluyan y no les vuelva a mostrar el anuncio.
//
// No falla el build si algo sale mal acá (igual que Windsor/Google Ads): si Meta
// rechaza la subida, se loguea el error y se sigue con el resto del dashboard. Revisá
// el log de esta step en GitHub Actions para confirmar cuántos leads se subieron.
//
// Requiere variables de entorno:
//   META_SYSTEM_USER_TOKEN  -> mismo token que usa el resto del proyecto (ads_management)
//
// Lee: outputs/.data/kommo_leads.json (ya generado por fetch_kommo.js, con loss_reason/phone/email)
// Sube a: Meta Custom Audience (config.META_LOW_QUALITY_AUDIENCE_ID)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const GRAPH_VERSION = 'v21.0';
const DATA_DIR = path.join(__dirname, '..', '.data');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Normalización de teléfono según los lineamientos de Meta para Custom Audiences:
// solo dígitos, con código de país incluido, sin "+" ni espacios/guiones.
// Los números de Kommo pueden venir en varios formatos ("+54 9 11 1234-5678",
// "01151234567", "5491112345678", etc.) — esto es una normalización best-effort
// para Argentina; si el % de coincidencia en Meta queda bajo, hay que ajustar acá.
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('54')) return digits;
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.startsWith('15')) digits = digits.slice(2); // "15" local de celular AR
  return '54' + digits;
}

function normalizeEmail(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

async function uploadBatch(audienceId, schema, rows) {
  if (rows.length === 0) return { num_received: 0 };
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${audienceId}/users`;
  const payload = { schema, data: rows };
  const body = new URLSearchParams({
    payload: JSON.stringify(payload),
    access_token: TOKEN,
  });
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json();
  if (json.error) {
    throw new Error(`Meta error subiendo audiencia: ${JSON.stringify(json.error)}`);
  }
  return json;
}

async function main() {
  if (!TOKEN) {
    console.warn('Falta META_SYSTEM_USER_TOKEN, se omite la sincronización de audiencia de calidad baja.');
    return;
  }
  const leadsPath = path.join(DATA_DIR, 'kommo_leads.json');
  if (!fs.existsSync(leadsPath)) {
    console.warn('No existe .data/kommo_leads.json todavía, se omite la sincronización de audiencia.');
    return;
  }
  const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));

  const reasonSet = new Set(config.LOW_QUALITY_LOSS_REASONS.map((r) => r.toLowerCase().trim()));
  const lowQualityLeads = leads.filter((lead) =>
    lead.loss_reason && reasonSet.has(lead.loss_reason.toLowerCase().trim())
  );

  console.log(`Leads con razón de calidad baja (${config.LOW_QUALITY_LOSS_REASONS.join(', ')}): ${lowQualityLeads.length} de ${leads.length} totales.`);

  const phoneRows = [];
  const emailRows = [];
  lowQualityLeads.forEach((lead) => {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    if (phone) phoneRows.push([sha256(phone)]);
    if (email) emailRows.push([sha256(email)]);
  });

  console.log(`  con teléfono utilizable: ${phoneRows.length}`);
  console.log(`  con email utilizable: ${emailRows.length}`);

  if (phoneRows.length === 0 && emailRows.length === 0) {
    console.log('Nada para subir a Meta (ningún lead de calidad baja tiene teléfono o email cargado).');
    return;
  }

  try {
    const audienceId = config.META_LOW_QUALITY_AUDIENCE_ID;
    if (phoneRows.length > 0) {
      const r = await uploadBatch(audienceId, ['PHONE'], phoneRows);
      console.log(`Subido por teléfono: num_received=${r.num_received}`);
    }
    if (emailRows.length > 0) {
      const r = await uploadBatch(audienceId, ['EMAIL'], emailRows);
      console.log(`Subido por email: num_received=${r.num_received}`);
    }
    console.log('Sincronización de audiencia "calidad baja" completa. El tamaño final en Meta tarda unas horas en reflejarse (matching asíncrono).');
  } catch (err) {
    console.error('No se pudo sincronizar la audiencia de calidad baja (no rompe el resto del dashboard):', err.message);
  }
}

main().catch((err) => {
  console.error('Error inesperado en sync_meta_audience.js (no rompe el resto del dashboard):', err);
});
