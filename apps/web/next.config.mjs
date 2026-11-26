export default {
  output: "export",
  devIndicators: false,
  reactStrictMode: true,
  experimental: { cpus: 2 },
  // Replit serves the preview through a shared proxy on a *.replit.dev host,
  // so the dev server must accept that origin for its dev-only resources
  // (otherwise the HMR socket is blocked and the browser logs a 502).
  allowedDevOrigins: [
    "*.replit.dev",
    "*.riker.replit.dev",
    "*.repl.co",
    "127.0.0.1",
    "localhost",
  ],
};
