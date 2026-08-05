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

// Paso único (temporal): crea el público "PUBLICO CALIDAD ALTA" en Meta si todavía
// no existe (config.META_HIGH_QUALITY_AUDIENCE_ID vacío). El ID que devuelve Meta
// hay que copiarlo a mano a config.js una sola vez. Se puede borrar este bloque
// (y su llamada en main) una vez que el ID ya esté en config.js.
async function createHighQualityAudienceIfNeeded() {
  if (config.META_HIGH_QUALITY_AUDIENCE_ID) return;
  if (!AD_ACCOUNT_ID) {
    console.log('(META_AD_ACCOUNT_ID no configurado, no se puede crear el público de calidad alta.)');
    return;
  }
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/customaudiences`;
    const body = new URLSearchParams({
      name: 'PUBLICO CALIDAD ALTA',
      description: 'Leads de Kommo en etapa Venta (ganados) - semilla para Lookalike. Generado automáticamente.',
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
      access_token: TOKEN,
    });
    const res = await fetch(url, { method: 'POST', body });
    const json = await res.json();
    console.log('');
    if (json.error) {
      console.log(`No se pudo crear el público de calidad alta: ${JSON.stringify(json.error)}`);
    } else {
      console.log(`Público "PUBLICO CALIDAD ALTA" creado. ID: ${json.id}`);
      console.log('  >>> COPIAR ESTE ID a config.js en META_HIGH_QUALITY_AUDIENCE_ID <<<');
    }
  } catch (err) {
    console.log(`Error creando público de calidad alta: ${err.message}`);
  }
}

// Paso único (temporal): crea el público Lookalike a partir de "PUBLICO CALIDAD
// ALTA". Se puede borrar este bloque (y su llamada en main) una vez creado.
async function createLookalikeIfNeeded() {
  if (!config.META_HIGH_QUALITY_AUDIENCE_ID || !AD_ACCOUNT_ID) return;
  if (config.META_LOOKALIKE_AUDIENCE_ID) return; // ya creado, no crear otro cada día
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/customaudiences`;
    const body = new URLSearchParams({
      name: 'PUBLICO SIMILAR CALIDAD ALTA (1% AR)',
      description: 'Lookalike de PUBLICO CALIDAD ALTA (leads en etapa Venta). Generado automáticamente.',
      subtype: 'LOOKALIKE',
      origin_audience_id: config.META_HIGH_QUALITY_AUDIENCE_ID,
      lookalike_spec: JSON.stringify({ type: 'similarity', country: 'AR', ratio: 0.01 }),
      access_token: TOKEN,
    });
    const res = await fetch(url, { method: 'POST', body });
    const json = await res.json();
    console.log('');
    if (json.error) {
      console.log(`No se pudo crear el Lookalike: ${JSON.stringify(json.error)}`);
    } else {
      console.log(`Lookalike "PUBLICO SIMILAR CALIDAD ALTA (1% AR)" creado. ID: ${json.id}`);
    }
  } catch (err) {
    console.log(`Error creando Lookalike: ${err.message}`);
  }
}

// Conecta el público Lookalike (calidad alta) como señal de targeting en los conjuntos de
// anuncios activos que todavía no lo tienen. Se dejan afuera a propósito los conjuntos en
// config.LOOKALIKE_EXCLUDE_ADSET_IDS (pedido de Andy, ej. TIMAT). Al ser Advantage+ audience,
// esto no restringe el targeting: es una señal para que Meta priorice gente similar a los
// leads en etapa "Venta" (ganados). Se puede correr todos los días: no vuelve a tocar los
// conjuntos que ya lo tienen conectado.
async function checkLookalikeSignalCoverage() {
  if (!AD_ACCOUNT_ID) {
    console.log('(META_AD_ACCOUNT_ID no configurado, se omite la conexión del Lookalike a los conjuntos de anuncios.)');
    return;
  }
  if (!config.META_LOOKALIKE_AUDIENCE_ID) {
    console.log('(META_LOOKALIKE_AUDIENCE_ID no configurado todavía, se omite la conexión del Lookalike.)');
    return;
  }
  try {
    const fields = ['id','name','effective_status','campaign{id,name,effective_status}','targeting'].join(',');
    const adsets = await graphGetAllPages(`/${AD_ACCOUNT_ID}/adsets?fields=${fields}&limit=200&access_token=${TOKEN}`);
    const excludeIds = config.LOOKALIKE_EXCLUDE_ADSET_IDS || [];
    const active = adsets.filter((a) => a.effective_status === 'ACTIVE' && !excludeIds.includes(a.id));
    const alreadyOk = [];
    const toFix = [];
    active.forEach((a) => {
      const includedIds = ((a.targeting && a.targeting.custom_audiences) || []).map((x) => x.id);
      if (includedIds.includes(config.META_LOOKALIKE_AUDIENCE_ID)) {
        alreadyOk.push(a);
      } else {
        toFix.push(a);
      }
    });
    console.log(`Conexión del Lookalike (señal de targeting) — conjuntos activos elegibles: ${active.length} (excluidos a propósito: ${excludeIds.length}).`);
    console.log(`Ya tenían el Lookalike conectado (${alreadyOk.length}).`);
    console.log(`No lo tenían — se agrega ahora por API (${toFix.length}):`);
    toFix.forEach((a) => {
      console.log(`  [${(a.campaign && a.campaign.name) || '?'}] ${a.name} (adset ${a.id})`);
    });

    let fixedCount = 0;
    let failedCount = 0;
    for (const a of toFix) {
      const targeting = a.targeting || {};
      const included = targeting.custom_audiences || [];
      const newTargeting = { ...targeting, custom_audiences: [...included, { id: config.META_LOOKALIKE_AUDIENCE_ID }] };
      try {
        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${a.id}`;
        const body = new URLSearchParams({ targeting: JSON.stringify(newTargeting), access_token: TOKEN });
        const res = await fetch(url, { method: 'POST', body });
        const json = await res.json();
        if (json.error) throw new Error(JSON.stringify(json.error));
        fixedCount += 1;
      } catch (err) {
        failedCount += 1;
        console.log(`  Error conectando Lookalike en adset ${a.id}: ${err.message}`);
      }
    }
    console.log(`Lookalike conectado en ${fixedCount} de ${toFix.length} conjuntos que lo necesitaban (${failedCount} con error).`);
  } catch (err) {
    console.error('No se pudo chequear/conectar el Lookalike a los conjuntos de anuncios:', err.message);
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
  await createHighQualityAudienceIfNeeded();
  await createLookalikeIfNeeded();
  await checkLookalikeSignalCoverage();

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
  // --- Público "calidad alta" (semilla del Lookalike) ---
  if (!config.META_HIGH_QUALITY_AUDIENCE_ID) {
    console.log('(META_HIGH_QUALITY_AUDIENCE_ID no configurado todavía, se omite la sincronización de audiencia de calidad alta.)');
    return;
  }

  const highQualityLeads = leads.filter((lead) => lead.stage_index === config.HIGH_QUALITY_STAGE_INDEX);
  console.log(`Leads en etapa "Venta" (calidad alta, semilla del Lookalike): ${highQualityLeads.length} de ${leads.length} totales.`);

  const hqPhoneRows = [];
  const hqEmailRows = [];
  highQualityLeads.forEach((lead) => {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    if (phone) hqPhoneRows.push([sha256(phone)]);
    if (email) hqEmailRows.push([sha256(email)]);
  });

  console.log(`  con teléfono utilizable: ${hqPhoneRows.length}`);
  console.log(`  con email utilizable: ${hqEmailRows.length}`);

  if (hqPhoneRows.length === 0 && hqEmailRows.length === 0) {
    console.log('Nada para subir a Meta (ningún lead de calidad alta tiene teléfono o email cargado).');
    return;
  }

  try {
    const hqAudienceId = config.META_HIGH_QUALITY_AUDIENCE_ID;
    if (hqPhoneRows.length > 0) {
      const r = await uploadBatch(hqAudienceId, ['PHONE'], hqPhoneRows);
      console.log(`Calidad alta — subido por teléfono: num_received=${r.num_received}`);
    }
    if (hqEmailRows.length > 0) {
      const r = await uploadBatch(hqAudienceId, ['EMAIL'], hqEmailRows);
      console.log(`Calidad alta — subido por email: num_received=${r.num_received}`);
    }
    console.log('Sincronización de audiencia "calidad alta" completa.');
  } catch (err) {
    console.error('No se pudo sincronizar la audiencia de calidad alta (no rompe el resto del dashboard):', err.message);
  }
}

main().catch((err) => {
  console.error('Error inesperado en sync_meta_audience.js (no rompe el resto del dashboard):', err);
});
