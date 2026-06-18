import * as Sentry from "@sentry/node";

// Error tracking — DORMANT until SENTRY_DSN is set, so this is safe to ship with
// no effect until you create a (free) Sentry project and add the DSN env var.
// Imported FIRST in index.ts so Sentry can instrument the app on startup.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1, // light performance sampling
  });
  console.log("Sentry: error tracking ENABLED");
} else {
  console.log("Sentry: disabled (set SENTRY_DSN to enable error alerts)");
}
