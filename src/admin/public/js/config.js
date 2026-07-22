// Backend API base URL. Every fetch in this admin panel (via AdminAuth.
// authFetch / PlatformAuth.authFetch, plus the handful of pre-login raw
// fetches in auth.js/platform-auth.js/platform-login.js/register.js)
// prepends this to its request path.
//
// Leave EMPTY ('') when this static folder is served by the same origin as
// the API — Railway serving both together (the default, unchanged setup),
// or local dev via `npm run dev`. Relative paths already work correctly in
// that case; nothing to configure.
//
// Set this to your Railway backend's full URL (e.g.
// 'https://your-app.up.railway.app', no trailing slash) ONLY if you're
// deploying this src/admin/public folder to a different origin, such as
// Vercel — the browser needs an absolute URL to reach a different domain,
// and the Railway backend needs a matching ALLOWED_ORIGIN env var (see
// .env.example) so its CORS policy accepts requests from that origin.
const API_BASE_URL = '';
