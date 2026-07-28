// basic-auth.js -- Netlify Edge Function
// Pide usuario y contrasena (HTTP Basic Auth) antes de mostrar el dashboard.
// Las credenciales NO estan en este archivo: se leen de las variables de
// entorno del sitio en Netlify (DASH_USER y DASH_PASS), configuradas en
// Site configuration -> Environment variables. Ver README.
//
// Si esas dos variables no estan configuradas todavia, esta funcion deja
// pasar a cualquiera (no rompe el sitio mientras se termina de configurar).
export default async (request, context) => {
const validUser = Netlify.env.get('DASH_USER');
const validPass = Netlify.env.get('DASH_PASS');
if (!validUser || !validPass) {
return context.next();
}
const authHeader = request.headers.get('authorization') || '';
const parts = authHeader.split(' ');
const scheme = parts[0];
const encoded = parts[1];
if (scheme === 'Basic' && encoded) {
try {
const decoded = atob(encoded);
const sepIndex = decoded.indexOf(':');
const user = decoded.slice(0, sepIndex);
const pass = decoded.slice(sepIndex + 1);
if (user === validUser && pass === validPass) {
return context.next();
}
} catch (e) {
// header mal formado, sigue abajo y pide credenciales de nuevo
}
}
return new Response('Autenticacion requerida.', {
status: 401,
headers: { 'WWW-Authenticate': 'Basic realm="Dashboard Emporio de la Chapa"' },
});
};
export const config = { path: '/*' };
