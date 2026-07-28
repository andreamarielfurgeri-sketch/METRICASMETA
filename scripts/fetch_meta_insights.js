// fetch_meta_insights.js
// Trae el gasto diario REAL de Meta Ads (por campaña y por anuncio) directo de la
// Graph API de Meta, en vez de usar Windsor.ai para esto. Windsor.ai devuelve
// "Please check the API key used" 400 cuando se lo llama desde el runner de
// GitHub Actions, aunque la misma key funciona perfecto probada a mano — por eso
// se saca a Windsor de la cadena para el gasto de Meta y se usa el mismo token
// que ya se usa en fetch_meta_ads_meta.js.
//
// Requiere variables de entorno:
//   META_SYSTEM_USER_TOKEN  -> token de system user con permiso ads_read
//   META_AD_ACCOUNT_ID      -> ej "act_279997342813751"
//
// Salida en outputs/.data/:
//   meta_campaign_daily.json  [{ date, campaign, spend, results }]
//   meta_ad_daily.json        [{ date, ad_name, spend, results }]

const fs = require('fs');
const path = require('path');
const config = require('./config');

const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

if (!TOKEN || !AD_ACCOUNT_ID) {
  console.error('Faltan META_SYSTEM_USER_TOKEN y/o META_AD_ACCOUNT_ID en las variables de entorno.');
  process.exit(1);
}

const GRAPH_VERSION = 'v21.0';
const DATE_FROM = config.META_SPEND_DATA_START;
const DATE_TO = new Date().toISOString().slice(0, 10);
const RESULT_ACTION_TYPE = 'onsite_conversion.messaging_conversation_started_7d';

async function graphGetAllPages(url) {
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

function resultsFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  const row = actions.find((a) => a.action_type === RESULT_ACTION_TYPE);
  return row ? Number(row.value) || 0 : 0;
}

async function fetchInsights(level, nameField) {
  const timeRange = encodeURIComponent(JSON.stringify({ since: DATE_FROM, until: DATE_TO }));
  const fields = `${nameField},spend,actions`;
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT_ID}/insights` +
    `?level=${level}&time_increment=1&time_range=${timeRange}&fields=${fields}` +
    `&limit=500&access_token=${TOKEN}`;
  return graphGetAllPages(url);
}

async function fetchMetaCampaignDaily() {
  const rows = await fetchInsights('campaign', 'campaign_name');
  return rows.map((r) => ({
    date: r.date_start,
    campaign: r.campaign_name,
    spend: Number(r.spend) || 0,
    results: resultsFromActions(r.actions),
  }));
}

async function fetchMetaAdDaily() {
  const rows = await fetchInsights('ad', 'ad_name');
  return rows.map((r) => ({
    date: r.date_start,
    ad_name: r.ad_name,
    spend: Number(r.spend) || 0,
    results: resultsFromActions(r.actions),
  }));
}

async function main() {
  const outDir = path.join(__dirname, '..', '.data');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Trayendo gasto diario de Meta por campaña (Graph API)...');
  const metaCampaignDaily = await fetchMetaCampaignDaily();
  fs.writeFileSync(path.join(outDir, 'meta_campaign_daily.json'), JSON.stringify(metaCampaignDaily));
  console.log(`  ${metaCampaignDaily.length} filas.`);

  console.log('Trayendo gasto diario de Meta por anuncio (Graph API)...');
  const metaAdDaily = await fetchMetaAdDaily();
  fs.writeFileSync(path.join(outDir, 'meta_ad_daily.json'), JSON.stringify(metaAdDaily));
  console.log(`  ${metaAdDaily.length} filas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
