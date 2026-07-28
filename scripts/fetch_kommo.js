// fetch_kommo.js
// Trae TODOS los leads del pipeline "Embudo de ventas" desde la API de Kommo,
// paginando de a 250, usando el token de larga duración (KOMMO_TOKEN).
//
// Requiere variables de entorno:
//   KOMMO_SUBDOMAIN   -> ej "emporiodelachapa" (de https://emporiodelachapa.kommo.com)
//   KOMMO_TOKEN       -> long-lived token generado en Ajustes > Integraciones
//
// Salida: array de leads normalizados en outputs/kommo_leads.json
//   { id, price, status_id, created_at (YYYY-MM-DD), responsible_user_id,
//     responsible_user_name, utm_source, utm_campaign, utm_content }

const fs = require('fs');
const path = require('path');
const config = require('./config');

const SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const TOKEN = process.env.KOMMO_TOKEN;

if (!SUBDOMAIN || !TOKEN) {
  console.error('Faltan KOMMO_SUBDOMAIN y/o KOMMO_TOKEN en las variables de entorno.');
  process.exit(1);
}

const BASE_URL = `https://${SUBDOMAIN}.kommo.com`;

async function kommoFetch(urlPath) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 204) return null; // sin más resultados
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kommo API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function fetchUsers() {
  const users = {};
  let page = 1;
  while (true) {
    const data = await kommoFetch(`/api/v4/users?page=${page}&limit=250`);
    if (!data || !data._embedded || !data._embedded.users.length) break;
    data._embedded.users.forEach((u) => { users[u.id] = u.name; });
    if (!data._links || !data._links.next) break;
    page += 1;
  }
  return users;
}

function getCustomFieldValue(lead, fieldId) {
  const cf = (lead.custom_fields_values || []).find((f) => f.field_id === fieldId);
  if (!cf || !cf.values || !cf.values.length) return null;
  return cf.values[0].value;
}

function toDateStr(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

async function fetchLeads(users) {
  const leads = [];
  let page = 1;
  const excludeSet = new Set(config.EXCLUDE_LEAD_IDS);

  while (true) {
    const data = await kommoFetch(
      `/api/v4/leads?filter[pipeline_id]=${config.KOMMO_PIPELINE_ID}&page=${page}&limit=250&with=custom_fields_values`
    );
    if (!data || !data._embedded || !data._embedded.leads.length) break;

    data._embedded.leads.forEach((lead) => {
      if (excludeSet.has(lead.id)) return;

      const stageInfo = config.STAGE_MAP[lead.status_id];
      if (!stageInfo) return; // status fuera del embudo que nos interesa (ganado/perdido de otro pipeline, etc.)

      const price = lead.price || 0;
      if (price > 0 && (price < config.MIN_VALID_AMOUNT || price > config.MAX_VALID_AMOUNT)) {
        return; // precio anómalo, se excluye (task #27)
      }

      leads.push({
        id: lead.id,
        price,
        status_id: lead.status_id,
        stage_index: stageInfo.index,
        created_at: toDateStr(lead.created_at),
        responsible_user_id: lead.responsible_user_id,
        responsible_user_name: users[lead.responsible_user_id] || `Usuario ${lead.responsible_user_id}`,
        utm_source: getCustomFieldValue(lead, config.FIELD_UTM_SOURCE),
        utm_campaign: getCustomFieldValue(lead, config.FIELD_UTM_CAMPAIGN),
        utm_content: getCustomFieldValue(lead, config.FIELD_UTM_CONTENT),
      });
    });

    console.log(`Kommo: página ${page}, ${data._embedded.leads.length} leads, acumulado ${leads.length}`);
    if (!data._links || !data._links.next) break;
    page += 1;
  }

  return leads;
}

async function main() {
  console.log('Trayendo usuarios de Kommo...');
  const users = await fetchUsers();
  console.log(`  ${Object.keys(users).length} usuarios.`);

  console.log('Trayendo leads de Kommo (esto puede tardar unos minutos)...');
  const leads = await fetchLeads(users);
  console.log(`Total leads procesados: ${leads.length}`);

  const outDir = path.join(__dirname, '..', '.data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'kommo_leads.json'), JSON.stringify(leads));
  console.log('Guardado en .data/kommo_leads.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
