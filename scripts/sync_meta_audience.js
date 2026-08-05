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

const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;
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
async function graphGetAllPages(pathAndQuery) {
  let url = `https://graph.facebook.com/${GRAPH_VERSION}${pathAndQuery}`;
  const results = [];
  while (url) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(`Meta Graph API error: ${JSON.stringify(json.error)}`);
    }
    results.push(...(json.data || []));
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return results;
}

// Chequea los conjuntos de anuncios ACTIVOS de la cuenta y, si alguno no tiene
// excluido el público "PUBLICO CALIDAD BAJA" en su segmentación, se lo agrega vía
// la API (POST /{adset_id} con el mismo objeto "targeting" que ya tenía, sumando
// nuestra audiencia a excluded_custom_audiences — así no se toca nada más de la
// segmentación existente). No rompe el build si falla: cada conjunto se actualiza
// por separado, así que un error en uno no afecta a los demás.
async function checkExclusionCoverage() {
  if (!AD_ACCOUNT_ID) {
    console.log('(META_AD_ACCOUNT_ID no configurado, se omite el chequeo de exclusión por conjunto de anuncios.)');
    return;
  }
  try {
    const fields = [
      'id',
      'name',
      'effective_status',
      'campaign{id,name,effective_status}',
      'targeting',
    ].join(',');
    const adsets = await graphGetAllPages(
      `/${AD_ACCOUNT_ID}/adsets?fields=${fields}&limit=200&access_token=${TOKEN}`
    );
    const active = adsets.filter((a) => a.effective_status === 'ACTIVE');
    console.log('');
    console.log(`Chequeo de exclusión — conjuntos de anuncios ACTIVOS: ${active.length} de ${adsets.length} totales.`);

    const alreadyOk = [];
    const toFix = [];
    active.forEach((a) => {
      const excludedIds = ((a.targeting && a.targeting.excluded_custom_audiences) || []).map((x) => x.id);
      const campName = a.campaign ? a.campaign.name : '(sin campaña)';
      const line = `  [${campName}] ${a.name} (adset ${a.id})`;
      if (excludedIds.includes(config.META_LOW_QUALITY_AUDIENCE_ID)) {
        alreadyOk.push(line);
      } else {
        toFix.push(a);
      }
    });

    console.log(`SÍ excluían "PUBLICO CALIDAD BAJA" ya de antes (${alreadyOk.length}):`);
    alreadyOk.forEach((l) => console.log(l));
    console.log(`NO excluían "PUBLICO CALIDAD BAJA" — se les agrega ahora por API (${toFix.length}):`);

    let fixedCount = 0;
    let failedCount = 0;
    for (const a of toFix) {
      const campName = a.campaign ? a.campaign.name : '(sin campaña)';
      const label = `  [${campName}] ${a.name} (adset ${a.id})`;
      const targeting = a.targeting || {};
      const excluded = targeting.excluded_custom_audiences || [];
      const newTargeting = {
        ...targeting,
        excluded_custom_audiences: [...excluded, { id: config.META_LOW_QUALITY_AUDIENCE_ID }],
      };
      try {
        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${a.id}`;
        const body = new URLSearchParams({
          targeting: JSON.stringify(newTargeting),
          access_token: TOKEN,
        });
        const res = await fetch(url, { method: 'POST', body });
        const json = await res.json();
        if (json.error) {
          throw new Error(JSON.stringify(json.error));
        }
        fixedCount += 1;
        console.log(`${label} -> agregada OK.`);
      } catch (err) {
        failedCount += 1;
        console.log(`${label} -> ERROR: ${err.message}`);
      }
    }
    console.log(`Exclusión agregada en ${fixedCount} de ${toFix.length} conjuntos que la necesitaban (${failedCount} con error).`);
  } catch (err) {
    console.error('No se pudo chequear/corregir la exclusión por conjunto de anuncios (no rompe el resto del dashboard):', err.message);
  }
}

// Chequeo puntual (temporal, para diagnóstico): confirma si nuestro token tiene
// acceso al "conjunto de datos" de Meta 930032456434329 (Events Manager / Conversions
// API, mencionado por Andy como "KOMMO EMPORIO LEADS") y si está recibiendo eventos.
// Es un objeto distinto de las Custom Audiences — no se usa en el resto de este
// script. Se puede borrar este bloque una vez confirmado.
async function checkDatasetAccess() {
  const DATASET_ID = '930032456434329';
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}?access_token=${TOKEN}`
    );
    const json = await res.json();
    console.log('');
    if (json.error) {
      console.log(`Chequeo dataset ${DATASET_ID}: SIN ACCESO — ${JSON.stringify(json.error)}`);
    } else {
      console.log(`Chequeo dataset ${DATASET_ID}: acceso OK. Respuesta completa:`);
      console.log(JSON.stringify(json));
    }
    // Segundo intento: pedirle explícitamente los campos típicos de un dataset de
    // Events Manager (Conversions API), a ver si el objeto responde a ese tipo.
    try {
      const res2 = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}?fields=id,name,description,creation_time&access_token=${TOKEN}`
      );
      const json2 = await res2.json();
      console.log(`Chequeo dataset ${DATASET_ID} (fields id,name,description,creation_time): ${JSON.stringify(json2)}`);
    } catch (err2) {
      console.log(`Segundo intento falló: ${err2.message}`);
    }
    // Tercer intento: ver si es un Custom Audience / Product Catalog / Business, probando el
    // endpoint de "stats" típico de datasets de Conversions API.
    try {
      const res3 = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${DATASET_ID}/stats?access_token=${TOKEN}`
      );
      const json3 = await res3.json();
      console.log(`Chequeo dataset ${DATASET_ID}/stats: ${JSON.stringify(json3).slice(0, 500)}`);
    } catch (err3) {
      console.log(`Tercer intento falló: ${err3.message}`);
    }
  } catch (err) {
    console.log(`Chequeo dataset ${DATASET_ID}: error de red — ${err.message}`);
  }
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
    console.warn('Falta META_SYSTEM_USER_TOKEN, se omite la sincronizacion de audiencia de calidad baja.');
    return;
  }
  await checkExclusionCoverage();
  await checkDatasetAccess();

const leadsPath = path.join(DATA_DIR, 'kommo_leads.json');
  if (!fs.existsSync(leadsPath)) {
    console.warn('No existe .data/kommo_leads.json todavia, se omite la sincronizacion de audiencia.');
    return;
  }
  const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf-8'));

const reasonSet = new Set(config.LOW_QUALITY_LOSS_REASONS.map((r) => r.toLowerCase().trim()));
  const lowQualityLeads = leads.filter((lead) =>
    lead.loss_reason && reasonSet.has(lead.loss_reason.toLowerCase().trim())
                                       );

console.log(`Leads con razon de calidad baja (${config.LOW_QUALITY_LOSS_REASONS.join(', ')}): ${lowQualityLeads.length} de ${leads.length} totales.`);

const phoneRows = [];
  const emailRows = [];
  lowQualityLeads.forEach((lead) => {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    if (phone) phoneRows.push([sha256(phone)]);
    if (email) emailRows.push([sha256(email)]);
  });

console.log(`  con telefono utilizable: ${phoneRows.length}`);
  console.log(`  con email utilizable: ${emailRows.length}`);

if (phoneRows.length === 0 && emailRows.length === 0) {
  console.log('Nada para subir a Meta (ningun lead de calidad baja tiene telefono o email cargado).');
  return;
}

try {
  const audienceId = config.META_LOW_QUALITY_AUDIENCE_ID;
  if (phoneRows.length > 0) {
    const r = await uploadBatch(audienceId, ['PHONE'], phoneRows);
    console.log(`Subido por telefono: num_received=${r.num_received}`);
  }
  if (emailRows.length > 0) {
    const r = await uploadBatch(audienceId, ['EMAIL'], emailRows);
    console.log(`Subido por email: num_received=${r.num_received}`);
  }
  console.log('Sincronizacion de audiencia "calidad baja" completa. El tamaño final en Meta tarda unas horas en reflejarse (matching asincrono).');
} catch (err) {
  console.error('No se pudo sincronizar la audiencia de calidad baja (no rompe el resto del dashboard):', err.message);
}
}

main().catch((err) => {
  console.error('Error inesperado en sync_meta_audience.js (no rompe el resto del dashboard):', err);
});
