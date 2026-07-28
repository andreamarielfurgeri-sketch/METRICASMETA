# Dashboard ROI Meta Ads x Kommo — auto-actualizable

Este repo genera solo, todos los días a las 6am (hora Argentina), el dashboard de
ROI de "El Gran Emporio de la Chapa" y lo publica en GitHub Pages. También incluye
un panel para pausar/activar anuncios de Meta desde el dashboard.

No hay que pedirle nada a Claude para que se actualice: una vez configurado,
funciona solo. Solo hace falta tocarlo si aparece una campaña/anuncio con un
nombre raro que conviene "fusionar" con otro (ver `scripts/config.js`).

## Qué hace cada parte

- **GitHub Actions** (`.github/workflows/update-dashboard.yml`): todos los días
  trae los leads de Kommo, el gasto de Meta/Google Ads (vía Windsor.ai) y el
  estado real de campañas/anuncios (vía la API de Meta), arma `docs/index.html`
  y lo commitea. Esto es 100% gratis en un repo público.
- **GitHub Pages**: sirve `docs/index.html` como página web pública. Se
  actualiza sola cada vez que el Action anterior hace un commit.
- **Cloudflare Worker** (`cloudflare-worker/worker.js`): un servidor chiquito y
  gratis que es el único lugar que tiene permiso para *pausar o activar* un
  anuncio de verdad en Meta. El dashboard le habla a este worker, nunca a Meta
  directamente, para no exponer un token con permiso de edición en una página
  pública.

## Paso 1 — Crear el repo en GitHub

1. Andá a github.com → **New repository**. Nombre sugerido: `dashboard-emporio-chapa`.
   Dejalo **público** (privado no permite GitHub Pages gratis).
2. Subí el contenido de esta carpeta al repo (podés arrastrar los archivos desde
   la web de GitHub, o con git desde tu computadora).

## Paso 2 — Conseguir los 5 secrets y cargarlos en GitHub

En el repo: **Settings → Secrets and variables → Actions → New repository secret**.
Cargá estos 5, uno por uno (el valor lo pega quien tiene acceso a cada cuenta —
por seguridad, esto no lo hago yo, lo tenés que pegar vos o quien administre
cada cuenta):

| Secret | De dónde sale |
|---|---|
| `KOMMO_SUBDOMAIN` | La parte de tu URL de Kommo antes de ".kommo.com" (ej. si es `emporiodelachapa.kommo.com`, el valor es `emporiodelachapa`) |
| `KOMMO_TOKEN` | Kommo → Ajustes → Integraciones → Crear integración (nombre cualquiera, no hace falta URL de redirect) → guardar → pestaña **Claves y alcances** → **Generar token de larga duración** → elegí la expiración más larga (5 años) → copiá el token. Necesitás ser administrador de la cuenta de Kommo. |
| `WINDSOR_API_KEY` | Entrá a https://onboard.windsor.ai con la cuenta que ya tiene conectado Meta Ads y Google Ads, y copiá la API key desde ahí. |
| `META_SYSTEM_USER_TOKEN` | Meta Business Manager → Configuración del negocio → Usuarios → **Usuarios del sistema** → crear uno nuevo (o usar uno existente) → asignale la cuenta publicitaria de "El Gran Emporio de la Chapa" con permiso de **Control total** → **Generar token nuevo** → elegí la app, marcá los permisos `ads_read` y `ads_management`, expiración **Nunca** → copiá el token. Este mismo token se usa después también en el Worker (paso 4). |
| `META_AD_ACCOUNT_ID` | El ID de cuenta publicitaria con el prefijo `act_`, ej. `act_279997342813751` (lo ves en la URL del Administrador de anuncios). |

## Paso 3 — Activar GitHub Pages

**Settings → Pages** → en "Build and deployment", Source: **Deploy from a
branch** → Branch: **main**, carpeta **/docs** → Save.

Después de unos minutos, GitHub te va a mostrar la URL pública (algo como
`https://tu-usuario.github.io/dashboard-emporio-chapa/`). Esa es la URL del
dashboard.

## Paso 4 — Probar el refresh de datos

**Actions → Actualizar dashboard → Run workflow** (botón a la derecha) → Run.
Tarda 1-3 minutos. Si todo salió bien, `docs/index.html` se actualiza solo y en
unos minutos más se ve reflejado en la URL de Pages. Si falla, el log del
Action te va a decir cuál de los 5 secrets está mal.

Una vez probado, no hay que tocar nada más: el cron corre solo todos los días
a las 6am (hora Argentina).

## Paso 4b — Si preferís Netlify en vez de GitHub Pages

El repo también sirve tal cual para Netlify (conectado directo al repo de
GitHub, deploy automático en cada commit). Configuración necesaria en Netlify:

- **Project configuration → Build & deploy → Continuous deployment →
  Configure**: dejar "Build command" vacío y poner "Publish directory" en
  `docs`. Sin esto Netlify busca `index.html` en la raíz del repo y no lo
  encuentra (da 404).

### Usuario y contraseña para el dashboard (gratis)

Netlify trae protección por contraseña incorporada, pero solo en el plan Pro
(u$s20/mes). Como alternativa gratis, el repo incluye una Netlify Edge
Function (`netlify/edge-functions/basic-auth.js`) que pide usuario y
contraseña antes de mostrar cualquier página del sitio.

Para activarla:

1. En Netlify: **Project configuration → Environment variables → Add a
   variable**.
2. Agregá `DASH_USER` (el usuario que van a tipear) y `DASH_PASS` (la
   contraseña).
3. Volvé a desplegar el sitio (Deploys → Trigger deploy → Deploy site), o
   esperá al próximo commit automático del dashboard.

Mientras esas dos variables no estén cargadas, el sitio queda abierto sin
pedir nada (para no romperlo mientras se configura). Si en algún momento
querés sacar la protección, borrá esas dos variables en Netlify.

## Paso 5 — Panel de pausar/activar anuncios (Cloudflare Worker)

Esto es opcional pero ya viene armado si lo querés activar:

1. Creá una cuenta gratis en https://dash.cloudflare.com si no tenés.
2. Instalá Wrangler (la herramienta de línea de comandos de Cloudflare) y
   logueate: `npm install -g wrangler` y después `wrangler login`.
3. Desde la carpeta `cloudflare-worker/`:
   ```
   wrangler secret put META_SYSTEM_USER_TOKEN
   ```
   (pegá el mismo token del paso 2, el que tiene `ads_management`)
   ```
   wrangler secret put PANEL_PIN
   ```
   (elegí un PIN cualquiera, ej. `8451` — es lo que vas a tipear en el
   dashboard para poder pausar/activar)
4. `wrangler deploy` → te va a dar una URL tipo
   `https://emporio-chapa-ad-toggle.tu-usuario.workers.dev`.
5. Entrá al dashboard publicado, bajá hasta "Control de anuncios", pegá esa
   URL en "URL del panel" y el PIN que elegiste, tocá "Guardar en este
   navegador". Listo — los botones Pausar/Activar de esa tabla ya funcionan de
   verdad sobre Meta Ads Manager.

**Importante sobre seguridad:** la URL del Worker y el PIN quedan guardados
solo en tu navegador (localStorage), nunca en el archivo del dashboard. Igual,
como el dashboard es una página pública, cualquiera que abra el "código
fuente" de la página no va a ver ningún token (el token de Meta vive solo
adentro de Cloudflare). Lo único sensible es la combinación URL+PIN del
Worker: no la compartas fuera del equipo, y si alguna vez sospechás que se
filtró, cambiá el PIN con `wrangler secret put PANEL_PIN` (no hace falta tocar
nada más).

## Cuándo hay que tocar algo a mano

- **Aparece una campaña o anuncio nuevo con nombre raro/duplicado que
  conviene mostrar fusionado con otro** (como pasó antes con "nombre_campaña"
  o campañas viejas duplicadas): agregá una línea en `CAMPAIGN_ALIASES` dentro
  de `scripts/config.js`.
- **Hay que excluir un lead de prueba puntual**: agregá su ID a
  `EXCLUDE_LEAD_IDS` en `scripts/config.js`.
- **Cambia el umbral de "precio anómalo"**: `MIN_VALID_AMOUNT` /
  `MAX_VALID_AMOUNT` en `scripts/config.js`.
- **El token de Kommo o de Meta vence o se revoca**: volvés a generar uno
  nuevo (pasos de arriba) y actualizás el secret en GitHub (y en Cloudflare si
  es el de Meta).

Fuera de esos casos puntuales, el dashboard se mantiene y actualiza solo.

## Estructura del repo

```
docs/
  template.html       # HTML/CSS/JS fijo del dashboard (no tiene datos)
  index.html          # se regenera solo cada día — esto es lo que sirve GitHub Pages
scripts/
  config.js           # la única "configuración de negocio" que a veces hay que tocar a mano
  fetch_kommo.js       # trae los leads de Kommo
  fetch_windsor.js      # trae gasto diario de Meta y Google Ads (Windsor.ai)
  fetch_meta_ads_meta.js # trae estado real (activo/pausado) y campaña de cada anuncio, directo de Meta
  build_dashboard.js    # combina todo y genera docs/index.html
.github/workflows/
  update-dashboard.yml # el cron diario
cloudflare-worker/
  worker.js            # backend chiquito que pausa/activa anuncios de verdad
  wrangler.toml
netlify/edge-functions/
  basic-auth.js        # pide usuario/contraseña si se publica con Netlify (opcional, gratis)
netlify.toml           # le dice a Netlify dónde está la edge function
```
