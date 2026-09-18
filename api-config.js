// Production uses the custom API domain. Local development uses `wrangler dev`.
const isLocalHost = [
  "localhost",
  "127.0.0.1",
  "::1",
].includes(window.location.hostname);
window.SPLITO_API_URL = isLocalHost
  ? "http://localhost:8787"
  : "https://api.squarelab.in";
