// config.js
// Conocimiento del negocio que no se puede "descubrir" solo desde las APIs.
// Si aparece una campaña/anuncio nuevo raro, o hay que excluir un lead de prueba,
// este es el único archivo que hay que tocar a mano.

module.exports = {
  // Pipeline de Kommo a usar ("Embudo de ventas")
  KOMMO_PIPELINE_ID: 13827447,

  // IDs de los campos personalizados en Kommo
  FIELD_UTM_SOURCE: 2071484,
  FIELD_UTM_CAMPAIGN: 2071482,
  FIELD_UTM_CONTENT: 2071478,

  // Mapeo de status_id de Kommo -> etapa del embudo mostrada en el dashboard
  STAGE_MAP: {
    106693575: { index: 0, name: 'Derivado' },
    106693579: { index: 1, name: 'Seguimiento' },
    108506859: { index: 2, name: 'Seguimiento a cerrar' },
    143:       { index: 3, name: 'Otros' },
    142:       { index: 4, name: 'Venta' },
  },
  STAGES: ['Derivado', 'Seguimiento', 'Seguimiento a cerrar', 'Otros', 'Venta'],

  // Leads de prueba / basura que hay que excluir siempre (IDs de Kommo)
  EXCLUDE_LEAD_IDS: [
    17407273, 17407274, 17407275, 17407276, 17407277, 17407278, 17407279,
    17407280, 17407281, 17407282, 17407283, 17407284, 17407285, 17407286,
    17407287, 20012614, 14429018, 18366682, 17703618,
  ],

  // Filtro de precio anómalo (task #27): montos fuera de este rango se excluyen del dashboard
  MIN_VALID_AMOUNT: 1000,
  MAX_VALID_AMOUNT: 200000000,

  // Valor literal que aparece en utm_campaign cuando la plantilla de UTM de Meta
  // estaba rota (texto "nombre_campaña" en vez de la variable dinámica). Si un lead
  // nuevo trae este valor y tiene utm_content, se redirige a la campaña real del
  // anuncio usando el mapeo ad -> campaña que trae Meta.
  BROKEN_UTM_CAMPAIGN_LITERAL: 'nombre_campaña',

  // Alias de nombres de campaña: cuando Meta tiene más de un nombre histórico para
  // "la misma" campaña de negocio (duplicados, tests, campañas viejas reemplazadas),
  // se fusionan bajo un mismo nombre de exhibición en la tabla de campañas.
  // Formato: 'nombre real en Meta' -> 'nombre a mostrar en el dashboard'
  // Dejar vacío {} hace que cada campaña se muestre con su nombre real tal cual.
  CAMPAIGN_ALIASES: {
    // 'ANDY - CAMPAÑA VIEJA 2025 (duplicada)': 'ANDY - CAMPAÑA VIEJA 2025',
  },

  // Cuántos días de gasto reciente en Meta define "activa" cuando no tenemos el
  // effective_status directo (fallback; con fetch_meta_ads_meta.js ya no hace falta,
  // pero se deja como red de seguridad si esa llamada falla).
  ACTIVE_LOOKBACK_DAYS: 3,

  // Fecha desde la que hay datos diarios de gasto de Meta cargados
  META_SPEND_DATA_START: '2026-03-20',

  // Nombres de las 2 campañas de Google Ads que se muestran en la sección de referencia
  GOOGLE_CAMPAIGN_NAMES: [
    'Campaign TechoCompleto Publico General',
    'C MAX REN - TECHO COMPLETO',
  ],

  // --- Sincronización de audiencia "calidad baja" con Meta (reemplaza al N8N/Railway
  // que dejó de andar en marzo 2026) ---
  // "Calidad baja" en Kommo NO es una etiqueta: es la "razón" que se elige en el
  // desplegable del status "Otro" del embudo. Se marca "Comentarios basura" tanto si
  // el lead no contesta como si pregunta algo que no tiene nada que ver (aclarado por Andy).
  LOW_QUALITY_LOSS_REASONS: ['Comentarios basura'],
  // ID del público personalizado "PUBLICO CALIDAD BAJA" en Meta (Business Manager > Públicos).
  META_LOW_QUALITY_AUDIENCE_ID: '120243460682440717',

  // --- Público "calidad alta" (semilla para Lookalike) ---
  // Los leads que llegaron a la etapa "Venta" (stage_index 4, ganados) se suben a
  // este público todos los días, igual que el de calidad baja. Se usa como semilla
  // para el público similar (Lookalike) de Meta. ID se completa una vez creado el
  // público en Meta (ver sync_meta_audience.js).
  HIGH_QUALITY_STAGE_INDEX: 4,
  // ID del público personalizado "PUBLICO CALIDAD ALTA" en Meta, creado automáticamente
  // el 2026-08-05 vía createHighQualityAudienceIfNeeded() en sync_meta_audience.js.
  META_HIGH_QUALITY_AUDIENCE_ID: '120251517172690717',
  // ID del público Lookalike generado a partir del de calidad alta. Se completa una
  // vez creado (evita que se cree uno nuevo cada día).
  // Creado automáticamente el 2026-08-05 vía createLookalikeIfNeeded() en
  // sync_meta_audience.js (1% Argentina, semilla: PUBLICO CALIDAD ALTA).
  META_LOOKALIKE_AUDIENCE_ID: '120251517960320717',
};
