// fetch_meta_ads_meta.js
// Trae directo de la Graph API de Meta (no de Windsor.ai) la lista de anuncios y
// campañas con su estado REAL (ACTIVE/PAUSED) y a qué campaña pertenece cada
// anuncio. Esto reemplaza la heurística vieja de "tuvo gasto en los últimos 3 días"
// por el dato real que reporta Meta, y además es lo que necesita el botón de
// pausar/activar para saber el ad_id de cada anuncio.
//
// Requiere variables de entorno:
//   META_SYSTEM_USER_TOKEN  -> token de system user con permiso ads_read (Business Manager)
//   META_AD_ACCOUNT_ID      -> ej "act_279997342813751"
//
// Salida: outputs/.data/meta_ads_meta.json
//   { ads: [{ id, name, status, campaign_id, campaign_name }],
//     campaigns: [{ id, name, status }] }

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

if (!TOKEN || !AD_ACCOUNT_ID) {
  console.error('Faltan META_SYSTEM_USER_TOKEN y/o META_AD_ACCOUNT_ID en las variables de entorno.');
  process.exit(1);
}

const GRAPH_VERSION = 'v21.0';

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

async function fetchCampaigns() {
  const sep = AD_ACCOUNT_ID.includes('?') ? '&' : '?';
  const data = await graphGetAllPages(
    `/${AD_ACCOUNT_ID}/campaigns${sep}fields=id,name,effective_status&limit=200&access_token=${TOKEN}`
  );
  return data.map((c) => ({ id: c.id, name: c.name, status: c.effective_status }));
}

async function fetchAds() {
  const data = await graphGetAllPages(
    `/${AD_ACCOUNT_ID}/ads?fields=id,name,effective_status,campaign{id,name}&limit=200&access_token=${TOKEN}`
  );
  return data.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.effective_status,
    campaign_id: a.campaign ? a.campaign.id : null,
    campaign_name: a.campaign ? a.campaign.name : null,
  }));
}

async function main() {
  console.log('Trayendo campañas desde la Graph API de Meta...');
  const campaigns = await fetchCampaigns();
  console.log(`  ${campaigns.length} campañas.`);

  console.log('Trayendo anuncios desde la Graph API de Meta...');
  const ads = await fetchAds();
  console.log(`  ${ads.length} anuncios.`);

  const outDir = path.join(__dirname, '..', '.data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'meta_ads_meta.json'), JSON.stringify({ campaigns, ads }));
  console.log('Guardado en .data/meta_ads_meta.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
