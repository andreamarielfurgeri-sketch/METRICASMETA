// build_dashboard.js
// Combina los datos ya descargados en outputs/.data/*.json (por fetch_kommo.js,
// fetch_windsor.js y fetch_meta_ads_meta.js) y genera docs/index.html, la página
// que sirve GitHub Pages. No llama a ninguna API: solo lee JSON local y arma HTML.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', '.data');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

function loadJSON(name, fallback) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) {
    console.warn(`Aviso: no existe ${name}, se usa ${JSON.stringify(fallback)}`);
    return fallback;
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function isMetaSource(utmSource) {
  if (!utmSource) return false;
  const s = utmSource.toLowerCase();
  return s === 'meta' || s === 'facebook' || s === 'fb' || s === 'instagram';
}

function main() {
  const leads = loadJSON('kommo_leads.json', []);
  const metaCampaignDaily = loadJSON('meta_campaign_daily.json', []);
  const metaAdDaily = loadJSON('meta_ad_daily.json', []);
  const googleCampaignDaily = loadJSON('google_campaign_daily.json', []);
  const metaAdsMeta = loadJSON('meta_ads_meta.json', { campaigns: [], ads: [] });

  // --- Mapear ad_name -> [campaign_name...] y campaign_name -> status, ad_name -> status,
  // usando el dato REAL de Meta (no heurística de gasto reciente) ---
  const adCampaignMap = {}; // name -> Set(campaign_name)
  const adStatusByName = {}; // name -> 'activa' si ALGUNA instancia está activa
  const adIdMap = []; // [{id, name, status, campaign_id, campaign_name}] para el panel de control
  const campaignIdMap = metaAdsMeta.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })); // para pausar/activar campañas
  metaAdsMeta.ads.forEach((ad) => {
    if (!adCampaignMap[ad.name]) adCampaignMap[ad.name] = new Set();
    if (ad.campaign_name) adCampaignMap[ad.name].add(ad.campaign_name);
    const isActive = ad.status === 'ACTIVE';
    if (isActive || adStatusByName[ad.name] === undefined) {
      adStatusByName[ad.name] = isActive ? 'activa' : 'pausada';
    }
    adIdMap.push({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      campaign_id: ad.campaign_id,
      campaign_name: ad.campaign_name,
    });
  });

  const campaignStatusByName = {};
  metaAdsMeta.campaigns.forEach((c) => {
    campaignStatusByName[c.name] = c.status === 'ACTIVE' ? 'activa' : 'pausada';
  });

  // Resolver campaña real de un ad_name (para redistribuir utm_campaign roto)
  function realCampaignForAd(adName) {
    const set = adCampaignMap[adName];
    if (!set || set.size === 0) return null;
    return Array.from(set)[0]; // si el anuncio corre en varias campañas, tomamos la primera
  }

  // --- Descubrir dinámicamente CAMPAIGNS, AD_NAMES, USERS ---
  const campaignSet = new Set();
  const adNameSet = new Set();
  const userSet = new Set();
  const vendorAdUserSet = new Set();

  metaAdsMeta.campaigns.forEach((c) => campaignSet.add(c.name));
  metaAdsMeta.ads.forEach((a) => adNameSet.add(a.name));

  leads.forEach((lead) => {
    userSet.add(lead.responsible_user_name);
    if (isMetaSource(lead.utm_source)) {
      let campaign = lead.utm_campaign;
      if (campaign === config.BROKEN_UTM_CAMPAIGN_LITERAL && lead.utm_content) {
        campaign = realCampaignForAd(lead.utm_content) || campaign;
      }
      if (campaign) campaignSet.add(campaign);
      if (lead.utm_content) {
        adNameSet.add(lead.utm_content);
        vendorAdUserSet.add(lead.responsible_user_name);
      }
    }
  });

  const CAMPAIGNS = Array.from(campaignSet).sort();
  const AD_NAMES = Array.from(adNameSet).sort();
  const USERS = Array.from(userSet).sort();
  const USER_NAMES_AD = Array.from(vendorAdUserSet).sort();
  const SOURCES = ['meta', 'sin_utm'];

  const campaignIndex = Object.fromEntries(CAMPAIGNS.map((c, i) => [c, i]));
  const adIndex = Object.fromEntries(AD_NAMES.map((c, i) => [c, i]));
  const userAdIndex = Object.fromEntries(USER_NAMES_AD.map((c, i) => [c, i]));

  // --- DISPLAY_CAMPAIGNS / META_NAME_MAP (alias de negocio, ver config.js) ---
  const DISPLAY_CAMPAIGNS = {};
  const META_NAME_MAP = {};
  CAMPAIGNS.forEach((c) => {
    const display = config.CAMPAIGN_ALIASES[c] || c;
    DISPLAY_CAMPAIGNS[c] = display;
    if (!(display in META_NAME_MAP)) META_NAME_MAP[display] = c;
  });

  // --- CAMPAIGN_STATUS / AD_STATUS ---
  const CAMPAIGN_STATUS = {};
  CAMPAIGNS.forEach((c) => { CAMPAIGN_STATUS[c] = campaignStatusByName[c] || 'sindato'; });
  const AD_STATUS = {};
  AD_NAMES.forEach((a) => { AD_STATUS[a] = adStatusByName[a] || 'sindato'; });

  // --- AD_CAMPAIGN_MAP (para mostrar en la tabla de anuncios) ---
  const AD_CAMPAIGN_MAP = {};
  AD_NAMES.forEach((a) => {
    AD_CAMPAIGN_MAP[a] = adCampaignMap[a] ? Array.from(adCampaignMap[a]) : [];
  });

  // --- ROWS: una fila por día que tuvo al menos un lead ---
  const rowsByDate = {}; // date -> { stage:[[c,a]x5], src:[[c,a,cv,va]x2], camp:[...], ad:[...], vendorAd:[...] }

  function emptyPairArray(n) { return Array.from({ length: n }, () => [0, 0]); }
  function emptyQuadArray(n) { return Array.from({ length: n }, () => [0, 0, 0, 0]); }

  function getRow(date) {
    if (!rowsByDate[date]) {
      rowsByDate[date] = {
        stage: emptyPairArray(config.STAGES.length),
        stageMeta: emptyPairArray(config.STAGES.length),
        src: emptyQuadArray(SOURCES.length),
        camp: emptyQuadArray(CAMPAIGNS.length),
        ad: emptyQuadArray(AD_NAMES.length),
        vendorAd: emptyQuadArray(USER_NAMES_AD.length),
      };
    }
    return rowsByDate[date];
  }

  // MONTHLY_USER[month][user] = {countCotizado, amountCotizado, countVendido, amountVendido}
  const MONTHLY_USER = {};

  leads.forEach((lead) => {
    const row = getRow(lead.created_at);
    const isVenta = lead.stage_index === 4;
    const amount = lead.price || 0;

    // Etapa
    row.stage[lead.stage_index][0] += 1;
    row.stage[lead.stage_index][1] += amount;
    if (isMetaSource(lead.utm_source)) {
      row.stageMeta[lead.stage_index][0] += 1;
      row.stageMeta[lead.stage_index][1] += amount;
    }

    // Fuente
    const srcIdx = isMetaSource(lead.utm_source) ? 0 : 1;
    row.src[srcIdx][0] += 1;
    row.src[srcIdx][1] += amount;
    if (isVenta) { row.src[srcIdx][2] += 1; row.src[srcIdx][3] += amount; }

    // Campaña / anuncio (solo tráfico de Meta con utm cargado)
    if (isMetaSource(lead.utm_source)) {
      let campaign = lead.utm_campaign;
      if (campaign === config.BROKEN_UTM_CAMPAIGN_LITERAL && lead.utm_content) {
        campaign = realCampaignForAd(lead.utm_content) || campaign;
      }
      if (campaign && campaign in campaignIndex) {
        const ci = campaignIndex[campaign];
        row.camp[ci][0] += 1;
        row.camp[ci][1] += amount;
        if (isVenta) { row.camp[ci][2] += 1; row.camp[ci][3] += amount; }
      }
      if (lead.utm_content && lead.utm_content in adIndex) {
        const ai = adIndex[lead.utm_content];
        row.ad[ai][0] += 1;
        row.ad[ai][1] += amount;
        if (isVenta) { row.ad[ai][2] += 1; row.ad[ai][3] += amount; }

        if (lead.responsible_user_name in userAdIndex) {
          const ui = userAdIndex[lead.responsible_user_name];
          row.vendorAd[ui][0] += 1;
          row.vendorAd[ui][1] += amount;
          if (isVenta) { row.vendorAd[ui][2] += 1; row.vendorAd[ui][3] += amount; }
        }
      }
    }

    // Por responsable, mensual
    const month = lead.created_at.slice(0, 7);
    if (!MONTHLY_USER[month]) MONTHLY_USER[month] = {};
    if (!MONTHLY_USER[month][lead.responsible_user_name]) {
      MONTHLY_USER[month][lead.responsible_user_name] = {
        countCotizado: 0, amountCotizado: 0, countVendido: 0, amountVendido: 0,
      };
    }
    const mu = MONTHLY_USER[month][lead.responsible_user_name];
    mu.countCotizado += 1;
    mu.amountCotizado += amount;
    if (isVenta) { mu.countVendido += 1; mu.amountVendido += amount; }
  });

  const ROWS = Object.keys(rowsByDate).sort().map((date) => {
    const r = rowsByDate[date];
    return [date, r.stage, r.src, r.camp, r.ad, r.vendorAd, r.stageMeta];
  });

  // --- META_DAILY / META_AD_DAILY / GOOGLE_DAILY ---
  const META_DAILY = metaCampaignDaily; // ya viene como {date, campaign, spend, results}
  const META_AD_DAILY = metaAdDaily; // {date, ad_name, spend, results}

  const googleByDate = {};
  googleCampaignDaily.forEach((r) => {
    if (!googleByDate[r.date]) googleByDate[r.date] = [0, 0];
    googleByDate[r.date][0] += r.spend;
    googleByDate[r.date][1] += r.conversions;
  });
  const GOOGLE_DAILY = Object.keys(googleByDate).sort().map((date) => [date, googleByDate[date][0], googleByDate[date][1]]);

  // --- Armar el bloque de datos JS ---
  const dataBlock = [
    `const STAGES = ${JSON.stringify(config.STAGES)};`,
    `const SOURCES = ${JSON.stringify(SOURCES)};`,
    `const CAMPAIGNS = ${JSON.stringify(CAMPAIGNS)};`,
    `const AD_NAMES = ${JSON.stringify(AD_NAMES)};`,
    `const USER_NAMES_AD = ${JSON.stringify(USER_NAMES_AD)};`,
    `const USERS = ${JSON.stringify(USERS)};`,
    `const DISPLAY_CAMPAIGNS = ${JSON.stringify(DISPLAY_CAMPAIGNS)};`,
    `const META_NAME_MAP = ${JSON.stringify(META_NAME_MAP)};`,
    `const CAMPAIGN_STATUS = ${JSON.stringify(CAMPAIGN_STATUS)};`,
    `const AD_STATUS = ${JSON.stringify(AD_STATUS)};`,
    `const AD_CAMPAIGN_MAP = ${JSON.stringify(AD_CAMPAIGN_MAP)};`,
    `const AD_ID_MAP = ${JSON.stringify(adIdMap)};`,
    `const CAMPAIGN_ID_MAP = ${JSON.stringify(campaignIdMap)};`,
    `const ROWS = ${JSON.stringify(ROWS)};`,
    `const MONTHLY_USER = ${JSON.stringify(MONTHLY_USER)};`,
    `const META_DAILY = ${JSON.stringify(META_DAILY)};`,
    `const META_AD_DAILY = ${JSON.stringify(META_AD_DAILY)};`,
    `const GOOGLE_DAILY = ${JSON.stringify(GOOGLE_DAILY)};`,
  ].join('\n');

  // --- Inyectar en el template ---
  const template = fs.readFileSync(path.join(DOCS_DIR, 'template.html'), 'utf-8');
  const nowArg = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const finalHtml = template
    .replace('/*__DATA_BLOCK__*/', dataBlock)
    .replace('__LAST_UPDATED__', nowArg);

  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), finalHtml);
  console.log(`docs/index.html generado. ${ROWS.length} días, ${CAMPAIGNS.length} campañas, ${AD_NAMES.length} anuncios, ${leads.length} leads.`);
}

main();
