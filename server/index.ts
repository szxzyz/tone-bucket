// Must be the first dependency so .env is available to db/auth modules.
import './env';

import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes, settleExpiredAdContest } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { ensureDatabaseSchema } from "./migrate";
import { countryBlockingMiddleware } from "./countryBlocking";

// ─── PROXY SETUP (for Telegram API access on restricted networks) ───────────
const TELEGRAM_PROXY = process.env.TELEGRAM_PROXY_URL || process.env.HTTPS_PROXY || '';
if (TELEGRAM_PROXY) {
  try {
    // @ts-ignore - undici types are not installed; runtime proxy wiring only
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    const dispatcher = new ProxyAgent({ uri: TELEGRAM_PROXY });
    setGlobalDispatcher(dispatcher);
    console.log(`✅ Proxy configured for all outgoing requests: ${TELEGRAM_PROXY}`);
  } catch (e) {
    console.log('⚠️ Failed to configure proxy:', e);
  }
}

console.log('🚀 Starting server...');

// Do not await database migration before opening the HTTP port. Render marks
// the deploy unhealthy when no port is listening while managed PostgreSQL is
// slow or unavailable. Migration starts after the server is listening below.
console.log('✅ Starting server setup; database migration will run in background...');

const app = express();
// Compress every response (API JSON + static assets) — was previously
// unset, so every payload went over the wire uncompressed.
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Country blocking middleware — must be early to block requests before any other processing
app.use(countryBlockingMiddleware);

// Emergency referral fix endpoint - SECURED for production
app.post('/api/emergency-fix-referrals', async (req: any, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Emergency endpoint disabled in production for security'
      });
    }
    console.log('🚨 EMERGENCY: Running referral data repair...');
    const { storage } = await import('./storage');
    await storage.fixExistingReferralData();
    await storage.ensureAllUsersHaveReferralCodes();
    console.log('✅ Emergency referral repair completed successfully!');
    res.json({ success: true, message: 'Emergency referral data repair completed successfully!' });
  } catch (error) {
    console.error('❌ Error in emergency referral repair:', error);
    res.status(500).json({
      success: false,
      message: 'Emergency repair failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test endpoint
app.get('/api/test-direct', (req: any, res) => {
  res.json({ status: 'Direct API route working!', timestamp: new Date().toISOString() });
});

// Dynamic TON Connect manifest. The manifest `url` must be the real HTTPS web
// app origin; a t.me Mini App deep link is not a valid TON Connect app URL.
app.get('/tonconnect-manifest.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const configuredUrl = (
    process.env.TELEGRAM_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.WEBAPP_URL ||
    ''
  ).trim().replace(/\/+$/, '');
  let appUrl = configuredUrl || `https://${req.get('host') || ''}`;
  if (!appUrl) {
    return res.status(503).json({ error: 'Public HTTPS app URL is not configured' });
  }

  // Ensure protocol is present for wallet compatibility and normalize the URL
  // to its origin so path/query values cannot produce invalid manifest links.
  if (!/^https?:\/\//i.test(appUrl)) appUrl = `https://${appUrl}`;
  let appOrigin: string;
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== 'https:') {
      return res.status(503).json({ error: 'TON Connect requires an HTTPS app URL' });
    }
    appOrigin = parsed.origin;
  } catch {
    return res.status(503).json({ error: 'Invalid public app URL configuration' });
  }

  res.json({
    url: appOrigin,
    name: "Axionet",
    iconUrl: `${appOrigin}/assets/axionet-mining.webp`,
    termsOfUseUrl: `${appOrigin}/terms`,
    privacyPolicyUrl: `${appOrigin}/privacy`
  });
});

// Webhook status endpoint
app.get('/api/telegram/webhook/status', async (req: any, res) => {
  try {
    const { checkBotStatus, getWebhookInfo } = await import('./telegram');
    const botStatus = await checkBotStatus();
    const webhookInfo = await getWebhookInfo();
    res.json({ bot: botStatus, webhook: webhookInfo, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check webhook status',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    try {
      capturedJsonResponse = bodyJson;
    } catch {
      // Ignore JSON capture errors
    }
    return originalResJson.apply(this, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    try {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          const responseStr = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${responseStr}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }
        log(logLine);
      }
    } catch {
      // Ignore logging errors
    }
  });

  next();
});

(async () => {
  await setupAuth(app);
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  let port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  if (isNaN(port) || port <= 0 || port >= 65536) {
    console.error(`Invalid port: ${process.env.PORT}, using default 5000`);
    port = 5000;
  }

  server.listen({ port, host: "0.0.0.0", reusePort: true }, async () => {
    log(`serving on port ${port}`);

    // Keep Render startup responsive while the schema is being prepared.
    void ensureDatabaseSchema()
      .then(() => console.log('✅ Background database migration completed'))
      .catch((error) => console.error('❌ Background database migration failed:', error));

    // ── Non-blocking background tasks ──────────────────────────────────────
    // Run these AFTER the server is listening so they never delay startup.

    // Ensure admin user exists (non-critical, background)
    setImmediate(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.ensureAdminUserExists();
      } catch (err) {
        console.log('⚠️ ensureAdminUserExists:', err instanceof Error ? err.message : err);
      }
    });

    // Referral data repair (heavy background task)
    setImmediate(async () => {
      try {
        const { storage } = await import('./storage');
        const repairStats = await storage.fullReferralRepair();
        if (repairStats.referralsCreated > 0 || repairStats.referralsActivated > 0) {
          console.log(`✅ Referral repair — created:${repairStats.referralsCreated} activated:${repairStats.referralsActivated}`);
        }
      } catch (bgErr) {
        console.log('⚠️ Background referral repair error:', bgErr);
      }
    });

    // Daily reset interval — check immediately on startup then every 5 minutes
    (async () => {
      try {
        const { storage } = await import('./storage');
        await storage.checkAndPerformDailyResetV2();
      } catch (error) {
        console.error('❌ Error in startup daily reset check:', error);
      }
    })();
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        await storage.checkAndPerformDailyResetV2();
      } catch (error) {
        console.error('❌ Error in daily reset check:', error);
      }
    }, 5 * 60 * 1000);

    // Expired promo code cleanup — every promo code auto-expires 24h after creation;
    // this sweeps expired codes (and their usage rows) out of the database so the
    // table doesn't grow unbounded. Runs immediately on boot, then every 10 minutes.
    (async () => {
      try {
        const { storage } = await import('./storage');
        const deleted = await storage.deleteExpiredPromoCodes();
        if (deleted > 0) console.log(`🗑️ [Promo Cleanup] Removed ${deleted} expired promo code(s) on startup`);
      } catch (error) {
        console.error('❌ Error in startup promo code cleanup:', error);
      }
    })();
    setInterval(async () => {
      try {
        const { storage } = await import('./storage');
        const deleted = await storage.deleteExpiredPromoCodes();
        if (deleted > 0) console.log(`🗑️ [Promo Cleanup] Removed ${deleted} expired promo code(s)`);
      } catch (error) {
        console.error('❌ Error in promo code cleanup:', error);
      }
    }, 10 * 60 * 1000);

    // Ad Watch Contest settlement and Telegram snapshot — runs every 5 minutes.
    // Prize crediting is idempotent and does not require an admin reset click.
    const settleContest = async () => {
      try { await settleExpiredAdContest(); } catch (error) { console.error('❌ Error settling Ad Watch Contest:', error); }
    };
    void settleContest();
    setInterval(settleContest, 5 * 60 * 1000);
    // Contest snapshot check — runs every 5 minutes, auto-sends results when period ends
    setInterval(async () => {
      try {
        const { checkAndSendContestSnapshots } = await import('./telegram');
        await checkAndSendContestSnapshots();
      } catch (error) {
        console.error('❌ Error in contest snapshot check:', error);
      }
    }, 5 * 60 * 1000);

    // Ambassador auto-scheduler — checks every minute for due posts
    try {
      const { startAmbassadorScheduler } = await import('./telegram');
      startAmbassadorScheduler();
    } catch (error) {
      console.error('❌ Error starting ambassador scheduler:', error);
    }

    // Database backup scheduler — daily automatic backup at 03:00 UTC, last 7 kept
    try {
      const { startBackupScheduler } = await import('./backup');
      startBackupScheduler();
    } catch (error) {
      console.error('❌ Error starting backup scheduler:', error);
    }

    // TON pending deposit poller — retries unconfirmed deposits every 2 minutes
    try {
      const { startTonDepositPoller } = await import('./telegram');
      startTonDepositPoller();
    } catch (error) {
      console.error('❌ Error starting TON deposit poller:', error);
    }

    // Channel penalty poller — checks membership every 5 minutes
    try {
      const { startChannelPenaltyPoller } = await import('./telegram');
      startChannelPenaltyPoller();
    } catch (error) {
      console.error('❌ Error starting channel penalty poller:', error);
    }

    // Automatic task reminder — notifies users with unfinished tasks once per day
    try {
      const { startTaskReminderScheduler } = await import('./telegram');
      startTaskReminderScheduler();
    } catch (error) {
      console.error('❌ Error starting task reminder scheduler:', error);
    }

    // Auto-setup Telegram webhook
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const { setupTelegramWebhook, getWebhookInfo } = await import('./telegram');

        const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0]?.trim();
        const domain = process.env.RENDER_EXTERNAL_URL?.replace(/^https?:\/\//, '') ||
                      replitDomains ||
                      process.env.REPLIT_DOMAIN ||
                      process.env.REPLIT_DEV_DOMAIN ||
                      (process.env.REPL_SLUG ? `${process.env.REPL_SLUG}.replit.app` : null);

        if (!domain) {
          log('❌ No webhook domain configured - set RENDER_EXTERNAL_URL or REPLIT_DOMAINS');
        } else {
          const webhookUrl = `https://${domain}/api/telegram/webhook`;
          log(`🔧 Setting up Telegram webhook: ${webhookUrl}`);

          const success = await setupTelegramWebhook(webhookUrl);
          if (success) {
            log('✅ Telegram bot is active and ready to receive messages');
          } else {
            log('❌ Failed to configure Telegram webhook - retrying in 10s');
            setTimeout(async () => {
              const retrySuccess = await setupTelegramWebhook(webhookUrl);
              if (retrySuccess) log('✅ Webhook configured on retry');
            }, 10000);
          }

          // Health check every 5 minutes
          setInterval(async () => {
            try {
              const webhookInfo = await getWebhookInfo();
              if (webhookInfo.error || !webhookInfo.url) {
                log('⚠️ Webhook connection lost, reconnecting...');
                await setupTelegramWebhook(webhookUrl);
              }
            } catch {
              // Non-fatal
            }
          }, 5 * 60 * 1000);
        }
      } catch (error) {
        log('❌ Error setting up Telegram webhook:', String(error));
      }
    } else {
      log('⚠️ TELEGRAM_BOT_TOKEN not set - bot functionality disabled');
    }
  });
})();
