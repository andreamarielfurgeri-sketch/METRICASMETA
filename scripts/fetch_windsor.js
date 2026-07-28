// fetch_windsor.js
// Trae el gasto y resultados diarios de Meta Ads (por campaña y por anuncio) y de
// Google Ads (por campaña), usando la API REST de Windsor.ai (connectors.windsor.ai).
//
// Requiere variable de entorno:
//   WINDSOR_API_KEY  -> se obtiene en https://onboard.windsor.ai
//
// Salida en outputs/.data/:
//   meta_campaign_daily.json  [{ date, campaign, spend, results }]
//   meta_ad_daily.json        [{ date, ad_name, spend, results }]
//   google_campaign_daily.json[{ date, campaign, spend, conversions }]

const fs = require('fs');
const path = require('path');
const config = require('./config');

const API_KEY = process.env.WINDSOR_API_KEY;
if (!API_KEY) {
  console.error('Falta WINDSOR_API_KEY en las variables de entorno.');
  process.exit(1);
}

// Traemos desde el inicio de datos diarios de Meta hasta hoy.
const DATE_FROM = config.META_SPEND_DATA_START;
const DATE_TO = new Date().toISOString().slice(0, 10);

async function windsorGet(connector, fields) {
  const url = `https://connectors.windsor.ai/${connector}?api_key=${API_KEY}&date_from=${DATE_FROM}&date_to=${DATE_TO}&fields=${fields.join(',')}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DashboardEmporioChapa/1.0; +https://github.com)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Windsor.ai ${connector} ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  // Windsor.ai devuelve { data: [...] } en la mayoría de los connectors
  return json.data || json;
}

async function fetchMetaCampaignDaily() {
  const rows = await windsorGet('facebook', [
    'campaign',
    'date',
    'spend',
    'actions_onsite_conversion_messaging_conversation_started_7d',
  ]);
  return rows.map((r) => ({
    date: r.date,
    campaign: r.campaign,
    spend: Number(r.spend) || 0,
    results: Number(r.actions_onsite_conversion_messaging_conversation_started_7d) || 0,
  }));
}

async function fetchMetaAdDaily() {
  const rows = await windsorGet('facebook', [
    'ad_name',
    'date',
    'spend',
    'actions_onsite_conversion_messaging_conversation_started_7d',
  ]);
  return rows.map((r) => ({
    date: r.date,
    ad_name: r.ad_name,
    spend: Number(r.spend) || 0,
    results: Number(r.actions_onsite_conversion_messaging_conversation_started_7d) || 0,
  }));
}

async function fetchGoogleCampaignDaily() {
  const rows = await windsorGet('google_ads', ['campaign', 'date', 'spend', 'conversions']);
  return rows
    .filter((r) => config.GOOGLE_CAMPAIGN_NAMES.includes(r.campaign))
    .map((r) => ({
      date: r.date,
      campaign: r.campaign,
      spend: Number(r.spend) || 0,
      conversions: Number(r.conversions) || 0,
    }));
}

async function main() {
  const outDir = path.join(__dirname, '..', '.data');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Trayendo gasto diario de Meta por campaña...');
  const metaCampaignDaily = await fetchMetaCampaignDaily();
  fs.writeFileSync(path.join(outDir, 'meta_campaign_daily.json'), JSON.stringify(metaCampaignDaily));
  console.log(`  ${metaCampaignDaily.length} filas.`);

  console.log('Trayendo gasto diario de Meta por anuncio...');
  const metaAdDaily = await fetchMetaAdDaily();
  fs.writeFileSync(path.join(outDir, 'meta_ad_daily.json'), JSON.stringify(metaAdDaily));
  console.log(`  ${metaAdDaily.length} filas.`);

  console.log('Trayendo gasto diario de Google Ads...');
  const googleCampaignDaily = await fetchGoogleCampaignDaily();
  fs.writeFileSync(path.join(outDir, 'google_campaign_daily.json'), JSON.stringify(googleCampaignDaily));
  console.log(`  ${googleCampaignDaily.length} filas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
