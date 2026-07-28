// fetch_windsor.js
// Trae el gasto diario de Google Ads (por campaña) usando la API REST de
// Windsor.ai (connectors.windsor.ai).
//
// El gasto de Meta Ads YA NO se trae acá: se saca directo de la Graph API de
// Meta (ver fetch_meta_insights.js), porque Windsor.ai devuelve
// "Please check the API key used" 400 cuando se lo llama desde el runner de
// GitHub Actions (aunque la misma key funciona bien probada a mano).
//
// Requiere variable de entorno:
//   WINDSOR_API_KEY  -> se obtiene en https://onboard.windsor.ai
//
// Salida en outputs/.data/:
//   google_campaign_daily.json[{ date, campaign, spend, conversions }]
//
// Este script NUNCA corta el workflow con exit code distinto de 0: si Windsor.ai
// falla por lo que sea, escribe un archivo vacío y sigue, para que el resto del
// dashboard (Kommo + Meta) se actualice igual.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const API_KEY = process.env.WINDSOR_API_KEY;

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

  if (!API_KEY) {
    console.error('Falta WINDSOR_API_KEY: se guarda gasto de Google Ads vacío y se sigue.');
    fs.writeFileSync(path.join(outDir, 'google_campaign_daily.json'), '[]');
    return;
  }

  console.log('Trayendo gasto diario de Google Ads...');
  try {
    const googleCampaignDaily = await fetchGoogleCampaignDaily();
    fs.writeFileSync(path.join(outDir, 'google_campaign_daily.json'), JSON.stringify(googleCampaignDaily));
    console.log(`  ${googleCampaignDaily.length} filas.`);
  } catch (err) {
    console.error('Windsor.ai falló, se guarda gasto de Google Ads vacío y se sigue (no corta el workflow):');
    console.error(err.message);
    fs.writeFileSync(path.join(outDir, 'google_campaign_daily.json'), '[]');
  }
}

main().catch((err) => {
  // No debería llegar acá porque fetchGoogleCampaignDaily ya atrapa sus propios
  // errores, pero por las dudas no cortamos el workflow tampoco desde acá.
  console.error(err);
});
