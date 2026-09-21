import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from 'ws';
import { alias } from "drizzle-orm/pg-core";
import {
  insertEarningSchema,
  users,
  earnings,
  referrals,
  referralCommissions,
  withdrawals,
  userBalances,
  dailyTasks,
  promoCodes,
  promoCodeUsage,
  transactions,
  adminSettings,
  advertiserTasks,
  taskClicks,
  channelPenaltyCases,
  spinData,
  spinHistory,
  dailyMissions,
  missionAdClaims,
  adSessions,
  adsgramRewardCallbacks,
  adminRoles,
  ambassadorApplications,
  ambassadors,
  ambassadorEarnings,
  banLogs,
  promotions,
  promotionClaims,
  taskStatuses,
  dailyTaskCompletions,
  taskCompletions,
  insertPromotionSchema,
  type TaskStatus,
} from "../shared/schema";
import { db } from "./db";
import { eq, sql, desc, and, gte, inArray } from "drizzle-orm";
import crypto from "crypto";
import { sendTelegramMessage, sendUserTelegramNotification, sendWelcomeMessage, handleTelegramMessage, setupTelegramWebhook, verifyChannelMembership, checkBotCanPostToChannel, sendSharePhotoToChat, withdrawalAdminMessages, sendWithdrawalRequestToAdmins } from "./telegram";
import { authenticateTelegram, requireAuth } from "./auth";
import { validateDeviceAndDetectDuplicate } from "./deviceTracking";
import {
  requireVerifiedSession,
  requireStrictAuth,
  securityLog,
  authRateLimit,
  adWatchRateLimit,
  withdrawRateLimit,
  walletMutationRateLimit,
  taskRateLimit,
} from "./securityMiddleware";
import { isAuthenticated } from "./replitAuth";
import { computeRiskScore, analyzeAdBehavior, checkRateLimit, checkKnownBotSignature } from "./fraudDetection";
import { config, getChannelConfig, getAppConfig } from "./config";
import { createBackup, listBackups, deleteBackup, restoreBackup, getBackupPath } from "./backup";
import { getResetPeriodKey, getPeriodStart, getNextResetTime } from "./resetPeriod";

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const MINING_DURATION_SECONDS = 60 * 60;
const MINING_BASE_RATE_PER_HOUR = 23.9574;
const MINING_BOOSTS = [1, 2, 4, 8, 10, 15, 20, 25] as const;

// Store WebSocket connections for real-time updates
// Map: sessionId -> { socket: WebSocket, userId: string }
const connectedUsers = new Map<string, { socket: WebSocket; userId: string }>();

// ── Avatar proxy in-memory cache ─────────────────────────────────────────────
// Each un-cached request hits Telegram API twice (getChat → getFile → download).
// Cache the image bytes server-side for 1 hour so every subsequent request for
// the same channel avatar is served instantly without touching Telegram at all.
const _avatarCache = new Map<string, { buf: Buffer; contentType: string; at: number }>();
const AVATAR_TTL = 60 * 60 * 1000; // 1 hour

// Negative cache: a username with no photo, or a failed Telegram lookup,
// would otherwise be re-fetched (with no timeout) on every single page load —
// this was the main cause of the Missions page feeling slow. Short TTL so a
// photo added later still appears reasonably promptly.
const _avatarNegativeCache = new Map<string, { at: number }>();
const AVATAR_NEGATIVE_TTL = 5 * 60 * 1000; // 5 minutes

// In-flight request map: coalesces concurrent lookups for the same username
// (e.g. several tasks pointing at the same channel rendered on the page at
// once) into a single Telegram round-trip instead of one per task.
const _avatarInFlight = new Map<string, Promise<{ buf: Buffer; contentType: string } | null>>();

const AVATAR_TG_TIMEOUT = 6_000; // 6s per external call — fail fast instead of hanging the request.

// ── Path 1: official Bot API (getChat → getFile → download) ─────────────────
// Works for public CHANNELS and GROUPS/SUPERGROUPS, whose photo the Bot API
// exposes directly. It does NOT work for BOTS: the Bot API's getChat only
// resolves chats the bot itself is part of (or public channels/supergroups),
// and returns "Bad Request: chat not found" for an arbitrary *other* bot's
// username — there is no Bot API method for one bot to read another bot's
// profile. That gap is the reason bot avatars were never loading.
async function fetchAvatarViaBotApi(username: string, botToken: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const chatRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent('@' + username)}`,
    { signal: AbortSignal.timeout(AVATAR_TG_TIMEOUT) }
  );
  const chatData = await chatRes.json();
  if (!chatData.ok) {
    console.warn(`⚠️ [avatar] getChat failed for @${username}: ${chatData?.description || chatRes.status}`);
    return null;
  }
  const fileId = chatData?.result?.photo?.small_file_id;
  if (!fileId) {
    console.warn(`⚠️ [avatar] @${username} has no chat photo set via Bot API`);
    return null;
  }

  const fileRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
    { signal: AbortSignal.timeout(AVATAR_TG_TIMEOUT) }
  );
  const fileData = await fileRes.json();
  const filePath = fileData?.result?.file_path;
  if (!fileData.ok || !filePath) {
    console.warn(`⚠️ [avatar] getFile failed for @${username}: ${fileData?.description || fileRes.status}`);
    return null;
  }

  const imgRes = await fetch(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
    { signal: AbortSignal.timeout(AVATAR_TG_TIMEOUT) }
  );
  if (!imgRes.ok || !imgRes.body) {
    console.warn(`⚠️ [avatar] file download failed for @${username}: HTTP ${imgRes.status}`);
    return null;
  }

  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return { buf, contentType };
}

// ── Path 2: public t.me preview page (og:image) ──────────────────────────────
// Telegram renders a public, unauthenticated preview page at t.me/<username>
// for every CHANNEL, GROUP *and* BOT, and stamps the entity's real profile
// photo into the <meta property="og:image"> tag when one is set. This works
// uniformly across all three entity types (including bots, where Path 1 is
// impossible), so it's used as the fallback whenever the Bot API can't help.
async function fetchAvatarViaOgImage(username: string): Promise<{ buf: Buffer; contentType: string } | null> {
  const pageRes = await fetch(`https://t.me/${encodeURIComponent(username)}`, {
    signal: AbortSignal.timeout(AVATAR_TG_TIMEOUT),
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot-AvatarFetch/1.0)' },
  });
  if (!pageRes.ok) {
    console.warn(`⚠️ [avatar] t.me preview page failed for @${username}: HTTP ${pageRes.status}`);
    return null;
  }
  const html = await pageRes.text();
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  const imageUrl = match?.[1];
  // Telegram omits the og:image tag entirely when the entity has no photo, so
  // a missing match means "genuinely no avatar" rather than a fetch failure.
  if (!imageUrl) {
    console.warn(`⚠️ [avatar] @${username} has no og:image on its t.me preview page`);
    return null;
  }

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(AVATAR_TG_TIMEOUT) });
  if (!imgRes.ok || !imgRes.body) {
    console.warn(`⚠️ [avatar] og:image download failed for @${username}: HTTP ${imgRes.status}`);
    return null;
  }
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return { buf, contentType };
}

// ── Bot username cache ────────────────────────────────────────────────────────
// getBotUsername() makes a live Telegram Bot API call. Cache it for 5 minutes
// so the /api/auth/user endpoint (called every 30 s by every active user)
// doesn't hammer the Telegram API.
let _cachedBotUsername: string | null = null;
let _botUsernameFetchedAt = 0;
async function getCachedBotUsername(): Promise<string> {
  const now = Date.now();
  if (_cachedBotUsername !== null && now - _botUsernameFetchedAt < 5 * 60 * 1000) {
    return _cachedBotUsername;
  }
  try {
    const { getBotUsername } = await import('./telegram');
    const username = await getBotUsername();
    _cachedBotUsername = username || '';
    _botUsernameFetchedAt = now;
    return _cachedBotUsername;
  } catch {
    return _cachedBotUsername ?? '';
  }
}

// ── Anti-Fake Ad Session Store ────────────────────────────────────────────────
// Session pending/used state now lives in the `ad_sessions` DB table (see
// shared/schema.ts) instead of an in-memory Map — this is required for the
// background/resume verification and duplicate-reward protection to work
// correctly in production, where the server may run as multiple instances
// or get restarted (e.g. deploys, PM2 respawns). An in-memory Map would lose
// all pending/used session state on every restart, silently reopening the
// replay window and rejecting in-flight ad sessions.
// Cooldown and abuse-score are still in-memory: losing them on a restart
// only means a brief window with weaker rate-limiting, not a reward/security
// bypass, so the added complexity of persisting them isn't worth it here.
const adUserCooldowns   = new Map<string, number>();  // userId     → lastRewardAt (ms)
const AD_REWARD_COOLDOWN_MS = 15_000;  // 15 s minimum between rewards (was 5 s — increased to prevent rapid replay)
const MIN_PROVIDER_SESSION_MS = 3_000; // Non-AdsGram providers need a server-measured watch window
// How long a pending ad_sessions row is honored before it's considered stale/abandoned.
const AD_SESSION_MAX_AGE_MS = 15 * 60_000; // 15 minutes
// No hard cap on per-ad reward — the admin-configured value is always used as-is.

// Prune stale cooldown entries every 15 minutes to prevent unbounded memory growth.
setInterval(() => {
  const cutoff1h  = Date.now() - 60 * 60 * 1000;
  // Remove cooldown entries older than 1 hour (user hasn't watched an ad in a while)
  for (const [uid, ts] of adUserCooldowns) if (ts < cutoff1h) adUserCooldowns.delete(uid);
}, 15 * 60 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

// Function to verify session token against PostgreSQL sessions table
async function verifySessionToken(sessionToken: string): Promise<{ isValid: boolean; userId?: string }> {
  try {
    const { pool } = await import('./db');

    // Query the sessions table to find the session
    const result = await pool.query(
      'SELECT sess, expire FROM sessions WHERE sid = $1',
      [sessionToken]
    );

    if (result.rows.length === 0) {
      console.log('❌ Session not found in database:', sessionToken);
      return { isValid: false };
    }

    const sessionRow = result.rows[0];
    const sessionData = sessionRow.sess;
    const expireTime = new Date(sessionRow.expire);

    // Check if session has expired
    if (expireTime <= new Date()) {
      console.log('❌ Session expired:', sessionToken);
      return { isValid: false };
    }

    // Extract user information from session data
    // Session data structure from connect-pg-simple typically contains passport user data
    let userId: string | undefined;

    if (sessionData && typeof sessionData === 'object') {
      // Try different possible session data structures
      if (sessionData.user && sessionData.user.user && sessionData.user.user.id) {
        // Structure: { user: { user: { id: "uuid", ... } } }
        userId = sessionData.user.user.id;
      } else if (sessionData.user && sessionData.user.id) {
        // Structure: { user: { id: "uuid", ... } }
        userId = sessionData.user.id;
      } else if (sessionData.passport && sessionData.passport.user) {
        // Structure: { passport: { user: "userId" } }
        userId = sessionData.passport.user;
      }
    }

    if (!userId) {
      console.log('❌ No user ID found in session data:', sessionToken);
      return { isValid: false };
    }

    console.log(`✅ Session verified for user: ${userId}`);
    return { isValid: true, userId };

  } catch (error) {
    console.error('❌ Session verification error:', error);
    return { isValid: false };
  }
}

// Helper function to send real-time updates to a user
function sendRealtimeUpdate(userId: string, update: any) {
  let messagesSent = 0;

  // Find ALL sessions for this user and send to each one
  for (const [sessionId, connection] of connectedUsers.entries()) {
    if (connection.userId === userId && connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
        console.log(`📤 Sent update to user ${userId}, session ${sessionId}`);
      } catch (error) {
        console.error(`❌ Failed to send update to user ${userId}, session ${sessionId}:`, error);
        // Remove dead connection
        connectedUsers.delete(sessionId);
      }
    }
  }

  console.log(`📊 Sent real-time update to ${messagesSent} sessions for user ${userId}`);
  return messagesSent > 0;
}

// Broadcast update to all connected users
function broadcastUpdate(update: any) {
  let messagesSent = 0;
  connectedUsers.forEach((connection, sessionId) => {
    if (connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
      } catch (error) {
        console.error(`❌ Failed to broadcast to session ${sessionId}:`, error);
        connectedUsers.delete(sessionId);
      }
    }
  });
  console.log(`📡 Broadcast sent to ${messagesSent} connected sessions`);
  return messagesSent;
}


// Super admin check — TELEGRAM_ADMIN_ID or SUPER_ADMIN_ID env var (the one true master admin)
const isSuperAdmin = (telegramId: string): boolean => {
  const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();
  if (!superAdminId) return false;
  return telegramId.toString() === superAdminId;
};

// Check if user is admin — super admin first, then sub-admins from TELEGRAM_ADMIN_IDS
const isAdmin = (telegramId: string): boolean => {
  // Super admin always has access
  if (isSuperAdmin(telegramId)) return true;
  // Sub-admins added by super admin (TELEGRAM_ADMIN_IDS is a separate pool)
  const subAdminIds = (process.env.TELEGRAM_ADMIN_IDS || '').trim();
  if (!subAdminIds) {
    if (!process.env.TELEGRAM_ADMIN_ID && !process.env.SUPER_ADMIN_ID) {
      console.warn('⚠️ TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID not set - admin access disabled');
    }
    return false;
  }
  const ids = subAdminIds.split(',').map(id => id.trim()).filter(Boolean);
  return ids.includes(telegramId.toString());
};

// Admin authentication middleware with optional signature verification
const authenticateAdmin = async (req: any, res: any, next: any) => {
  try {
    // ── 1. Session-first: if the request carries a valid server session,
    //       use it to identify the user and verify admin status via DB.
    //       This is the primary path in production (no bot token needed).
    const sessionUserId =
      req.session?.user?.user?.id ||
      req.user?.user?.id;

    if (sessionUserId) {
      try {
        const sessionUser = await storage.getUser(sessionUserId);
        if (sessionUser?.telegram_id) {
          const tid = sessionUser.telegram_id;
          const adminOk = isAdmin(tid) || await isAdminAsync(tid);
          if (adminOk) {
            console.log(`✅ Admin authenticated via session (telegram_id: ${tid})`);
            req.user = {
              telegramUser: {
                id: parseInt(tid) || tid,
                username: sessionUser.username || '',
                first_name: (sessionUser as any).firstName || (sessionUser as any).first_name || '',
              }
            };
            return next();
          }
        }
      } catch { /* fall through to other methods */ }
    }

    const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // ── 2. Development mode shortcut (only when TELEGRAM_BOT_TOKEN is not configured).
    //       Once a bot token is set the admin panel requires real Telegram auth, even
    //       in development, so this bypass never fires in production deployments.
    if (process.env.NODE_ENV === 'development' && !process.env.TELEGRAM_BOT_TOKEN && !telegramData && process.env.DEV_ADMIN_ID) {
      const devAdminId = process.env.DEV_ADMIN_ID.trim();
      console.log('🔧 Dev mode (no bot token): granting admin access');
      req.user = { telegramUser: { id: devAdminId, username: 'testuser', first_name: 'Test', last_name: 'Admin' } };
      return next();
    }

    if (!telegramData) {
      return res.status(401).json({ message: 'Admin access denied — no authentication data' });
    }

    // ── 3. Verified signature (when bot token is available)
    if (botToken) {
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: verifiedUser } = verifyTelegramWebAppData(telegramData, botToken);
      if (isValid && verifiedUser) {
        const tid = verifiedUser.id.toString();
        const adminOk = isAdmin(tid) || !!(await db.select().from(adminRoles).where(eq(adminRoles.telegramId, tid)).limit(1))[0];
        if (!adminOk) {
          console.log(`❌ Verified user ${tid} is not admin`);
          return res.status(403).json({ message: 'Admin access required' });
        }
        console.log(`✅ Admin authenticated via verified signature: ${tid}`);
        req.user = { telegramUser: verifiedUser };
        return next();
      }
      console.log('⚠️ Signature verification failed, falling through to bypass');
    }

    // ── 4. Unverified bypass: parse telegram_id from raw initData, check DB
    try {
      const urlParams = new URLSearchParams(telegramData);
      const userString = urlParams.get('user');
      if (userString) {
        const telegramUser = JSON.parse(userString);
        const tid = telegramUser.id?.toString();
        if (tid) {
          const adminOk = isAdmin(tid) || !!(await db.select().from(adminRoles).where(eq(adminRoles.telegramId, tid)).limit(1))[0];
          if (adminOk) {
            console.log(`✅ Admin authenticated via bypass (telegram_id: ${tid})`);
            req.user = { telegramUser };
            return next();
          }
        }
      }
    } catch (e) {
      console.error('Error in admin bypass parse:', e);
    }

    console.log('❌ Admin auth failed: no valid credentials');
    return res.status(403).json({ message: 'Admin access required' });

  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(401).json({ message: 'Authentication failed' });
  }
};

// Authentication middleware has been moved to server/auth.ts for better organization

// All permissions available in the system
const ALL_PERMISSIONS = [
  'view_stats',
  'manage_users',
  'manage_withdrawals',
  'manage_tasks',
  'manage_settings',
  'manage_promos',
  'manage_admins',
  'manage_bans',
];

const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_PERMISSIONS,
  finance: ['view_stats', 'manage_withdrawals'],
  moderator: ['view_stats', 'manage_users', 'manage_bans'],
  content: ['view_stats', 'manage_tasks'],
};

// Get the role + permissions for an admin telegram ID
// TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID always gets super_admin with ALL permissions
// TELEGRAM_ADMIN_IDS sub-admins get their DB-assigned role (or moderator by default)
// Check admin status including DB-added admins (async version used in API routes)
async function isAdminAsync(telegramId: string): Promise<boolean> {
  if (!telegramId) return false;
  if (isAdmin(telegramId)) return true;
  // Check DB-added admins
  try {
    const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
    return !!record;
  } catch { return false; }
}

async function getAdminRole(telegramId: string): Promise<{ role: string; permissions: string[]; name: string } | null> {
  if (!telegramId) return null;

  // Super admin always gets full super_admin role regardless of DB
  if (isSuperAdmin(telegramId)) {
    try {
      const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
      return { role: 'super_admin', permissions: ALL_PERMISSIONS, name: record?.name || 'Super Admin' };
    } catch { /* ignore */ }
    return { role: 'super_admin', permissions: ALL_PERMISSIONS, name: 'Super Admin' };
  }

  // Always check DB for assigned role/permissions (covers both env sub-admins and DB-added admins)
  try {
    const [record] = await db.select().from(adminRoles).where(eq(adminRoles.telegramId, telegramId)).limit(1);
    if (record) {
      let perms: string[] = [];
      try { perms = JSON.parse(record.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[record.role] || []; }
      return { role: record.role, permissions: perms, name: record.name || 'Admin' };
    }
  } catch { /* no DB record */ }

  // Env-listed sub-admin with no DB record — default to moderator
  if (isAdmin(telegramId)) {
    return { role: 'moderator', permissions: ROLE_DEFAULT_PERMISSIONS['moderator'] || [], name: 'Admin' };
  }

  return null;
}

// Returns deduplicated Telegram IDs of all admins (super admin + env sub-admins + DB-added admins)
async function getAllAdminTelegramIds(): Promise<string[]> {
  const ids = new Set<string>();
  const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();
  if (superAdminId) ids.add(superAdminId);
  const envSubAdmins = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  envSubAdmins.forEach(id => ids.add(id));
  try {
    const dbRecords = await db.select({ telegramId: adminRoles.telegramId }).from(adminRoles);
    dbRecords.forEach(r => { if (r.telegramId) ids.add(r.telegramId); });
  } catch { /* DB unavailable — fall back to env-only */ }
  return Array.from(ids);
}

export async function registerRoutes(app: Express): Promise<Server> {
  console.log('🔧 Registering API routes...');

  // Create HTTP server first
  const httpServer = createServer(app);

  // Set up WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Helper function to broadcast to all connected clients
  const broadcastToAll = (message: object) => {
    const messageStr = JSON.stringify(message);
    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  };

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('🔌 New WebSocket connection established');
    let sessionId: string | null = null;

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Handle different message types
        if (data.type === 'auth') {
          if (!data.sessionToken) {
            console.log('❌ Missing sessionToken in auth message');
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Missing sessionToken. Expected format: {"type": "auth", "sessionToken": "<token>"}'
            }));
            return;
          }

          // Verify session token securely
          try {
            // In development mode ONLY, allow test user authentication
            if (process.env.NODE_ENV === 'development' && data.sessionToken === 'test-session') {
              const testUserId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
              sessionId = `session_${Date.now()}_${Math.random()}`;
              connectedUsers.set(sessionId, { socket: ws, userId: testUserId });
              console.log(`👤 Test user connected via WebSocket: ${testUserId}`);

              ws.send(JSON.stringify({
                type: 'connected',
                message: 'Real-time updates enabled! 🚀'
              }));
              return;
            }

            // Production mode: Verify session token against PostgreSQL sessions table
            const { isValid, userId } = await verifySessionToken(data.sessionToken);

            if (!isValid || !userId) {
              console.log(`❌ WebSocket authentication failed for token: ${data.sessionToken}`);
              ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid or expired session. Please refresh the page and try again.'
              }));
              return;
            }

            // Session verified successfully - establish WebSocket connection
            sessionId = `session_${Date.now()}_${Math.random()}`;
            connectedUsers.set(sessionId, { socket: ws, userId });
            console.log(`👤 User ${userId} connected via WebSocket (verified session)`);

            ws.send(JSON.stringify({
              type: 'connected',
              message: 'Real-time updates enabled! 🚀',
              userId: userId
            }));
          } catch (authError) {
            console.error('❌ WebSocket auth error:', authError);
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Authentication failed'
            }));
          }
        } else if (data.type === 'ping') {
          // Handle ping messages
          ws.send(JSON.stringify({ type: 'pong' }));
        } else {
          // Handle invalid message types
          console.log(`❌ Invalid WebSocket message type: ${data.type || 'undefined'}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Invalid message type. Expected "auth" but received "${data.type || 'undefined'}". Format: {"type": "auth", "sessionToken": "<token>"}`
          }));
        }
      } catch (error) {
        console.error('❌ WebSocket message parsing error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON format. Expected: {"type": "auth", "sessionToken": "<token>"}'
        }));
      }
    });

    ws.on('close', () => {
      // Remove session from connected list
      if (sessionId) {
        const connection = connectedUsers.get(sessionId);
        if (connection) {
          connectedUsers.delete(sessionId);
          console.log(`👋 User ${connection.userId} disconnected from WebSocket`);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  });

  // Simple test route to verify routing works
  app.get('/api/test', (req: any, res) => {
    console.log('✅ Test route called!');
    res.json({ status: 'API routes working!', timestamp: new Date().toISOString() });
  });

  // Production health check endpoint - checks database connectivity and user count
  app.get('/api/health', async (req: any, res) => {
    try {
      const dbCheck = await db.select({ count: sql<number>`count(*)` }).from(users);
      const userCount = dbCheck[0]?.count || 0;

      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
        NODE_ENV: process.env.NODE_ENV || 'unknown'
      };

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          userCount
        },
        environment: envCheck,
        websockets: {
          activeConnections: connectedUsers.size
        }
      });
    } catch (error) {
      console.error('❌ Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: error instanceof Error ? error.message : String(error)
        },
        environment: {
          DATABASE_URL: !!process.env.DATABASE_URL,
          NODE_ENV: process.env.NODE_ENV || 'unknown'
        }
      });
    }
  });


  // ── Cloudflare Turnstile — disabled app-wide ────────────────────────────────
  // The /api/turnstile/status, /api/turnstile/verify, and /api/turnstile/invalidate
  // endpoints, and the Siteverify-calling body of checkActionTurnstile(), were
  // removed. They fail-closed (blocked the request) whenever TURNSTILE_SECRET
  // wasn't set or Cloudflare's challenge failed — which was the root cause of
  // withdrawals repeatedly 403'ing, the client retrying, and that retry storm
  // tripping the withdrawal rate limiter's 600s cooldown. checkActionTurnstile
  // is kept as a no-op so the reward-bearing endpoints below don't need to be
  // rewired one by one.
  async function checkActionTurnstile(_req: any, _res: any, _action: string): Promise<boolean> {
    return true;
  }

  // Get channel configuration for frontend
  app.get('/api/config/channel', (req: any, res) => {
    res.json(getChannelConfig());
  });

  // Get full system configuration for the frontend. Keep this response
  // revalidated so Telegram WebViews do not keep an old/missing ad ID after a
  // deployment or environment update.
  app.get('/api/config/app', (req: any, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(getAppConfig());
  });

  // Public Home-page statistics. This intentionally mirrors the admin KPI
  // definitions while keeping admin authentication and sensitive fields out
  // of the response.
  app.get('/api/public/statistics', async (_req: any, res) => {
    try {
      const adminPeriodStart = getAdminPeriodStart().toISOString();
      const results = await Promise.allSettled([
        db.select({ count: sql<number>`count(*)` }).from(users),
        db.select({ total: sql<string>`COALESCE(SUM(${users.totalEarned}), '0')` }).from(users),
        db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`),
        db.select({ count: sql<number>`count(distinct ${earnings.userId})` }).from(earnings).where(sql`${earnings.createdAt} >= ${adminPeriodStart}::timestamptz`),
        db.select({ count: sql<number>`count(*)` }).from(advertiserTasks),
        db.select({ count: sql<number>`count(*)` }).from(transactions).where(eq(transactions.source, 'task_creation')),
        db.select({ count: sql<number>`count(*)` }).from(taskCompletions),
        db.select({ count: sql<number>`count(*)` }).from(dailyTaskCompletions).where(eq(dailyTaskCompletions.completed, true)),
        db.select({ count: sql<number>`count(*)` }).from(promotionClaims),
        db.select({ count: sql<number>`count(*)` }).from(earnings).where(inArray(earnings.source, [
          'task_completion', 'daily_task_completion', 'task_share', 'task_channel', 'task_community',
          'gigapub_short_link', 'mission_check_for_updates', 'mission_daily_checkin',
          'mission_share_referral', 'mission_share_story', 'mission_ad',
        ])),
      ]);
      const resultAt = <T,>(index: number, fallback: T): T => results[index].status === 'fulfilled' ? results[index].value as T : fallback;
      const totalUsers = resultAt(0, [{ count: 0 }]);
      const totalEarned = resultAt(1, [{ total: '0' }]);
      const totalWithdrawn = resultAt(2, [{ total: '0' }]);
      const activeToday = resultAt(3, [{ count: 0 }]);
      const tasksCreated = resultAt(4, [{ count: 0 }]);
      const taskCreationHistory = resultAt(5, [{ count: 0 }]);
      const taskCompletionsCount = resultAt(6, [{ count: 0 }]);
      const dailyTaskCompletionsCount = resultAt(7, [{ count: 0 }]);
      const promotionClaimsCount = resultAt(8, [{ count: 0 }]);
      const taskEarningsCount = resultAt(9, [{ count: 0 }]);
      const completionRecords = Number(taskCompletionsCount[0]?.count || 0) + Number(dailyTaskCompletionsCount[0]?.count || 0) + Number(promotionClaimsCount[0]?.count || 0);
      res.set('Cache-Control', 'no-store');
      res.json({
        totalUsers: Number(totalUsers[0]?.count || 0),
        activeToday: Number(activeToday[0]?.count || 0),
        goldEarned: totalEarned[0]?.total || '0',
        totalWithdrawal: totalWithdrawn[0]?.total || '0',
        taskCreated: Math.max(Number(tasksCreated[0]?.count || 0), Number(taskCreationHistory[0]?.count || 0)),
        // Earnings is the canonical all-user completion ledger. The table
        // counts remain as a compatibility fallback for older deployments.
        taskCompleted: Math.max(completionRecords, Number(taskEarningsCount[0]?.count || 0)),
      });
    } catch (error) {
      console.error('Error fetching public statistics:', error);
      res.status(500).json({ message: 'Failed to fetch statistics' });
    }
  });

  // Mandatory app access verification. Telegram must be able to look up the
  // configured official channel and community group; payout is not required.

  // Telegram can briefly omit initData while a Mini App is being restored after
  // the user returns from a channel/group. Reuse the already-authenticated
  // session in that case, while retaining initData authentication for fresh
  // launches.
  const authenticateTelegramOrSession = (req: any, res: any, next: any) => {
    if (req.session?.user?.user) {
      req.user = req.session.user;
      return next();
    }
    return authenticateTelegram(req, res, next);
  };

  app.get('/api/telegram/join-status', authenticateTelegramOrSession, async (req: any, res) => {
    res.set('Cache-Control', 'no-store');
    const required = process.env.REQUIRE_CHANNEL_JOIN !== 'false';
    const configuredResources = [
      { key: 'channel' as const, title: config.telegram.channelName || 'Official Channel', link: config.telegram.channelUrl, id: config.telegram.channelId },
      { key: 'group' as const, title: config.telegram.groupName || 'Community group', link: config.telegram.groupUrl, id: config.telegram.groupId },
    ].map((resource) => {
      // Some deployments configure only TELEGRAM_*_LINK. Convert public t.me
      // links into a Telegram username so membership verification still works.
      // Numeric IDs remain preferred, especially for private groups/channels.
      let id = resource.id?.trim() || '';
      if (!id && resource.link?.trim()) {
        const match = resource.link.trim().match(/^https?:\/\/t\.me\/([^/?#]+)/i);
        if (match && !match[1].startsWith('+') && !match[1].startsWith('joinchat')) {
          id = `@${match[1].replace(/^@/, '')}`;
        }
      }
      return { ...resource, id };
    }).filter((resource) => Boolean(resource.id || resource.link?.trim()));

    // A missing optional resource must not be reported as "not joined" forever.
    // Only resources with a Telegram chat ID can be checked by getChatMember.
    if (!required || configuredResources.length === 0) {
      return res.json({
        required: false,
        verified: true,
        resources: configuredResources.map(({ key, title, link }) => ({ key, title, link, joined: true })),
      });
    }

    try {
      // authenticateTelegram can populate either the verified Telegram payload or
      // the database user, depending on whether the request used initData or a
      // previously-created session. Support both shapes so launch-time checks do
      // not depend on one authentication path.
      const telegramId = Number(
        req.user?.telegramUser?.id ||
        req.user?.user?.telegram_id ||
        req.session?.user?.telegramUser?.id ||
        req.session?.user?.user?.telegram_id,
      );
      const botToken = config.bot.token || process.env.TELEGRAM_BOT_TOKEN;
      if (!Number.isFinite(telegramId) || !botToken) {
        return res.json({
          required: true,
          verified: false,
          resources: configuredResources.map(({ key, title, link }) => ({ key, title, link, joined: false })),
        });
      }

      const results = await Promise.all(configuredResources.map(async (resource) => {
        // Private invite links cannot be resolved to a chat ID from the URL.
        // Keep them visible in the gate, but report them as unverified until a
        // numeric TELEGRAM_*_ID is configured for server-side verification.
        const joined = resource.id
          ? await verifyChannelMembership(telegramId, resource.id, botToken)
          : false;
        return { key: resource.key, title: resource.title, link: resource.link, joined };
      }));

      return res.json({ required: true, verified: results.every((resource) => resource.joined), resources: results });
    } catch (error) {
      console.error('Error checking mandatory Telegram resources:', error);
      return res.json({
        required: true,
        verified: false,
        resources: configuredResources.map(({ key, title, link }) => ({ key, title, link, joined: false })),
      });
    }
  });

  // Secure check-membership endpoint for initial app load
  // Simplified check-membership endpoint (only ban checks)
  app.get('/api/check-membership', async (req: any, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.json({ success: true, isVerified: true });

      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      if (!telegramData) return res.json({ success: true, isVerified: true });

      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(telegramData, botToken);
      if (!isValid || !telegramUser?.id) return res.json({ success: true, isVerified: true });

      const user = await storage.getUserByTelegramId(telegramUser.id.toString());
      if (user?.banned) {
        return res.json({ success: true, banned: true, reason: user.bannedReason, isVerified: true });
      }
      res.json({ success: true, isVerified: true });
    } catch (error) {
      res.json({ success: true, isVerified: true });
    }
  });

  // Legacy endpoint for compatibility - always returns verified
  app.get('/api/membership/check', async (req: any, res) => {
    res.json({ success: true, isVerified: true });
  });

  // Update user language preference
  app.post('/api/user/language', authenticateTelegram, async (req: any, res) => {
    try {
      const { language } = req.body;
      const validLanguages = ['en', 'ru', 'ar', 'uk', 'de', 'zh', 'pt', 'es', 'vi', 'bn'];
      if (!language || !validLanguages.includes(language)) {
        return res.status(400).json({ success: false, message: 'Invalid language' });
      }
      const telegramUser = req.telegramUser;
      if (telegramUser?.id) {
        const dbUser = await storage.getUserByTelegramId(telegramUser.id.toString());
        if (dbUser) {
          await storage.updateUserLanguage(dbUser.id, language);
        }
      }
      res.json({ success: true, language });
    } catch (error) {
      res.json({ success: true }); // Non-critical, don't fail
    }
  });

  // Debug route to check database columns
  app.get('/api/debug/db-schema', authenticateAdmin, async (req: any, res) => {
    try {
      const { pool } = await import('./db');

      // Check what columns exist in users table
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'users'
        ORDER BY ordinal_position;
      `);

      res.json({
        success: true,
        columns: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Schema check failed:', error);
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  });

  // Removed deprecated manual database setup - use proper Drizzle migrations instead

  // Removed deprecated schema fix routes - use Drizzle migrations instead

  // Telegram Bot Webhook endpoint - MUST be first to avoid Vite catch-all interference
  app.post('/api/telegram/webhook', async (req: any, res) => {
    try {
      const update = req.body;
      console.log('📨 Received Telegram update:', JSON.stringify(update, null, 2));

      // Verify the request is from Telegram (optional but recommended)
      // You can add signature verification here if needed

      const handled = await handleTelegramMessage(update);
      console.log('✅ Message handled:', handled);

      if (handled) {
        res.status(200).json({ ok: true });
      } else {
        res.status(200).json({ ok: true, message: 'No action taken' });
      }
    } catch (error) {
      console.error('❌ Telegram webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Function to verify Telegram WebApp initData with HMAC-SHA256
  function verifyTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: any } {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');

      if (!hash) {
        return { isValid: false };
      }

      // Remove hash from params for verification
      urlParams.delete('hash');

      // Sort parameters and create data check string
      const sortedParams = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

      // Create secret key from bot token
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

      // Calculate expected hash
      const expectedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');

      // Verify hash
      const isValid = expectedHash === hash;

      if (isValid) {
        const userString = urlParams.get('user');
        if (userString) {
          try {
            const user = JSON.parse(userString);
            return { isValid: true, user };
          } catch (parseError) {
            console.error('Error parsing user data:', parseError);
            return { isValid: false };
          }
        }
      }

      return { isValid };
    } catch (error) {
      console.error('Error verifying Telegram data:', error);
      return { isValid: false };
    }
  }

  // New Telegram WebApp authentication route
  app.post('/api/auth/telegram', authRateLimit, async (req: any, res) => {
    try {
      const { initData, startParam } = req.body;
      const clientIp = (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.headers['x-real-ip']) || req.socket?.remoteAddress || 'unknown';

      // ── Known-bot signature — hard block before anything else ────────────
      // This route (unlike authenticateTelegram in auth.ts) is the actual
      // entry point confirmed automation scripts hit first. It previously
      // didn't inspect device headers at all, so a known-signature request
      // sailed through here with a 200 regardless of what auth.ts checked.
      {
        const rawDeviceId = req.headers['x-device-id'] as string | undefined;
        const rawFingerprint = req.headers['x-device-fingerprint'] as string | undefined;
        let fingerprint: any = null;
        try {
          fingerprint = rawFingerprint ? JSON.parse(rawFingerprint) : null;
        } catch {
          fingerprint = null;
        }
        const knownBot = checkKnownBotSignature(rawDeviceId, fingerprint);
        if (knownBot.isKnownBot) {
          console.log(`🚫 Blocked at /api/auth/telegram — known bot signature: ${knownBot.label} (deviceId=${rawDeviceId}) ip=${clientIp}`);
          setImmediate(async () => {
            try {
              await db.execute(sql`
                UPDATE users SET
                  banned = true,
                  banned_reason = ${`Known bot signature: ${knownBot.label}`},
                  banned_at = NOW(),
                  suspicion_score = 100,
                  flagged = true,
                  flag_reason = 'Known bot signature match (auth entry block)',
                  updated_at = NOW()
                WHERE device_id = ${rawDeviceId}
              `);
            } catch (e) {
              console.error('⚠️ Failed to ban known-bot device on auth entry:', e);
            }
          });
          return res.status(403).json({
            banned: true,
            message: "Your account has been banned due to suspicious multi-account activity",
            reason: "Automated access detected",
          });
        }
      }

      const refererUrl = req.headers['referer'] || req.headers['referrer'] || '';
      console.log(`🔐 Auth request received - initData: ${initData ? 'YES' : 'NO'}, startParam: ${startParam || 'NONE'}, referer: ${refererUrl}`);

      // Telegram can expose the deep-link payload in the request body, initData
      // (`start_param`), or the browser/referrer URL depending on how the Mini App
      // was opened. Normalize all supported forms before processing attribution.
      const normalizeStartParam = (value: unknown): string | undefined => {
        if (typeof value !== 'string') return undefined;
        let normalized = value.trim();
        if (!normalized) return undefined;
        try { normalized = decodeURIComponent(normalized); } catch { /* keep raw value */ }
        const embedded = normalized.match(/(?:^|[?&])(?:startapp|tgWebAppStartParam|start_param)=([^&#]+)/i);
        return (embedded?.[1] || normalized).trim() || undefined;
      };

      let effectiveStartParam = normalizeStartParam(startParam);
      if (!effectiveStartParam && initData) {
        try {
          const initParams = new URLSearchParams(initData);
          effectiveStartParam = normalizeStartParam(initParams.get('start_param'));
          if (effectiveStartParam) {
            console.log(`📎 Extracted start_param from Telegram initData: ${effectiveStartParam}`);
          }
        } catch (e) {
          console.warn('⚠️ Could not parse Telegram initData for start_param:', e);
        }
      }
      if (!effectiveStartParam && refererUrl) {
        try {
          const refUrl = new URL(refererUrl);
          effectiveStartParam = normalizeStartParam(
            refUrl.searchParams.get('startapp') ||
            refUrl.searchParams.get('tgWebAppStartParam') ||
            refUrl.searchParams.get('start_param')
          );
          if (effectiveStartParam) {
            console.log(`📎 Extracted startParam from referer URL: ${effectiveStartParam}`);
          }
        } catch (e) {}
      }

      if (!initData) {
        // ── SECURITY: x-user-id header bypass removed ──────────────────────
        // Previously this endpoint accepted an x-user-id header and returned
        // success without any authentication.  That allowed attackers to impersonate
        // any user by supplying an arbitrary UUID header.  Removed.
        //
        // If the session already contains an authenticated user, allow the call
        // to succeed as a lightweight session-existence check.
        if (req.session?.user?.user?.id) {
          const sessionUserId = req.session.user.user.id;
          console.log(`🔄 Auth check — valid session for user ${sessionUserId} ip=${clientIp}`);
          return res.json({ success: true, user: sessionUserId, referralProcessed: false });
        }

        console.log(`⚠️ Auth request without initData and no session ip=${clientIp}`);
        return res.status(401).json({
          success: false,
          message: 'Authentication required. Please open this app from Telegram.',
          telegram_required: true,
          error_code: 'NO_INIT_DATA',
        });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ message: 'Bot token not configured' });
      }

      // Verify the initData with HMAC-SHA256
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);

      if (!isValid || !telegramUser) {
        return res.status(401).json({ message: 'Invalid Telegram authentication data' });
      }

      // Apply the same-device policy before upserting a Telegram account. A
      // shared IP alone is not enough evidence (Wi-Fi, hotspots and mobile
      // carriers commonly share IPs), so device identity remains the hard
      // signal and IP is retained only as supporting telemetry.
      const rawDeviceId = req.headers['x-device-id'] as string | undefined;
      const rawFingerprint = req.headers['x-device-fingerprint'] as string | undefined;
      let deviceFingerprint: any = null;
      try { deviceFingerprint = rawFingerprint ? JSON.parse(rawFingerprint) : null; } catch { deviceFingerprint = null; }
      if (rawDeviceId || clientIp !== 'unknown') {
        const duplicate = await validateDeviceAndDetectDuplicate(telegramUser.id.toString(), {
          deviceId: rawDeviceId || `ip_${clientIp}`,
          fingerprint: deviceFingerprint,
          ip: clientIp,
          userAgent: req.headers['user-agent'] as string | undefined,
        });
        if (duplicate.redirectToPrimary && duplicate.primaryAccountId) {
          const [primaryUser] = await db.select().from(users).where(eq(users.id, duplicate.primaryAccountId)).limit(1);
          if (primaryUser && !primaryUser.banned) {
            return res.json({
              ...primaryUser,
              secondaryAccountBlocked: true,
              primaryAccountName: primaryUser.firstName || primaryUser.username || 'your primary account',
              primaryTelegramId: primaryUser.telegram_id,
              referralProcessed: false,
            });
          }
        }
      }

      // Use upsertTelegramUser method which properly handles telegram_id
      const { user: upsertedUser, isNewUser } = await storage.upsertTelegramUser(telegramUser.id.toString(), {
        email: `${telegramUser.username || telegramUser.id}@telegram.user`,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        profileImageUrl: (telegramUser as any).photo_url || '',
        personalCode: telegramUser.username || telegramUser.id.toString(),
        withdrawBalance: '0',
        totalEarnings: '0',
        adsWatched: 0,
        dailyAdsWatched: 0,
        dailyEarnings: '0',
        level: 1,
        flagged: false,
        banned: false,
        referralCode: '',
      });

      // Reject already-banned accounts — this route previously returned a
      // plain 200 with user data regardless of banned status.
      if (upsertedUser.banned) {
        console.log(`🚫 Banned user attempted /api/auth/telegram: ${upsertedUser.id} (Telegram: ${telegramUser.id})`);
        return res.status(403).json({
          banned: true,
          message: "Your account has been banned due to suspicious multi-account activity",
          reason: upsertedUser.bannedReason || "Account banned",
        });
      }

      // Attribute a user once when they have no existing referrer. This covers
      // Mini App launches where Telegram creates the user/session before the auth
      // request reaches this endpoint, while still preventing re-referral.
      let referralProcessed = false;
      const finalStartParam = normalizeStartParam(effectiveStartParam || startParam);

      // Send welcome message to new users — include referral code so the Open App button keeps it
      if (isNewUser) {
        try {
          await sendWelcomeMessage(telegramUser.id.toString(), finalStartParam || undefined);
        } catch (welcomeError) {
          console.error('Error sending welcome message:', welcomeError);
          // Don't fail authentication if welcome message fails
        }
      }
      const existingUserReferrer = (upsertedUser as any).referredBy ?? (upsertedUser as any).referred_by;
      if (finalStartParam && finalStartParam !== telegramUser.id.toString() && !existingUserReferrer) {
        console.log(`🔄 Processing Mini App referral: referralCode=${finalStartParam}, user=${telegramUser.id}, isNewUser=${isNewUser}`);
        try {
          // First, find the referrer by referral code
          const referrer = await storage.getUserByReferralCode(finalStartParam);

          if (!referrer) {
            console.log(`❌ Invalid referral code from Mini App: ${finalStartParam}`);
          } else if (referrer.id === upsertedUser.id) {
            console.log(`⚠️ Self-referral prevented: ${upsertedUser.id}`);
          } else {
            // CANONICAL CHECK: Use referrals table as source of truth to check if referral exists
            const existingReferral = await storage.getReferralByUsers(referrer.id, upsertedUser.id);

            if (existingReferral) {
              console.log(`ℹ️ Referral already exists in referrals table: ${referrer.id} -> ${upsertedUser.id}`);
            } else {
              console.log(`👤 Found referrer via Mini App: ${referrer.id} (${referrer.firstName || 'No name'})`);
              await storage.createReferral(referrer.id, upsertedUser.id);
              console.log(`✅ Referral created via Mini App: ${referrer.id} -> ${upsertedUser.id}`);
              referralProcessed = true;
            }
          }
        } catch (referralError) {
          console.error('❌ Mini App referral processing failed:', referralError);
          // Don't fail authentication if referral processing fails
        }
      }

      res.json({ ...upsertedUser, referralProcessed });
    } catch (error) {
      console.error('Telegram authentication error:', error);
      res.status(500).json({ message: 'Authentication failed' });
    }
  });

  // Session token endpoint for WebSocket authentication
  app.get('/api/auth/session-token', authenticateTelegram, async (req: any, res) => {
    try {
      let sessionToken: string;

      // Development mode: Return predictable test token
      if (process.env.NODE_ENV === 'development' || process.env.REPL_ID) {
        sessionToken = 'test-session';
        console.log('🔧 Development mode: Returning test session token');
      } else {
        // Production mode: Always use Express session ID
        if (!req.sessionID) {
          console.error('❌ No session ID found - session not created properly');
          return res.status(500).json({
            message: 'Session not established',
            error: 'Express session not found'
          });
        }

        sessionToken = req.sessionID;
        console.log('🔐 Production mode: Using Express session ID for WebSocket auth:', sessionToken);
      }

      res.json({
        sessionToken,
        message: 'Session token generated successfully'
      });
    } catch (error) {
      console.error('❌ Error generating session token:', error);
      res.status(500).json({
        message: 'Failed to generate session token',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Auth routes
  app.get('/api/auth/user', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id; // Use the database UUID, not Telegram ID
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Ensure referralCode exists
      if (!user.referralCode) {
        await storage.generateReferralCode(userId);
        const updatedUser = await storage.getUser(userId);
        user.referralCode = updatedUser?.referralCode || '';
      }

      // Ensure friendsInvited is properly calculated from COMPLETED referrals only
      // Pending referrals (where friend hasn't watched their first ad) don't count
      // Also exclude banned users from referral count
      const actualReferralsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .innerJoin(users, eq(referrals.refereeId, users.id))
        .where(and(
          eq(referrals.referrerId, userId),
          eq(referrals.status, 'completed'),
          eq(users.banned, false)
        ));

      const friendsInvited = actualReferralsCount[0]?.count || 0;

      // Update DB if count is different (sync)
      if (user.friendsInvited !== friendsInvited) {
        await db
          .update(users)
          .set({ friendsInvited: friendsInvited })
          .where(eq(users.id, userId));
      }

      // Add referral link - bot username cached to avoid hitting Telegram API on every request
      const botUsername = await getCachedBotUsername();
      const referralLink = `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`;
      const isAdminUser = await isAdminAsync(String(user.telegram_id || ''));

      res.json({
        ...user,
        friendsInvited,
        referralLink,
        isAdmin: isAdminUser,
        secondaryAccountBlocked: Boolean(req.user.secondaryAccountBlocked),
        primaryAccountName: req.user.primaryAccountName || undefined,
        primaryTelegramId: req.user.primaryTelegramId || undefined,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Balance refresh endpoint - used after conversion to sync frontend
  app.get('/api/user/balance/refresh', authenticateTelegram, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log('⚠️ Balance refresh requested without session - sending empty response');
        return res.json({
          success: true,
          skipAuth: true,
          balance: '0',
          tonBalance: '0'
        });
      }

      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      console.log(`🔄 Balance refresh for user ${userId}: Gems=${user.balance}, TON=${user.tonBalance}`);

      res.json({
        success: true,
        balance: user.balance,
        tonBalance: user.tonBalance,
        powBalance: user.balance
      });
    } catch (error) {
      console.error("Error refreshing balance:", error);
      res.status(500).json({ message: "Failed to refresh balance" });
    }
  });

  // Bot info endpoint - returns real bot username from Telegram API
  app.get('/api/bot-info', async (req: any, res) => {
    try {
      const { getBotUsername } = await import('./telegram');
      const username = await getBotUsername();
      res.json({ username: username || '' });
    } catch (error) {
      res.json({ username: '' });
    }
  });

  // Get current app settings (public endpoint for frontend to fetch ad limits and all dynamic settings)
  app.get('/api/app-settings', async (req: any, res) => {
    try {
      // Fetch all admin settings at once
      const allSettings = await db.select().from(adminSettings);

      // Helper function to get setting value with default
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = allSettings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };

      // Parse all settings with NEW defaults
      const dailyAdLimit = parseInt(getSetting('daily_ad_limit', '510'));
      const hourlyAdLimit = parseInt(getSetting('hourly_ad_limit', '63'));
      const rewardPerAd = parseInt(getSetting('reward_per_ad', '3000')); // Default 3000 Gems per ad
      const seasonBroadcastActive = getSetting('season_broadcast_active', 'false') === 'true';
      const affiliateCommission = parseFloat(getSetting('affiliate_commission', '10'));
      const walletChangeFeeGems = parseInt(getSetting('wallet_change_fee', '100')); // Default 100 Gems
      const minimumWithdrawalUSD = parseFloat(getSetting('minimum_withdrawal_usd', '1.00')); // Minimum USD withdrawal
      const minimumWithdrawalTON = parseFloat(getSetting('minimum_withdrawal_ton', '0.5')); // Minimum TON withdrawal
      const withdrawalFeeTON = parseFloat(getSetting('withdrawal_fee_ton', '5')); // TON withdrawal fee %
      const withdrawalFeeUSD = parseFloat(getSetting('withdrawal_fee_usd', '3')); // USD withdrawal fee %

      // Separate channel and bot task costs (in USD for admin, TON for users)
      const channelTaskCostUSD = parseFloat(getSetting('channel_task_cost_usd', '0.003')); // Default $0.003 per click
      const botTaskCostUSD = parseFloat(getSetting('bot_task_cost_usd', '0.003')); // Default $0.003 per click

      // TON costs for regular users
      const channelTaskCostTON = parseFloat(getSetting('channel_task_cost_ton', '0.0003')); // Default 0.0003 TON per click
      const botTaskCostTON = parseFloat(getSetting('bot_task_cost_ton', '0.0003')); // Default 0.0003 TON per click

      // Separate channel and bot task rewards (in Gems) — tiered by verification
      const channelTaskRewardGems = parseInt(getSetting('task_reward_no_verify', '100')); // Default 2000 Gems (no verify)
      const botTaskRewardGems = parseInt(getSetting('task_reward_no_verify', '100')); // Default 2000 Gems (no verify)
      const taskRewardWithVerify = parseInt(getSetting('task_reward_with_verify', '500')); // Default 500 Gold (with verify)

      // Currency conversion: 100,000 Gold = 1 USDT
      const configuredPadPerUsd = parseInt(getSetting('pad_per_usd', '100000'));
      const padPerUsd = [1000000, 10000000].includes(configuredPadPerUsd) ? 100000 : configuredPadPerUsd; // 100K Gold = 1 USDT; normalize legacy rates
      const minimumConvertGems = parseInt(getSetting('minimum_convert_pad', '100')); // Default 100 Gems
      const minimumConvertUSD = minimumConvertGems / padPerUsd; // Convert to USD

      // Minimum clicks for task creation
      const minimumClicks = parseInt(getSetting('minimum_clicks', '500')); // Default 500 clicks

      const withdrawalCurrency = getSetting('withdrawal_currency', 'TON');

      // Referral reward settings
      const referralRewardEnabled = getSetting('referral_reward_enabled', 'false') === 'true';
      const referralRewardUSD = parseFloat(getSetting('referral_reward_usd', '0.0005'));
      const referralRewardGems = parseInt(getSetting('referral_reward_pad', '2500'));
      const referralRewardGemsEnabled = getSetting('referral_reward_pad_enabled', 'true') === 'true';
      const referralRewardUSDEnabled = getSetting('referral_reward_usd_enabled', 'false') === 'true';
      const referralAdsRequired = 5; // Five Adsgram ads are required for affiliate bonus
      const l1CommissionPercent = parseFloat(getSetting('l1_commission_percent', '20')); // Level 1: 20%
      const l2CommissionPercent = parseFloat(getSetting('l2_commission_percent', '4')); // Level 2: 4%

      // Daily task rewards (for TaskSection.tsx)
      const streakReward = parseInt(getSetting('streak_reward', '100')); // Daily streak claim reward in Gems
      const shareTaskReward = parseInt(getSetting('share_task_reward', '1000')); // Share with friends reward in Gems
      const communityTaskReward = parseInt(getSetting('community_task_reward', '1000')); // Join community reward in Gems

      // Partner task reward (highest tier, always verified)
      const partnerTaskReward = parseInt(getSetting('partner_task_reward', '200')); // Partner task reward in Gems

      // Withdrawal requirement settings
      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const minimumAdsForWithdrawal = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      const withdrawalInviteRequirementEnabled = getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true';
      const minimumInvitesForWithdrawal = parseInt(getSetting('minimum_invites_for_withdrawal', '3'));
      const withdrawalTaskRequirementEnabled = getSetting('withdrawal_task_requirement_enabled', 'true') === 'true';
      const minimumTasksForWithdrawal = parseInt(getSetting('minimum_tasks_for_withdrawal', '10'));

      // BUG currency settings
      const minimumConvertPadToTon = parseInt(getSetting('minimum_convert_pad_to_ton', '10000'));
      const padToTonRate = parseInt(getSetting('pad_to_ton_rate', '10000000')); // 10M Gems = 1 TON
      const activePromoCode = getSetting('active_promo_code', ''); // Current active promo code

      // Per-provider ad limits and rewards
      const adsgramAdLimit        = parseInt(getSetting('adsgram_ad_limit',        '40'));
      const adsgramRewardPerAd    = parseInt(getSetting('adsgram_reward_per_ad',    '50'));
      const adsgramEnabled        = getSetting('adsgram_enabled', 'true') === 'true';
      const monetagAdLimit        = parseInt(getSetting('monetag_ad_limit',         '30'));
      const monetagRewardPerAd    = parseInt(getSetting('monetag_reward_per_ad',    '30'));
      const monetagEnabled        = getSetting('monetag_enabled', 'true') === 'true';
      const gigapubAdLimit        = parseInt(getSetting('gigapub_ad_limit',         '30'));
      const gigapubRewardPerAd    = parseInt(getSetting('gigapub_reward_per_ad',    '30'));
      const gigapubEnabled        = getSetting('gigapub_enabled', 'true') === 'true';
      const usladsAdLimit         = parseInt(getSetting('uslads_ad_limit',          '20'));
      const usladsRewardPerAd     = parseInt(getSetting('uslads_reward_per_ad',     '20'));
      const usladsEnabled         = getSetting('uslads_enabled', 'true') === 'true';

      // Legacy compatibility - keep old values for backwards compatibility
      const taskCostPerClick = channelTaskCostUSD; // Use channel cost as default
      const taskRewardPerClick = channelTaskRewardGems / 10000000; // Legacy TON format for compatibility
      const minimumWithdrawal = minimumWithdrawalTON; // Legacy field

      // Settings must be fresh immediately after an admin update. React Query
      // handles deduplication on the client, so do not let an old browser/proxy
      res.set('Cache-Control', 'no-store');
      res.json({
        dailyAdLimit,
        hourlyAdLimit,
        rewardPerAd,
        rewardPerAdGems: rewardPerAd,
        seasonBroadcastActive,
        affiliateCommission,
        affiliateCommissionPercent: affiliateCommission,
        walletChangeFee: walletChangeFeeGems,
        walletChangeFeeGems,
        minimumWithdrawal,
        minimumWithdrawalUSD,
        minimumCashoutGold: parseInt(getSetting('minimum_cashout_gold', '1000')),
        minimumWithdrawalTON,
        withdrawalFeeTON,
        withdrawalFeeUSD,
        channelTaskCostUSD,
        botTaskCostUSD,
        channelTaskCostTON,
        botTaskCostTON,
        channelTaskRewardGems,
        botTaskRewardGems,
        taskCostPerClick,
        taskRewardPerClick,
        taskRewardGems: channelTaskRewardGems, // Use channel reward as default
        minimumConvert: minimumConvertUSD,
        minimumConvertGems,
        minimumConvertUSD,
        minimumClicks,
        withdrawalCurrency,
        referralRewardEnabled,
        referralRewardUSD,
        referralRewardGems,
        referralRewardGemsEnabled,
        referralRewardUSDEnabled,
        referralAdsRequired,
        l1CommissionPercent,
        l2CommissionPercent,
        // Daily task rewards
        streakReward,
        shareTaskReward,
        communityTaskReward,
        partnerTaskReward,
        channelTaskReward: channelTaskRewardGems,
        botTaskReward: botTaskRewardGems,
        // Tiered task rewards used by the Missions page (bug: these were computed
        // above but never included in the response, so the client always fell back
        // to its hardcoded defaults regardless of what the admin configured)
        taskRewardNoVerify: channelTaskRewardGems,
        taskRewardWithVerify,
        // Withdrawal requirement settings
        withdrawalAdRequirementEnabled,
        minimumAdsForWithdrawal,
        withdrawalInviteRequirementEnabled,
        minimumInvitesForWithdrawal,
        withdrawalTaskRequirementEnabled,
        minimumTasksForWithdrawal,
        // BUG currency settings
        minimumConvertPadToTon,
        padToTonRate,
        activePromoCode,
        // Withdrawal packages (JSON array of {usd, bug} objects)
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]')),
        // Weekly giveaway
        weeklyGiveawayAmount: parseFloat(getSetting('weekly_giveaway_amount', '10')),
        // Mission page ad platform settings
        monetagMissionReward: parseInt(getSetting('monetag_mission_reward', '1000')),
        monetagMissionLimit: parseInt(getSetting('monetag_mission_limit', '25')),
        adexiumMissionReward: parseInt(getSetting('adexium_mission_reward', '1000')),
        adexiumMissionLimit: parseInt(getSetting('adexium_mission_limit', '25')),
        gigaPubMissionReward: parseInt(getSetting('giga_pub_mission_reward', '1000')),
        gigaPubMissionLimit: parseInt(getSetting('giga_pub_mission_limit', '25')),
        minimumWithdrawAmount: parseFloat(getSetting('minimumWithdrawAmount', '0.20')),
        maximumWithdrawAmount: parseFloat(getSetting('maximumWithdrawAmount', '0.50')),
        maxWithdrawalsPerDay: parseInt(getSetting('maxWithdrawalsPerDay', '1')),
        // Per-provider ad settings
        adsgramAdLimit,
        adsgramRewardPerAd,
        adsgramEnabled,
        monetagAdLimit,
        monetagRewardPerAd,
        monetagEnabled,
        gigapubAdLimit,
        gigapubRewardPerAd,
        gigapubEnabled,
        usladsAdLimit,
        usladsRewardPerAd,
        usladsEnabled,
        // Contest settings (public — needed by leaderboard/frontend)
        weeklyReferralContestEnabled: getSetting('weekly_referral_contest_enabled', 'false') === 'true',
        weeklyReferralStartDate: getSetting('weekly_referral_start_date', ''),
        weeklyReferralEndDate: getSetting('weekly_referral_end_date', ''),
        weeklyReferralTopUsers: 10,
        monthlyContestEnabled: getSetting('monthly_contest_enabled', 'false') === 'true',
        monthlyContestStartDate: getSetting('monthly_contest_start_date', ''),
        monthlyContestEndDate: getSetting('monthly_contest_end_date', ''),
        monthlyContestTopUsers: parseInt(getSetting('monthly_contest_top_users', '10')),
        monthlyContestPrizes: getSetting('monthly_contest_prizes', ''),
        starsPerAd: parseInt(getSetting('stars_per_ad', '1')),
      });
    } catch (error) {
      console.error("Error fetching app settings:", error);
      res.status(500).json({ message: "Failed to fetch app settings" });
    }
  });

   // ── Pre-register ad session with server-authoritative adType ─────────────────
  /** GET /api/ads/turnstile-status
   *  Returns { required: boolean } — whether the NEXT ad claim requires a fresh
   *  Turnstile token.  Based on backend-authoritative adsTurnstileCount vs threshold.
   */
  app.get('/api/ads/turnstile-status', authenticateTelegram, async (req: any, res) => {
    // Cloudflare Turnstile verification has been disabled app-wide — never
    // require the challenge for ad claims.
    return res.json({ required: false });
  });

  // Client calls this BEFORE showing any ad SDK. The server stores the adType so
  // the /api/ads/watch claim endpoint never trusts the client-supplied field.
  app.post('/api/ads/register-session', authenticateTelegram, adWatchRateLimit, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { sessionId, adType, context } = req.body as { sessionId?: string; adType?: string; context?: string };

      if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
        return res.status(400).json({ message: "Invalid session ID", errorType: 'invalid_session' });
      }

      const allowedContexts = ['ads_watch', 'mission_ad', 'daily_checkin', 'mystery_box'];
      const normalizedContext = allowedContexts.includes(context ?? '') ? (context as string) : 'ads_watch';
      const allowedAdTypes =
        normalizedContext === 'mission_ad' ? ['monetag', 'gigapub']
        : (normalizedContext === 'daily_checkin' || normalizedContext === 'mystery_box') ? ['adsgram', 'monetag']
        : ['adsgram', 'monetag', 'gigapub', 'uslads'];
      const normalizedAdType = allowedAdTypes.includes(adType ?? '') ? (adType as string) : null;
      if (!normalizedAdType) {
        return res.status(400).json({ message: "Invalid ad type", errorType: 'invalid_ad_type' });
      }

      try {
        await db.insert(adSessions).values({
          id: sessionId,
          userId,
          context: normalizedContext,
          adType: normalizedAdType,
          status: 'pending',
        });
      } catch (insertErr: any) {
        // Unique PK violation = sessionId already registered (fresh or previously used)
        return res.status(400).json({ message: "Session already in use", errorType: 'duplicate_session' });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('❌ register-session error:', err);
      return res.status(500).json({ message: 'Internal error' });
    }
  });

  // AdsGram server-side Reward URL callback.
  // Configure AdsGram with:
  // https://paidadz.xyz/api/adsgram/reward?userid=[userId]&token=YOUR_SECRET_KEY
  //
  // AdsGram documents userid as the guaranteed callback macro. Some dashboard
  // versions also expose a request/event id, so accept those names when
  // present; otherwise the recently registered AdsGram session is the
  // idempotency key.
  app.get('/api/adsgram/reward', async (req: any, res) => {
    const queryValue = (value: unknown): string | undefined => {
      if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
      return typeof value === 'string' ? value : undefined;
    };

    const token = queryValue(req.query?.token);
    const configuredToken = process.env.ADSGRAM_REWARD_SECRET?.trim();
    const tokenMatches = Boolean(
      configuredToken &&
      token &&
      token.length === configuredToken.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(configuredToken)),
    );
    if (!tokenMatches) {
      console.warn('⚠️ AdsGram reward callback rejected: invalid token');
      return res.status(403).send('Forbidden');
    }

    const telegramId = queryValue(req.query?.userid);
    if (!telegramId || !/^\d{5,20}$/.test(telegramId)) {
      console.warn('⚠️ AdsGram reward callback rejected: invalid userid');
      return res.status(400).send('Invalid userid');
    }

    try {
      const user = await storage.getUserByTelegramId(telegramId);
      if (!user) {
        console.warn(`⚠️ AdsGram reward callback: user ${telegramId} not found`);
        return res.status(404).send('User not found');
      }
      if (user.banned) {
        console.warn(`⚠️ AdsGram reward callback ignored for banned user ${telegramId}`);
        return res.status(403).send('Forbidden');
      }

      const callbackId =
        queryValue(req.query?.callback_id) ||
        queryValue(req.query?.callbackId) ||
        queryValue(req.query?.request_id) ||
        queryValue(req.query?.requestId) ||
        queryValue(req.query?.event_id) ||
        queryValue(req.query?.eventId) ||
        queryValue(req.query?.id);
      const callbackKeyFromId = callbackId ? `id:${callbackId}` : undefined;

      const [existingByCallback] = callbackKeyFromId
        ? await db.select().from(adsgramRewardCallbacks)
            .where(eq(adsgramRewardCallbacks.callbackKey, callbackKeyFromId))
            .limit(1)
        : [];
      if (existingByCallback) {
        console.info(`ℹ️ AdsGram duplicate callback acknowledged for user ${telegramId}`);
        return res.status(200).send('OK');
      }

      const now = Date.now();
      const recentCutoff = new Date(now - AD_SESSION_MAX_AGE_MS);
      const [recentSession] = await db.select().from(adSessions)
        .where(and(
          eq(adSessions.userId, user.id),
          eq(adSessions.context, 'ads_watch'),
          eq(adSessions.adType, 'adsgram'),
          gte(adSessions.registeredAt, recentCutoff),
        ))
        .orderBy(desc(adSessions.registeredAt))
        .limit(1);

      const [recentCallbackForSession] = recentSession
        ? await db.select().from(adsgramRewardCallbacks)
            .where(eq(adsgramRewardCallbacks.sessionId, recentSession.id))
            .limit(1)
        : [];
      if (recentCallbackForSession) {
        console.info(`ℹ️ AdsGram duplicate session callback acknowledged for user ${telegramId}`);
        return res.status(200).send('OK');
      }

      // If the client already claimed the session, the normal ad-watch flow
      // already credited the balance. A postback is confirmation only.
      if (recentSession?.status === 'used') {
        console.info(`ℹ️ AdsGram callback confirmed existing client claim for user ${telegramId}`);
        return res.status(200).send('OK');
      }

      // The callback must correlate to a server-registered AdsGram session.
      // AdsGram documents userid, but not a universally available event ID;
      // the session is therefore the fallback idempotency key and also
      // prevents a valid token from minting rewards for arbitrary users.
      if (!recentSession) {
        console.warn(`⚠️ AdsGram callback has no matching active session for user ${telegramId}`);
        return res.status(400).send('No active ad session');
      }

      // Do not let the server callback bypass the client-side lifecycle proof.
      // The client claim records backgroundEntered only after the Mini App has
      // returned from at least one minimize/background event. The callback can
      // arrive before that claim, so acknowledge it and let the verified client
      // claim perform the actual credit.
      console.info(`ℹ️ AdsGram callback awaiting verified client claim for user ${telegramId}`);
      return res.status(200).send('OK');
    } catch (error) {
      console.error('❌ AdsGram reward callback processing failed:', error);
      return res.status(500).send('Internal server error');
    }
  });

  // Ad watching endpoint - configurable daily limit and reward amount
  app.post('/api/ads/watch', authenticateTelegram, adWatchRateLimit, async (req: any, res) => {
    try {
      const userId = req.user.user.id;

      // ── Conditional Turnstile counter — disabled app-wide ──────────────────
      // This used to require a fresh Turnstile token after every N ads
      // (random threshold 5–10). Left in place but neutered: it no longer
      // blocks on a missing token, since Cloudflare verification has been
      // removed everywhere else in the app too.
      // ───────────────────────────────────────────────────────────────────────


      // Get user to check daily ad limit
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user is banned
      if (user.banned) {
        return res.status(403).json({
          banned: true,
          message: "Your account has been banned due to suspicious multi-account activity",
          reason: user.bannedReason
        });
      }

      // ── Anti-Fake Session Validation ──────────────────────────────────────
      const { sessionId, backgroundDuration, backgroundEntered, sessionStart } = req.body as {
        sessionId?: string;
        backgroundDuration?: number;
        backgroundEntered?: boolean;
        sessionStart?: number;
      };
      const userKey = String(userId);

      // 1. Session ID must be present and well-formed
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
        return res.status(400).json({
          message: "Invalid session. Please start a new ad session.",
          errorType: 'invalid_session',
        });
      }

      // 2. Look up the DB-backed session row (persists across restarts / multiple
      //    instances — required for reliable duplicate-reward protection in prod).
      const [sessionRow] = await db.select().from(adSessions).where(eq(adSessions.id, sessionId)).limit(1);
      if (!sessionRow) {
        return res.status(400).json({
          message: "Session was not pre-registered. Please start the ad flow again.",
          errorType: 'invalid_session',
        });
      }
      if (sessionRow.userId !== String(userId)) {
        return res.status(403).json({
          message: "Session belongs to a different user.",
          errorType: 'invalid_session',
        });
      }
      if (sessionRow.context !== 'ads_watch') {
        return res.status(400).json({
          message: "Invalid session context. Please start a new ad session.",
          errorType: 'invalid_session',
        });
      }
      if (sessionRow.status !== 'pending') {
        if (sessionRow.adType === 'adsgram' && sessionRow.status === 'used') {
          // A server postback can atomically consume the session just before
          // its audit row is inserted. Treat an already-consumed AdsGram
          // session as acknowledged here; never mint a second reward.
          return res.json({
            success: true,
            alreadyRewarded: true,
            rewardGems: 0,
            message: 'AdsGram reward was already credited.',
          });
        }
        return res.status(400).json({
          message: "Session already used. Please watch a new ad.",
          errorType: 'duplicate_session',
        });
      }
      const sessionAge = Date.now() - new Date(sessionRow.registeredAt as any).getTime();
      if (sessionAge > AD_SESSION_MAX_AGE_MS) {
        return res.status(400).json({
          message: "Session expired. Please start a new ad session.",
          errorType: 'invalid_session',
        });
      }
      // adType is authoritative from the server — ignore client-supplied value
      const serverAdType = sessionRow.adType;

      // 3. Cooldown between rewards
      const lastRewardAt       = adUserCooldowns.get(userKey) || 0;
      const cooldownRemaining  = AD_REWARD_COOLDOWN_MS - (Date.now() - lastRewardAt);
      if (cooldownRemaining > 0) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(cooldownRemaining / 1000)}s before watching another ad.`,
          errorType: 'cooldown',
          secsLeft: Math.ceil(cooldownRemaining / 1000),
        });
      }

      // AdsGram requires one background/minimize event, but has no minimum
      // duration. Other providers use only the server-measured session window.
      const bgDuration = typeof backgroundDuration === 'number' ? backgroundDuration : 0;
      const bgEntered = backgroundEntered === true;
      const sessionAgeMs = typeof sessionStart === 'number' ? Date.now() - sessionStart : 0;
      const serverSessionAgeMs = Date.now() - new Date(sessionRow.registeredAt as any).getTime();
      console.log(`ℹ️ Ad session bg time for user ${userId}: entered=${bgEntered} duration=${bgDuration}ms (total: ${sessionAgeMs}ms)`);

      if (serverAdType === 'adsgram' && !bgEntered) {
        await db.update(adSessions)
          .set({ status: 'failed', usedAt: new Date(), backgroundEntered: false, backgroundDurationMs: bgDuration })
          .where(eq(adSessions.id, sessionId));
        return res.status(400).json({
          message: "Please minimize the Mini App once during the AdsGram ad and return to claim the reward.",
          errorType: 'insufficient_background',
        });
      }

      // TowerAds supplies its own rewarded completion callback. Unlike generic
      // client-timed providers, a valid USL reward must not be rejected because
      // the SDK callback arrives before the generic 3-second window expires.
      if (serverAdType !== 'adsgram' && serverAdType !== 'uslads' && serverSessionAgeMs < MIN_PROVIDER_SESSION_MS) {
        await db.update(adSessions)
          .set({ status: 'failed', usedAt: new Date(), backgroundEntered: bgEntered, backgroundDurationMs: bgDuration })
          .where(eq(adSessions.id, sessionId));
        return res.status(400).json({
          message: "The ad session finished too quickly. Please watch the full ad and try again.",
          errorType: 'insufficient_session_duration',
        });
      }

      // 6. Per-user rate limit: max 10 ad reward requests per minute (prevents replay spam)
      if (checkRateLimit(`ad:${userId}`, 10)) {
        return res.status(429).json({
          message: 'Too many requests. Please slow down.',
          errorType: 'rate_limit',
        });
      }

      // 7. Behavioral bot detection (non-blocking — runs after marking session used)
      //    HIGH/CRITICAL risk = flag user but still give reward for now.
      //    Blocking based on behavior alone would cause false positives.
      setImmediate(async () => {
        try {
          const behavior = await analyzeAdBehavior(userId);
          if (behavior.riskContribution >= 35) {
            console.log(`🤖 Behavioral risk detected for ${userId}: score=${behavior.riskContribution} — ${behavior.notes.join(', ')}`);
            // Persist updated risk score (behavior only, non-blocking)
            const clientIP = req.headers['x-forwarded-for']?.toString()?.split(',')[0]?.trim()
              || req.headers['x-real-ip']?.toString()
              || req.socket?.remoteAddress || 'unknown';
            const { db: dbInner } = await import('./db');
            const { users: usersTable } = await import('../shared/schema');
            const { eq: eqInner, sql: sqlInner } = await import('drizzle-orm');
            await dbInner.execute(sqlInner`
              UPDATE users SET
                suspicion_score = LEAST(100, COALESCE(suspicion_score, 0) + ${Math.round(behavior.riskContribution * 0.4)}),
                flagged = CASE WHEN LEAST(100, COALESCE(suspicion_score, 0) + ${Math.round(behavior.riskContribution * 0.4)}) >= 56 THEN true ELSE flagged END,
                flag_reason = CASE WHEN LEAST(100, COALESCE(suspicion_score, 0) + ${Math.round(behavior.riskContribution * 0.4)}) >= 56
                  THEN ${'Bot behavior: ' + behavior.notes.slice(0, 2).join('; ')}
                  ELSE flag_reason END,
                updated_at = NOW()
              WHERE id = ${userId}
            `);
          }
        } catch (behaviorErr) {
          // Never block ad reward on analysis failure
        }
      });

      // ✅ All checks passed — atomically claim the session (only succeeds if it's
      // still 'pending'), which prevents a duplicate/resumed request racing this
      // one from also being rewarded for the same session.
      const [claimed] = await db.update(adSessions)
        .set({ status: 'used', usedAt: new Date(), backgroundEntered: bgEntered, backgroundDurationMs: bgDuration })
        .where(and(eq(adSessions.id, sessionId), eq(adSessions.status, 'pending')))
        .returning({ id: adSessions.id });
      if (!claimed) {
        return res.status(400).json({
          message: "Session already used. Please watch a new ad.",
          errorType: 'duplicate_session',
        });
      }
      adUserCooldowns.set(userKey, Date.now());
      console.log(`✅ Ad session valid for user ${userId}: adType=${serverAdType} bgDuration=${bgDuration}ms`);
      // ─────────────────────────────────────────────────────────────────────

      // Use the server-authoritative adType from pre-registration (never trust client field)
      const normalizedAdType = serverAdType;

      // Initialize response values early to avoid reference errors in catch block
      let adRewardGems = 0;

      // Fetch all admin settings once and pick per-provider values
      const allAdminSettings = await db.select().from(adminSettings);
      const getAdSetting = (key: string, def: string) =>
        allAdminSettings.find((s: any) => s.settingKey === key)?.settingValue || def;

      const defaultLimit = normalizedAdType === 'adsgram' ? '40' : normalizedAdType === 'monetag' || normalizedAdType === 'gigapub' ? '30' : '20';
      const DAILY_AD_LIMIT = parseInt(getAdSetting(`${normalizedAdType}_ad_limit`, defaultLimit));
      const defaultReward = normalizedAdType === 'adsgram' ? '50' : normalizedAdType === 'monetag' || normalizedAdType === 'gigapub' ? '30' : '20';
      const rewardPerAdGems = parseInt(getAdSetting(`${normalizedAdType}_reward_per_ad`, defaultReward));
      const providerEnabled = getAdSetting(`${normalizedAdType}_enabled`, 'true') === 'true';

      if (!providerEnabled) {
        return res.status(403).json({
          message: `${normalizedAdType} ads are currently disabled by admin.`,
          errorType: 'provider_disabled',
        });
      }

      // Per-provider daily count — period-aware (resets at 12:00 AM IST and 12:00 PM IST)
      const now = new Date();
      const currentPeriod  = storage.getResetPeriod(now);
      const lastAdPeriod   = user.lastAdDate ? storage.getResetPeriod(new Date(user.lastAdDate as any)) : null;
      const isNewAdPeriod  = currentPeriod !== lastAdPeriod;

      let currentTypeWatched: number;
      if (normalizedAdType === 'adsgram') {
        // storage.incrementAdsWatched handles its own period reset; mirror that here for limit check
        currentTypeWatched = isNewAdPeriod ? 0 : (user.adsWatchedToday || 0);
      } else if (normalizedAdType === 'monetag') {
        currentTypeWatched = isNewAdPeriod ? 0 : ((user as any).monetagAdsWatchedToday || 0);
      } else if (normalizedAdType === 'gigapub') {
        currentTypeWatched = isNewAdPeriod ? 0 : ((user as any).gigapubAdsWatchedToday || 0);
      } else if (normalizedAdType === 'uslads') {
        currentTypeWatched = isNewAdPeriod ? 0 : ((user as any).usladsAdsWatchedToday || 0);
      } else {
        // Unknown provider — treat as fresh (no prior count to check against)
        currentTypeWatched = 0;
      }

      // Check per-provider daily limit
      if (currentTypeWatched >= DAILY_AD_LIMIT) {
        return res.status(429).json({
          message: `Daily limit reached (${DAILY_AD_LIMIT} ads/period for ${normalizedAdType}). Resets at 12:00 AM or 12:00 PM IST.`,
          limit: DAILY_AD_LIMIT,
          watched: currentTypeWatched,
          limitType: 'daily',
          adType: normalizedAdType,
        });
      }

      // Gems reward amount — use the configured base reward for every eligible ad.
      adRewardGems = rewardPerAdGems;

      try {
        // Process reward with error handling to ensure success response
        // Capture the earning so we can reference its ID for referral commission tracking
        const adTypeDisplayNames: Record<string, string> = {
          adsgram:  'AdsGram ad',
          monetag:  'Monetag ad',
          gigapub:  'Gigapub ad',
          uslads:   'USL Ads ad',
        };
        const adDescription = adTypeDisplayNames[normalizedAdType] || `${normalizedAdType} ad`;
        const adWatchEarning = await storage.addEarning({
          userId,
          amount: String(adRewardGems),
          source: 'ad_watch',
          description: adDescription,
        });

        // Increment per-provider daily ads watched count (period-reset aware)
        if (normalizedAdType === 'adsgram') {
          await storage.incrementAdsWatched(userId); // handles period reset internally
        } else {
          const providerColumnMap: Record<string, string> = {
            monetag: 'monetag_ads_watched_today',
            gigapub: 'gigapub_ads_watched_today',
            uslads:  'uslads_ads_watched_today',
          };
          const col = providerColumnMap[normalizedAdType] || 'gigapub_ads_watched_today';
          // If this is a new reset period, start counter at 1; otherwise increment
          const newProviderCount = isNewAdPeriod ? 1 : (currentTypeWatched + 1);
          await db.execute(sql`
            UPDATE users SET
              ${sql.raw(col)} = ${newProviderCount},
              ads_watched     = COALESCE(ads_watched, 0) + 1,
              last_ad_date    = NOW(),
              updated_at      = NOW()
            WHERE id = ${userId}
          `);
        }

        // ── Increment Turnstile counter (backend-authoritative) ──────────────
        // Initialise threshold on first-ever claim (random 5–10 ads).
        // Counter is NOT reset here — it was reset when Turnstile was verified
        // above.  We only ever increment it; the reset happens upon verification.
        await db.execute(sql`
          UPDATE users SET
            ads_turnstile_count = COALESCE(ads_turnstile_count, 0) + 1,
            ads_turnstile_threshold = CASE
              WHEN COALESCE(ads_turnstile_threshold, 0) = 0
              THEN FLOOR(RANDOM() * 6 + 5)::integer
              ELSE ads_turnstile_threshold
            END,
            updated_at = NOW()
          WHERE id = ${userId}
        `);
        // ────────────────────────────────────────────────────────────────────

        // Stars system — increment weeklyStars when monthly contest is active
        try {
          const contestEnabledSetting = allAdminSettings.find((s: any) => s.settingKey === 'monthly_contest_enabled');
          const isContestEnabled = contestEnabledSetting?.settingValue === 'true';
          if (isContestEnabled) {
            const starsPerAdSetting = allAdminSettings.find((s: any) => s.settingKey === 'stars_per_ad');
            const starsPerAd = parseInt(starsPerAdSetting?.settingValue || '1');
            if (starsPerAd > 0) {
              await db.execute(sql`
                UPDATE users SET
                  weekly_stars = COALESCE(weekly_stars, 0) + ${starsPerAd},
                  updated_at   = NOW()
                WHERE id = ${userId}
              `);
            }
          }
        } catch (starsErr) {
          console.warn('⚠️ Stars increment failed (non-critical):', starsErr);
        }

        // Check and activate referral bonuses
        try {
          const activatedReferrerIds = await storage.checkAndActivateReferralBonus(userId);
          // Push live balance update to any referrer who just received the USD signup bonus
          for (const referrerId of activatedReferrerIds) {
            try {
              const referrerData = await storage.getUser(referrerId);
              sendRealtimeUpdate(referrerId, {
                type: 'balance_update',
                balance: referrerData?.balance,
                withdrawBalance: referrerData?.withdrawBalance,
                usdBalance: referrerData?.usdBalance,
                totalEarnings: referrerData?.totalEarnings,
              });
            } catch (_) {}
          }
        } catch (bonusError) {
          console.error("⚠️ Referral bonus processing failed (non-critical):", bonusError);
        }

        // Process 2-level referral commission (configurable from admin settings)
        if (user.referredBy) {
          try {
            const l1Setting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'l1_commission_percent')).limit(1);
            const l2Setting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'l2_commission_percent')).limit(1);
            const l1Rate = l1Setting[0]?.settingValue ? parseFloat(l1Setting[0].settingValue) / 100 : 0.20;
            const l2Rate = l2Setting[0]?.settingValue ? parseFloat(l2Setting[0].settingValue) / 100 : 0.04;

            // L1 referrer — the person who directly invited this user (stored as referral code)
            const l1Referrer = await storage.getUserByReferralCode(user.referredBy);
            if (l1Referrer) {
              // Use Math.ceil and ensure minimum 1 Gems commission so small rewards never round to 0
              const l1CommissionGems = Math.max(1, Math.ceil(adRewardGems * l1Rate));
              const l1RateDisplay = Math.round(l1Rate * 100);
              await db.update(users).set({
                pendingReferralBonus: sql`COALESCE(${users.pendingReferralBonus}, 0) + ${l1CommissionGems}`,
                updatedAt: new Date(),
              }).where(eq(users.id, l1Referrer.id));
              // Store in referralCommissions table for audit trail and affiliate statistics
              try {
                await db.insert(referralCommissions).values({
                  referrerId: l1Referrer.id,
                  referredUserId: userId,
                  originalEarningId: adWatchEarning.id,
                  commissionAmount: String(l1CommissionGems),
                });
              } catch (rcErr) {
                console.warn('⚠️ referralCommissions insert failed (non-critical):', rcErr);
              }
              console.log(`💰 L1 commission: ${l1CommissionGems} Gems (${l1RateDisplay}%) → ${l1Referrer.id}`);
              // Push live balance update to L1 referrer's open session
              try {
                const l1Updated = await storage.getUser(l1Referrer.id);
                sendRealtimeUpdate(l1Referrer.id, {
                  type: 'balance_update',
                  balance: l1Updated?.balance,
                  withdrawBalance: l1Updated?.withdrawBalance,
                  usdBalance: l1Updated?.usdBalance,
                  totalEarnings: l1Updated?.totalEarnings,
                });
              } catch (_) {}

              // L2 referrer — the person who invited the L1 referrer
              if (l1Referrer.referredBy) {
                try {
                  const l2Referrer = await storage.getUserByReferralCode(l1Referrer.referredBy);
                  if (l2Referrer) {
                    const l2CommissionGems = Math.max(1, Math.ceil(adRewardGems * l2Rate));
                    const l2RateDisplay = Math.round(l2Rate * 100);
                    await db.update(users).set({
                      pendingReferralBonus: sql`COALESCE(${users.pendingReferralBonus}, 0) + ${l2CommissionGems}`,
                      updatedAt: new Date(),
                    }).where(eq(users.id, l2Referrer.id));
                    // Store L2 in referralCommissions table
                    try {
                      await db.insert(referralCommissions).values({
                        referrerId: l2Referrer.id,
                        referredUserId: userId,
                        originalEarningId: adWatchEarning.id,
                        commissionAmount: String(l2CommissionGems),
                      });
                    } catch (rc2Err) {
                      console.warn('⚠️ L2 referralCommissions insert failed (non-critical):', rc2Err);
                    }
                    console.log(`💰 L2 commission: ${l2CommissionGems} Gems → ${l2Referrer.id}`);
                    // Push live balance update to L2 referrer
                    try {
                      const l2Updated = await storage.getUser(l2Referrer.id);
                      sendRealtimeUpdate(l2Referrer.id, {
                        type: 'balance_update',
                        balance: l2Updated?.balance,
                        withdrawBalance: l2Updated?.withdrawBalance,
                        usdBalance: l2Updated?.usdBalance,
                        totalEarnings: l2Updated?.totalEarnings,
                      });
                    } catch (_) {}
                  }
                } catch (l2Error) {
                  console.error("⚠️ L2 commission failed (non-critical):", l2Error);
                }
              }
            } else {
              // L1 referrer not found — log warning but do NOT clear the referral link
              // (referrer may be temporarily unavailable; clearing is irreversible)
              console.warn(`⚠️ L1 referrer with code ${user.referredBy} not found for user ${userId} — skipping commission this ad`);
            }
          } catch (commissionError) {
            console.error("⚠️ Referral commission processing failed (non-critical):", commissionError);
          }
        }
      } catch (earningError) {
        // SECURITY FIX: propagate the error so the outer catch returns HTTP 500 with no reward.
        // Silently swallowing here would acknowledge a reward that was never written to the DB.
        console.error("❌ Critical error adding earning — reward NOT granted:", earningError);
        throw earningError;
      }

      // Get updated balance (with fallback)
      let updatedUser = await storage.getUser(userId);
      if (!updatedUser) {
        updatedUser = user; // Fallback to original user data
      }
      // Use the per-provider column for the response counter
      const updatedTypeWatchedMap: Record<string, number | undefined> = {
        adsgram: updatedUser?.adsWatchedToday ?? undefined,
        monetag: (updatedUser as any)?.monetagAdsWatchedToday,
        gigapub: (updatedUser as any)?.gigapubAdsWatchedToday,
        uslads:  (updatedUser as any)?.usladsAdsWatchedToday,
      };
      const updatedTypeWatched: number =
        updatedTypeWatchedMap[normalizedAdType] ?? currentTypeWatched + 1;
      const newAdsWatched = updatedTypeWatched;

      // Send real-time update to user (non-blocking)
      try {
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: updatedUser?.balance,
          usdBalance: updatedUser?.usdBalance,
          amount: adRewardGems.toString(),
          message: 'Ad reward earned!',
          timestamp: new Date().toISOString()
        });
      } catch (wsError) {
        // WebSocket errors should not affect the response
        console.error("⚠️ WebSocket update failed (non-critical):", wsError);
      }

      // ALWAYS return success response to ensure reward notification shows
      const [finalUpdatedUser] = await db.select().from(users).where(eq(users.id, userId));
      res.json({
        success: true,
        rewardGems: adRewardGems,
        newBalance: finalUpdatedUser.balance,
        adsWatchedToday: finalUpdatedUser.adsWatchedToday,
        adType: normalizedAdType,
        adTypeWatchedToday: updatedTypeWatched,
      });
    } catch (error) {
      console.error("❌ Unexpected error in ad watch endpoint:", error);
      console.error("   Error details:", error instanceof Error ? error.message : String(error));
      console.error("   Stack trace:", error instanceof Error ? error.stack : 'N/A');
      // SECURITY FIX: Never silently reward on error. Returning a reward when the
      // actual DB write failed would credit users without a real earning record.
      res.status(500).json({
        success: false,
        message: "Reward processing failed. Please try again.",
        errorType: 'server_error',
      });
    }
  });

  // Daily Activity Bonus endpoints
  const DAILY_BONUS_MILESTONES = [
    { ads: 100, usdReward: 0.01  },
    { ads: 200, usdReward: 0.02  },
    { ads: 300, usdReward: 0.03  },
    { ads: 400, usdReward: 0.05  },
    { ads: 500, usdReward: 0.10  },
  ];

  function getISOWeek(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  function getDailyResetDateStr(): string {
    return getResetPeriodKey();
  }

  app.get('/api/daily-bonus/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const adsWatchedToday = user.adsWatchedToday || 0;
      const today = getDailyResetDateStr();

      // Get which milestones were already claimed today
      const claimedRows = await db.select({ missionType: dailyMissions.missionType })
        .from(dailyMissions)
        .where(
          and(
            eq(dailyMissions.userId, String(userId)),
            eq(dailyMissions.resetDate, today),
            sql`${dailyMissions.missionType} LIKE 'ad_milestone_%'`
          )
        );
      const claimedIndices: number[] = claimedRows.map(r => parseInt(r.missionType.replace('ad_milestone_', ''))).filter(n => !isNaN(n));

      // Next claimable = lowest unclaimed milestone the user qualifies for
      let nextClaimableIndex = -1;
      for (let i = 0; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (adsWatchedToday >= DAILY_BONUS_MILESTONES[i].ads && !claimedIndices.includes(i)) {
          nextClaimableIndex = i;
          break;
        }
      }

      // Calculate exact next reset time: 06:30/18:30 UTC
      const nextReset = getNextResetTime();

      res.json({
        adsWatchedToday,
        milestones: DAILY_BONUS_MILESTONES,
        currentMilestoneIndex: nextClaimableIndex,
        currentBonus: nextClaimableIndex >= 0 ? DAILY_BONUS_MILESTONES[nextClaimableIndex] : null,
        claimedMilestones: claimedIndices,
        claimedToday: claimedIndices.length > 0,
        canUpgrade: false,
        nextResetAt: nextReset.toISOString(),
        resetHourUTC: nextReset.getUTCHours(),
      });
    } catch (error) {
      console.error('Daily bonus status error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/daily-bonus/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const adsWatchedToday = user.adsWatchedToday || 0;
      const today = getDailyResetDateStr();
      const currentWeek = getISOWeek();

      // Get which milestones were already claimed today
      const claimedRows = await db.select({ missionType: dailyMissions.missionType })
        .from(dailyMissions)
        .where(
          and(
            eq(dailyMissions.userId, String(userId)),
            eq(dailyMissions.resetDate, today),
            sql`${dailyMissions.missionType} LIKE 'ad_milestone_%'`
          )
        );
      const claimedIndices = new Set<number>(
        claimedRows.map(r => parseInt(r.missionType.replace('ad_milestone_', ''))).filter(n => !isNaN(n))
      );

      // Find the LOWEST unclaimed milestone the user qualifies for (must claim in order)
      let milestoneIndex = -1;
      for (let i = 0; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (adsWatchedToday >= DAILY_BONUS_MILESTONES[i].ads && !claimedIndices.has(i)) {
          milestoneIndex = i;
          break;
        }
      }

      if (milestoneIndex < 0) {
        // Check whether user hasn't reached any milestone vs all claimed
        const anyReached = DAILY_BONUS_MILESTONES.some(m => adsWatchedToday >= m.ads);
        if (!anyReached) {
          return res.status(400).json({ message: 'No milestone reached yet', noMilestone: true });
        }
        return res.status(400).json({ message: 'All reached milestones already claimed today', alreadyClaimed: true });
      }

      const milestone = DAILY_BONUS_MILESTONES[milestoneIndex];

      // STEP 1: Atomically claim the milestone slot FIRST (prevents race condition / double-claim)
      // ON CONFLICT means another concurrent request already claimed it — return error immediately
      const inserted = await db.insert(dailyMissions).values({
        userId: String(userId),
        missionType: `ad_milestone_${milestoneIndex}`,
        completed: true,
        claimedAt: new Date(),
        resetDate: today,
        createdAt: new Date(),
      }).onConflictDoNothing().returning({ id: dailyMissions.id });

      if (inserted.length === 0) {
        // Slot was already taken — another request beat us to it
        return res.status(400).json({ message: 'Milestone already claimed', alreadyClaimed: true });
      }

      // STEP 2: Give the reward (safe — slot is already locked above)
      if (milestone.usdReward) {
        // Credit USD directly to usd_balance — do NOT convert to Gems
        await db
          .update(users)
          .set({
            usdBalance: sql`COALESCE(${users.usdBalance}, 0) + ${milestone.usdReward}`,
            totalEarned: sql`COALESCE(${users.totalEarned}, 0) + ${String(milestone.usdReward)}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
        // Log transaction for audit trail
        await db.insert(transactions).values({
          userId,
          amount: String(milestone.usdReward),
          type: 'addition',
          source: 'daily_bonus_usd',
          description: `Daily activity bonus: $${milestone.usdReward} (${milestone.ads} ads milestone)`,
          metadata: { rewardType: 'USD', milestone: milestoneIndex, adsRequired: milestone.ads },
          createdAt: new Date(),
        });
        console.log(`💰 Milestone ${milestoneIndex} (${milestone.ads} ads): +$${milestone.usdReward} USD credited to usd_balance for ${userId}`);
      }

      // STEP 3: Update last_bonus_claimed_index to highest claimed (keeps legacy column in sync)
      try {
        await db.execute(sql`
          UPDATE users
          SET last_bonus_claimed_index = GREATEST(COALESCE(last_bonus_claimed_index, -1), ${milestoneIndex}),
              updated_at = NOW()
          WHERE id = ${userId}
        `);
      } catch (_) { /* non-critical legacy column */ }

      // STEP 4: Figure out the next unclaimed milestone for the UI
      const updatedClaimedIndices = new Set([...claimedIndices, milestoneIndex]);
      let nextMilestone: { index: number; ads: number; reward: string } | null = null;
      for (let i = milestoneIndex + 1; i < DAILY_BONUS_MILESTONES.length; i++) {
        if (!updatedClaimedIndices.has(i)) {
          const m = DAILY_BONUS_MILESTONES[i];
          nextMilestone = {
            index: i,
            ads: m.ads,
            reward: `${m.usdReward} USD`,
          };
          break;
        }
      }

      // STEP 5: Fetch updated user and push real-time balance update
      try {
        const updatedUser = await storage.getUser(userId);
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: updatedUser?.balance,
          usdBalance: updatedUser?.usdBalance,
        });
        return res.json({
          success: true,
          milestoneIndex,
          milestone,
          nextMilestone,
        });
      } catch (_) {
        // non-critical — still return success
      }

      res.json({ success: true, milestoneIndex, milestone, nextMilestone });
    } catch (error) {
      console.error('Daily bonus claim error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Helper: get ISO week key for N weeks ago (0 = current, 1 = last week)
  function getISOWeekOffset(weeksAgo: number): string {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - weeksAgo * 7);
    const year = now.getUTCFullYear();
    const startOfYear = new Date(Date.UTC(year, 0, 1));
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
    const week = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  // Check channel membership endpoint
  app.get('/api/streak/check-membership', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        if (process.env.NODE_ENV === 'development') {
          return res.json({
            success: true,
            isMember: true,
            channelUsername: config.telegram.channelId,
            channelUrl: config.telegram.channelUrl,
            message: 'Development mode: membership check bypassed'
          });
        }

        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        return res.status(500).json({
          success: false,
          isMember: false,
          message: 'Channel verification is temporarily unavailable. Please try again later.',
          error_code: 'VERIFICATION_UNAVAILABLE'
        });
      }

      // Check membership for configured channel
      const isMember = await verifyChannelMembership(
        parseInt(telegramId),
        config.telegram.channelId,
        botToken
      );

      res.json({
        success: true,
        isMember,
        channelUsername: config.telegram.channelId,
        channelUrl: config.telegram.channelUrl
      });
    } catch (error) {
      console.error("Error checking channel membership:", error);
      res.json({
        success: false,
        isMember: false,
        message: 'Unable to verify channel membership. Please make sure you have joined the channel and try again.',
        error_code: 'VERIFICATION_ERROR'
      });
    }
  });

  // Streak claim endpoint (Claim Bonus - every 5 minutes, 1 Gems)
  app.post('/api/streak/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const isDevMode = process.env.NODE_ENV === 'development';

      // Skip channel verification in development mode
      if (!isDevMode) {
        // Verify channel membership before allowing claim
        if (botToken) {
          const isMember = await verifyChannelMembership(
            parseInt(telegramId),
            config.telegram.channelId,
            botToken
          );

          if (!isMember) {
            return res.status(403).json({
              success: false,
              message: 'Please join our Telegram channel first to claim your bonus.',
              requiresChannelJoin: true,
              channelUsername: config.telegram.channelId,
              channelUrl: config.telegram.channelUrl
            });
          }
        } else {
          return res.status(500).json({
            success: false,
            message: 'Channel verification is temporarily unavailable. Please try again later.',
            error_code: 'VERIFICATION_UNAVAILABLE'
          });
        }
      }

      const result = await storage.updateUserStreak(userId);

      if (parseFloat(result.rewardEarned) === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please wait 5 minutes before claiming again!'
        });
      }

      sendRealtimeUpdate(userId, {
        type: 'streak_reward',
        amount: result.rewardEarned,
        message: '✅ Bonus claimed!',
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        newStreak: result.newStreak,
        rewardEarned: result.rewardEarned,
        isBonusDay: result.isBonusDay,
        message: 'Bonus claimed successfully'
      });
    } catch (error) {
      console.error("Error processing bonus claim:", error);
      res.status(500).json({ message: "Failed to claim bonus" });
    }
  });

  // ─── Home page Daily Rewards: Check-In & Mystery Gift ──────────────────────
  // Both reset on a 12-hour schedule: 06:30 UTC and 18:30 UTC.
  const getResetPeriod = () => getResetPeriodKey();
  
  const utcDayKey = (d: Date | string | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 10) : null;

  // Admin-settings lookup helper for the Daily Rewards endpoints
  const getAdminSetting = async (key: string, defaultValue: string): Promise<string> => {
    try {
      const rows = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, key));
      return rows[0]?.settingValue || defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Atomically consume a pre-registered ad session for a reward claim (inside
  // the caller's transaction). The session must be registered before the ad,
  // belong to this user + context, remain pending, be fresh, and be old enough
  // to plausibly contain an ad view. AdsGram additionally requires the
  // background/minimize lifecycle proof; Monetag is accepted through the
  // server-measured session duration and does not require a background event.
  const consumeRewardAdSession = async (
    tx: any, userId: string, body: any, context: 'daily_checkin' | 'mystery_box',
  ): Promise<boolean> => {
    const sessionId = body?.sessionId;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) return false;
    const bgEntered = body?.backgroundEntered === true;
    const bgDuration = typeof body?.backgroundDuration === 'number' ? Math.max(0, body.backgroundDuration) : 0;

    const [session] = await tx
      .select({ adType: adSessions.adType })
      .from(adSessions)
      .where(and(
        eq(adSessions.id, sessionId),
        eq(adSessions.userId, userId),
        eq(adSessions.context, context),
        eq(adSessions.status, 'pending'),
      ))
      .limit(1);

    if (!session) return false;

    if (session.adType === 'adsgram' && !bgEntered) {
      // AdsGram must genuinely minimize the Mini App. Burn the session so an
      // unverified claim cannot be retried or replayed.
      await tx
        .update(adSessions)
        .set({ status: 'failed', usedAt: new Date(), backgroundEntered: false, backgroundDurationMs: bgDuration })
        .where(and(
          eq(adSessions.id, sessionId),
          eq(adSessions.userId, userId),
          eq(adSessions.context, context),
          eq(adSessions.status, 'pending'),
        ));
      return false;
    }

    const consumed = await tx
      .update(adSessions)
      .set({ status: 'used', usedAt: new Date(), backgroundEntered: true, backgroundDurationMs: bgDuration })
      .where(and(
        eq(adSessions.id, sessionId),
        eq(adSessions.userId, userId),
        eq(adSessions.context, context),
        eq(adSessions.status, 'pending'),
        sql`registered_at >= NOW() - make_interval(secs => ${AD_SESSION_MAX_AGE_MS / 1000})`,
        sql`registered_at <= NOW() - make_interval(secs => ${MIN_PROVIDER_SESSION_MS / 1000})`,
      ))
      .returning({ id: adSessions.id });
    return consumed.length > 0;
  };

  // POST /api/daily-checkin — once per UTC day, credits TON. Requires a
  // server-verified ad session (registered via /api/ads/register-session
  // with context 'daily_checkin' before the ad was shown).
  app.post('/api/daily-checkin', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const periodKey = getCheckinDayKey();
      if (user.dailyCheckinClaimed && normalizeCheckinDayKey(user.dailyCheckinLastClaimDate || user.dailyTasksDate) === periodKey) {
        return res.status(400).json({ message: "Daily check-in already claimed for this period" });
      }

      const reward = parseFloat(await getAdminSetting('daily_checkin_ton_reward', '0.001'));

      const outcome = await db.transaction(async (tx) => {
        const adVerified = await consumeRewardAdSession(tx, userId, req.body, 'daily_checkin');
        if (!adVerified) return { error: 'ad_not_verified' as const };

        // Atomic claim + credit — only succeeds if not already claimed today
        const updated = await tx
          .update(users)
          .set({
            dailyCheckinClaimed: true,
            dailyTasksDate: new Date(),
            lastResetPeriod: periodKey,
            tonBalance: sql`COALESCE(ton_balance, 0) + ${reward}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(users.id, userId),
            sql`NOT (daily_checkin_claimed = true AND daily_checkin_last_claim_date IS NOT NULL AND DATE(daily_checkin_last_claim_date AT TIME ZONE 'Asia/Kolkata') = ${periodKey})`,
          ))
          .returning({ tonBalance: users.tonBalance });
        if (updated.length === 0) return { error: 'already_claimed' as const };

        await tx.insert(transactions).values({
          userId,
          amount: String(reward),
          type: 'addition',
          source: 'daily_checkin',
          description: 'Daily check-in TON reward',
        });

        return { tonBalance: updated[0].tonBalance };
      });

      if ('error' in outcome) {
        if (outcome.error === 'ad_not_verified') {
          return res.status(400).json({
            message: "Ad view could not be verified. Please watch the ad and try again.",
            errorType: 'ad_not_verified',
          });
        }
        return res.status(400).json({ message: "Daily check-in already claimed today" });
      }

      res.json({ success: true, reward, tonBalance: outcome.tonBalance });
    } catch (error) {
      console.error("Error processing daily check-in:", error);
      res.status(500).json({ message: "Failed to process daily check-in" });
    }
  });

  // POST /api/mystery-box — up to 5 opens per UTC day, random Gems reward.
  // Requires a server-verified ad session (context 'mystery_box').
  app.post('/api/mystery-box', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const MYSTERY_DAILY_LIMIT = parseInt(await getAdminSetting('mystery_box_daily_limit', '5'));
      const periodKey = getResetPeriod();
      const claimsToday = user.lastResetPeriod === periodKey ? (user.mysteryBoxCount || 0) : 0;

      if (claimsToday >= MYSTERY_DAILY_LIMIT) {
        return res.status(400).json({ message: "Mystery Gift limit reached for this period", claimsToday });
      }

      const minReward = Math.max(1, parseInt(await getAdminSetting('mystery_box_min_reward', '1')) || 1);
      const maxReward = Math.min(500, Math.max(minReward, parseInt(await getAdminSetting('mystery_box_max_reward', '500')) || 500));
      // Weighted reward: low rewards are common and high rewards are rare.
      const span = maxReward - minReward;
      const roll = Math.random();
      const reward = roll < 0.70
        ? Math.floor(minReward + span * 0.10 * Math.random())
        : roll < 0.95
          ? Math.floor(minReward + span * (0.10 + 0.30 * Math.random()))
          : roll < 0.999
            ? Math.floor(minReward + span * (0.40 + 0.60 * Math.random()))
            : maxReward;

      const outcome = await db.transaction(async (tx) => {
        const adVerified = await consumeRewardAdSession(tx, userId, req.body, 'mystery_box');
        if (!adVerified) return { error: 'ad_not_verified' as const };

        // Atomic counter + balance credit — guards against concurrent double-open.
        // Counter, balance, earning record, and transaction log commit together.
        const updated = await tx
          .update(users)
          .set({
            mysteryBoxDate: new Date(),
            lastResetPeriod: periodKey,
            mysteryBoxCount: sql`CASE WHEN last_reset_period = ${periodKey} THEN COALESCE(mystery_box_count, 0) + 1 ELSE 1 END`,
            balance: sql`COALESCE(balance, 0) + ${reward}`,
            withdrawBalance: sql`COALESCE(withdraw_balance, 0) + ${reward}`,
            totalEarned: sql`COALESCE(total_earned, 0) + ${reward}`,
            totalEarnings: sql`COALESCE(total_earnings, 0) + ${reward}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(users.id, userId),
            sql`(last_reset_period IS NULL OR last_reset_period != ${periodKey} OR COALESCE(mystery_box_count, 0) < ${MYSTERY_DAILY_LIMIT})`,
          ))
          .returning({ mysteryBoxCount: users.mysteryBoxCount, balance: users.balance });
        if (updated.length === 0) return { error: 'limit_reached' as const };

        await tx.insert(earnings).values({
          userId,
          amount: String(reward),
          source: 'mystery_box',
          description: 'Mystery Gift reward',
        });
        await tx.insert(transactions).values({
          userId,
          amount: String(reward),
          type: 'addition',
          source: 'mystery_box',
          description: 'Mystery Gift reward',
        });
        // Keep shadow user_balances table in sync within the same transaction
        await tx.execute(sql`
          INSERT INTO user_balances (user_id, balance)
          VALUES (${userId}, ${reward})
          ON CONFLICT (user_id) DO UPDATE
          SET balance = COALESCE(user_balances.balance, 0) + ${reward}, updated_at = NOW()
        `);

        return { claimsToday: updated[0].mysteryBoxCount, newBalance: updated[0].balance };
      });

      if ('error' in outcome) {
        if (outcome.error === 'ad_not_verified') {
          return res.status(400).json({
            message: "Ad view could not be verified. Please watch the ad and try again.",
            errorType: 'ad_not_verified',
          });
        }
        return res.status(400).json({ message: "Mystery Gift limit reached for today", claimsToday });
      }

      res.json({
        success: true,
        reward,
        claimsToday: outcome.claimsToday,
        newBalance: outcome.newBalance || '0',
      });
    } catch (error) {
      console.error("Error opening mystery box:", error);
      res.status(500).json({ message: "Failed to open mystery box" });
    }
  });




  // Legacy task eligibility endpoint removed - using daily tasks system only

  // User stats endpoint
  app.get('/api/user/stats', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const stats = await storage.getUserStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user stats" });
    }
  });

  // Quests progress and one-time reward claims.
  // Quest rewards are persisted through transactions so the client can safely
  // render claim state without adding a second quest-specific table.
  type QuestReward = { target: number; kind: 'checkin' | 'ads' | 'social' | 'game'; gold: number; ton: number };
  const QUEST_TARGETS = [10, 50, 100, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000, 20000, 25000, 30000, 50000];
  const QUEST_REWARDS: Record<string, QuestReward> = {};
  for (const target of QUEST_TARGETS) {
    QUEST_REWARDS[`game_${target}`] = { target, kind: 'game', gold: target * 10, ton: 0 };
    QUEST_REWARDS[`ads_${target}`] = { target, kind: 'ads', gold: target * 10, ton: 0 };
    QUEST_REWARDS[`social_${target}`] = { target, kind: 'social', gold: target * 10, ton: 0 };
  }
  const QUEST_CHECKIN_REWARDS: Array<[number, number, number]> = [
    [1, 100, 1], [5, 500, 5], [10, 1000, 10], [15, 3000, 30], [20, 5000, 50],
    [25, 10000, 100], [35, 20000, 200], [40, 30000, 300], [45, 50000, 500],
    [50, 100000, 1000], [55, 150000, 1500], [60, 200000, 2000], [75, 250000, 2500],
    [80, 300000, 3000], [85, 500000, 5000],
  ];
  for (const [target, gold] of QUEST_CHECKIN_REWARDS) {
    QUEST_REWARDS[`checkin_${target}`] = { target, kind: 'checkin', gold, ton: 0 };
  }

  app.get('/api/quests/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.json({ success: true, claimedQuestIds: [], socialCompleted: 0, gameCompleted: 0, streak: 0 });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const claimedRows = await db.select({ source: transactions.source, metadata: transactions.metadata })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          sql`(${transactions.source} LIKE 'quest_claim_%' OR ${transactions.metadata}->>'questId' IS NOT NULL)`,
        ));
      const claimedQuestIds = Array.from(new Set(
        claimedRows
          .flatMap((row) => {
            const source = String(row.source || '');
            const metadataQuestId = row.metadata && typeof row.metadata === 'object'
              ? String((row.metadata as Record<string, unknown>).questId || '')
              : '';
            return [
              source.startsWith('quest_claim_') ? source.slice('quest_claim_'.length) : '',
              metadataQuestId,
            ];
          })
          .filter(Boolean),
      ));

      const socialResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM task_clicks tc
        INNER JOIN advertiser_tasks at ON at.id = tc.task_id
        WHERE tc.publisher_id = ${userId}
          AND tc.claimed_at IS NOT NULL
          AND LOWER(COALESCE(at.task_type, '')) IN ('channel', 'social', 'partner')
      `);
      const gameResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM task_clicks tc
        INNER JOIN advertiser_tasks at ON at.id = tc.task_id
        WHERE tc.publisher_id = ${userId}
          AND tc.claimed_at IS NOT NULL
          AND LOWER(COALESCE(at.task_type, '')) IN ('bot', 'game')
      `);

      res.json({
        success: true,
        claimedQuestIds,
        socialCompleted: Number((socialResult.rows[0] as any)?.count || 0),
        gameCompleted: Number((gameResult.rows[0] as any)?.count || 0),
        streak: Number(user.dailyCheckinStreak || user.currentStreak || 0),
      });
    } catch (error) {
      console.error('Error fetching quest status:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch quest status' });
    }
  });

  app.post('/api/quests/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const questId = String(req.body?.questId || '');
      const quest = QUEST_REWARDS[questId];
      if (!userId || !quest) return res.status(400).json({ success: false, message: 'Invalid quest' });

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const alreadyClaimed = await db.select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.source, `quest_claim_${questId}`)))
        .limit(1);
      if (alreadyClaimed.length) return res.status(400).json({ success: false, message: 'Quest already claimed' });

      let progress = 0;
      if (quest.kind === 'checkin') progress = Number(user.dailyCheckinStreak || user.currentStreak || 0);
      if (quest.kind === 'ads') progress = Number(user.adsWatched || 0);
      if (quest.kind === 'social' || quest.kind === 'game') {
        const taskTypes = quest.kind === 'game' ? ['bot', 'game'] : ['channel', 'social', 'partner'];
        const taskResult = await db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM task_clicks tc
          INNER JOIN advertiser_tasks at ON at.id = tc.task_id
          WHERE tc.publisher_id = ${userId}
            AND tc.claimed_at IS NOT NULL
            AND LOWER(COALESCE(at.task_type, '')) IN (${sql.join(taskTypes.map((type) => sql`${type}`), sql`, `)})
        `);
        progress = Number((taskResult.rows[0] as any)?.count || 0);
      }
      if (progress < quest.target) return res.status(400).json({ success: false, message: 'Quest requirement not reached' });

      if (quest.gold > 0) {
        await storage.addEarning({
          userId,
          amount: String(quest.gold),
          source: 'quest_reward',
          description: `Quest reward: ${questId}`,
        });
      }
      if (quest.ton > 0) {
        const balanceUpdate: any = { updatedAt: new Date() };
        if (quest.ton > 0) balanceUpdate.tonBalance = sql`COALESCE(${users.tonBalance}, 0) + ${quest.ton}`;
        await db.update(users).set(balanceUpdate).where(eq(users.id, userId));
      }
      await db.insert(transactions).values({
        userId,
        amount: String(quest.gold),
        type: 'addition',
        source: `quest_claim_${questId}`,
        description: `Quest claimed: ${questId}`,
        metadata: { questId, gold: quest.gold, ton: quest.ton },
      });

      res.json({ success: true, questId, goldReward: quest.gold, tonReward: quest.ton });
    } catch (error) {
      console.error('Error claiming quest:', error);
      res.status(500).json({ success: false, message: 'Failed to claim quest' });
    }
  });

  // Referral stats endpoint - auth removed to prevent popup spam on affiliates page
  app.get('/api/referrals/stats', authenticateTelegram, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log('⚠️ Referral stats requested without session - sending empty response');
        return res.json({
          success: true,
          skipAuth: true,
          totalInvites: 0,
          successfulInvites: 0,
          totalClaimed: '0',
          availableBonus: '0',
          readyToClaim: '0',
          totalStarEarned: 0,
          totalUsdEarned: 0
        });
      }
      const user = await storage.getUser(userId);

      // ── Friend count: use users.referred_by as primary source of truth ──
      // Some users may be missing referrals-table rows, so count directly from users table
      let totalInvitesCount = 0;
      let successfulInvitesCount = 0;
      if (user?.referralCode) {
        // Total L1 friends: anyone whose referred_by = my referral code
        // We prioritize the users table as the primary source of truth for "counting"
        // because it captures the link even if the referrals-table row fails to insert.
        const totalFromUsers = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.referredBy, user.referralCode));
        
        const totalFromReferrals = await storage.getTotalInvitesCount(userId);
        
        // Take MAX of both counts to never under-count
        totalInvitesCount = Math.max(
          Number(totalFromUsers[0]?.count || 0),
          totalFromReferrals
        );

        // Successful: completed referrals (watched 1+ ad) from referrals table
        successfulInvitesCount = await storage.getValidReferralCount(userId);
        // Fallback: if referrals table < users table count, use users count
        if (successfulInvitesCount < totalInvitesCount) {
          // count completed referrals from users table (has ads_watched_today > 0 or balance > 0)
          const successFromUsers = await db.execute(sql`
            SELECT COUNT(*) as count FROM users
            WHERE referred_by = ${user.referralCode}
              AND (ads_watched > 0 OR COALESCE(total_earned,'0')::numeric > 0)
              AND COALESCE(banned, false) = false
          `);
          const countFromUsers = Number((successFromUsers.rows[0] as any)?.count || 0);
          successfulInvitesCount = Math.max(successfulInvitesCount, countFromUsers);
        }
      } else {
        totalInvitesCount = await storage.getTotalInvitesCount(userId);
        successfulInvitesCount = await storage.getValidReferralCount(userId);
      }

      // ── Earnings from referrals ──
      // USD earned: from referrals table (signup USD bonuses given to referrer)
      const completedReferrals = await db
        .select()
        .from(referrals)
        .where(and(
          eq(referrals.referrerId, userId),
          eq(referrals.status, 'completed')
        ));
      let totalUsdEarned = 0;
      for (const ref of completedReferrals) {
        totalUsdEarned += parseFloat(ref.usdRewardAmount || '0');
      }

      // Gems earned: sum L1 commissions only from earnings table
      // (L2 commissions excluded from display)
      const powCommissionsResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) AS total
        FROM earnings
        WHERE user_id = ${userId}
          AND source IN ('referral_commission', 'referral')
      `);
      const totalPowEarned = Number((powCommissionsResult.rows[0] as any)?.total || 0);
      const l2CommissionsResult = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS DECIMAL)), 0) AS total
        FROM earnings
        WHERE user_id = ${userId} AND source = 'referral_commission_l2'
      `);
      const totalL2Earned = Number((l2CommissionsResult.rows[0] as any)?.total || 0);
      const claimedMilestoneRows = await db.select({ source: transactions.source }).from(transactions).where(and(eq(transactions.userId, userId), sql`${transactions.source} LIKE 'referral_milestone_%'`));
      const claimedMilestones = Object.fromEntries(claimedMilestoneRows.map(row => [String(row.source).replace('referral_milestone_', ''), true]));

      // L2 count: users referred by my direct referrals
      let l2Count = 0;
      try {
        if (user?.referralCode) {
          const l1Users = await db
            .select({ referralCode: users.referralCode })
            .from(users)
            .where(eq(users.referredBy, user.referralCode));
          if (l1Users.length > 0) {
            const l1Codes = l1Users.map(u => u.referralCode).filter(Boolean) as string[];
            if (l1Codes.length > 0) {
              // Use raw SQL to avoid Drizzle IN-clause limitations with large arrays
              const l2Result = await db.execute(sql`
                SELECT COUNT(*) as count FROM users
                WHERE referred_by IN (${sql.join(l1Codes.map(c => sql`${c}`), sql`, `)})
              `);
              l2Count = Number((l2Result.rows[0] as any)?.count || 0);
            }
          }
        }
      } catch (l2Error) {
        console.error("Error computing L2 count:", l2Error);
      }

      res.json({
        totalInvites: totalInvitesCount,
        successfulInvites: successfulInvitesCount,
        l2Count,
        totalClaimed: user?.totalClaimedReferralBonus || '0',
        availableBonus: user?.pendingReferralBonus || '0',
        readyToClaim: user?.pendingReferralBonus || '0',
        totalReferralBonusEarned: (totalPowEarned + totalL2Earned + Number(user?.pendingReferralBonus || 0)).toString(),
        totalPowEarned,
        totalL1Earned: totalPowEarned,
        totalL2Earned,
        claimedMilestones,
        totalUsdEarned,
        // legacy field kept for compatibility
        totalStarEarned: totalPowEarned,
      });
    } catch (error) {
      console.error("Error fetching referral stats:", error);
      res.status(500).json({ message: "Failed to fetch referral stats" });
    }
  });

  // Claim referral bonus endpoint
  app.post('/api/referrals/claim', authenticateTelegram, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log('⚠️ Referral claim requested without session - skipping');
        return res.json({ success: true, skipAuth: true });
      }
      const result = await storage.claimReferralBonus(userId);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error claiming referral bonus:", error);
      res.status(500).json({ message: "Failed to claim referral bonus" });
    }
  });

  // Claim a referral milestone reward once the invite threshold is reached.
  app.post('/api/referrals/milestones/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const inviteTarget = Number(req.body?.inviteTarget);
      const milestones: Record<number, number> = { 10: 100, 50: 500, 100: 1000, 300: 3000, 500: 5000, 1000: 10000, 2000: 20000, 3000: 30000, 5000: 50000, 10000: 100000, 15000: 150000, 20000: 200000, 25000: 250000, 30000: 300000, 50000: 500000 };
      if (!userId || !milestones[inviteTarget]) return res.status(400).json({ error: 'Invalid milestone' });
      const user = await storage.getUser(userId);
      if (!user?.referralCode) return res.status(400).json({ error: 'Referral code not found' });
      const countResult = await db.select({ count: sql<number>`COUNT(*)` }).from(users).where(eq(users.referredBy, user.referralCode));
      const inviteCount = Number(countResult[0]?.count || 0);
      if (inviteCount < inviteTarget) return res.status(400).json({ error: 'Invite milestone not reached' });
      const source = `referral_milestone_${inviteTarget}`;
      const existing = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.source, source))).limit(1);
      if (existing.length) return res.status(400).json({ error: 'Milestone already claimed' });
      const goldReward = milestones[inviteTarget];
      await db.update(users).set({ balance: sql`COALESCE(${users.balance}, 0) + ${goldReward}`, updatedAt: new Date() }).where(eq(users.id, userId));
      await db.update(userBalances).set({ balance: sql`COALESCE(${userBalances.balance}, 0) + ${goldReward}`, updatedAt: new Date() }).where(eq(userBalances.userId, userId));
      await db.insert(transactions).values({ userId, amount: String(goldReward), type: 'addition', source, description: `Referral milestone: ${inviteTarget} invites` });
      return res.json({ success: true, goldReward });
    } catch (error) {
      console.error('Error claiming referral milestone:', error);
      return res.status(500).json({ error: 'Failed to claim milestone' });
    }
  });
  // Get valid referral count (friends who watched at least 1 ad)
  app.get('/api/referrals/valid-count', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id || req.session?.user?.user?.id;

      if (!userId) {
        return res.json({ validReferralCount: 0 });
      }

      const validCount = await storage.getValidReferralCount(userId);
      res.json({ validReferralCount: validCount });
    } catch (error) {
      console.error("Error fetching valid referral count:", error);
      res.status(500).json({ message: "Failed to fetch valid referral count" });
    }
  });

  // Withdrawal eligibility - check if user has watched enough ads for this withdrawal
  app.get('/api/withdrawal-eligibility', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }

      // Get user's total ads watched
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }

      // Get user's last completed/approved withdrawal timestamp
      const lastWithdrawal = await db
        .select({ createdAt: withdrawals.createdAt })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          sql`LOWER(CAST(${withdrawals.status} AS TEXT)) IN ('completed', 'approved')`
        ))
        .orderBy(desc(withdrawals.createdAt))
        .limit(1);

      // Get admin settings for withdrawal requirements
      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = allSettings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };

      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const MINIMUM_ADS_FOR_WITHDRAWAL = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      let adsWatchedSinceLastWithdrawal = 0;

      if (lastWithdrawal.length === 0) {
        // No previous withdrawal - count all ads watched
        adsWatchedSinceLastWithdrawal = user.adsWatched || 0;
      } else {
        // Count ads watched since last withdrawal
        // We use the earnings table to count ads since the last withdrawal
                const lastWithdrawalDate = lastWithdrawal[0].createdAt || new Date(0);
        const adsCountResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(earnings)
          .where(and(
            eq(earnings.userId, userId),
            eq(earnings.source, 'ad_watch'),
            gte(earnings.createdAt, lastWithdrawalDate)
          ));

        adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
      }

      // Task-completion requirement — lifetime count of advertiser tasks completed
      const withdrawalTaskRequirementEnabled = getSetting('withdrawal_task_requirement_enabled', 'true') === 'true';
      const MINIMUM_TASKS_FOR_WITHDRAWAL = parseInt(getSetting('minimum_tasks_for_withdrawal', '10'));
      const tasksCompletedResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(taskClicks)
        .where(eq(taskClicks.publisherId, userId));
      const tasksCompleted = tasksCompletedResult[0]?.count || 0;

      // Invite requirement
      const withdrawalInviteRequirementEnabled = getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true';
      const MINIMUM_INVITES_FOR_WITHDRAWAL = parseInt(getSetting('minimum_invites_for_withdrawal', '3'));
      const friendsInvited = user.friendsInvited || 0;

      // 12-hour limit check (resets at 06:30 and 18:30 UTC)
      const maxWithdrawalsPerDay = parseInt(getSetting('max_withdrawals_per_day', '1'));
      const periodKey = getResetPeriod();
      const periodStart = getPeriodStart();

      const todayWithdrawals = await db
        .select({ count: sql<number>`count(*)` })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          gte(withdrawals.createdAt, periodStart),
          sql`LOWER(CAST(${withdrawals.status} AS TEXT)) != 'rejected'`
        ));
      const todayCount = Number(todayWithdrawals[0]?.count ?? 0);

      const canWithdraw =
        (!withdrawalAdRequirementEnabled || adsWatchedSinceLastWithdrawal >= MINIMUM_ADS_FOR_WITHDRAWAL) &&
        (!withdrawalTaskRequirementEnabled || tasksCompleted >= MINIMUM_TASKS_FOR_WITHDRAWAL) &&
        (!withdrawalInviteRequirementEnabled || friendsInvited >= MINIMUM_INVITES_FOR_WITHDRAWAL) &&
        (todayCount < maxWithdrawalsPerDay);

      res.json({
        adsWatchedSinceLastWithdrawal,
        canWithdraw,
        requiredAds: MINIMUM_ADS_FOR_WITHDRAWAL,
        adRequirementEnabled: withdrawalAdRequirementEnabled,
        tasksCompleted,
        requiredTasks: MINIMUM_TASKS_FOR_WITHDRAWAL,
        taskRequirementEnabled: withdrawalTaskRequirementEnabled,
        friendsInvited,
        requiredInvites: MINIMUM_INVITES_FOR_WITHDRAWAL,
        inviteRequirementEnabled: withdrawalInviteRequirementEnabled,
        todayWithdrawalCount: todayCount,
        maxWithdrawalsPerDay
      });
    } catch (error) {
      console.error("Error checking withdrawal eligibility:", error);
      res.status(500).json({ message: "Failed to check withdrawal eligibility" });
    }
  });

  // Search referral by code endpoint - auth removed to prevent popup spam on affiliates page
  app.get('/api/referrals/search/:code', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const currentUserId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!currentUserId) {
        console.log('⚠️ Referral search requested without session - skipping');
        return res.status(404).json({ message: "Referral not found", skipAuth: true });
      }
      const searchCode = req.params.code;

      // Find user by referral code
      const referralUser = await storage.getUserByReferralCode(searchCode);

      if (!referralUser) {
        return res.status(404).json({ message: "Referral not found" });
      }

      // Check if this referral belongs to the current user
      const referralRelationship = await storage.getReferralByUsers(currentUserId, referralUser.id);

      if (!referralRelationship) {
        return res.status(403).json({ message: "This referral does not belong to you" });
      }

      // Get referral stats
      const referralEarnings = await storage.getUserStats(referralUser.id);
      const referralCount = await storage.getUserReferrals(referralUser.id);

      res.json({
        id: searchCode,
        earnedToday: referralEarnings.todayEarnings || "0.00",
        allTime: referralUser.totalEarned || "0.00",
        invited: referralCount.length,
        joinedAt: referralRelationship.createdAt
      });
    } catch (error) {
      console.error("Error searching referral:", error);
      res.status(500).json({ message: "Failed to search referral" });
    }
  });

  // Earnings history endpoint
  app.get('/api/earnings', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const earnings = await storage.getUserEarnings(userId, limit);
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching earnings:", error);
      res.status(500).json({ message: "Failed to fetch earnings" });
    }
  });

  // Earnings chart data endpoint - returns daily totals grouped by date
  app.get('/api/earnings/chart', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const period = req.query.period as string || 'week';
      const days = period === 'month' ? 31 : period === '2weeks' ? 14 : 7;

      const result_raw = await db.execute(sql`
        SELECT
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'DD.MM') as date,
          (COALESCE(SUM(amount), 0) / 100000.0)::float as amount
        FROM earnings
        WHERE user_id = ${userId}
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC
      `);

      const rowsArr = Array.isArray(result_raw) ? result_raw : (result_raw as any).rows ?? [];
      const result = rowsArr.map((r: any) => ({
        date: r.date,
        amount: parseFloat(r.amount) || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching earnings chart:", error);
      res.status(500).json({ message: "Failed to fetch earnings chart" });
    }
  });

  // Referral earnings chart data endpoint
  app.get('/api/referrals/earnings/chart', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const period = req.query.period as string || 'week';
      const days = period === 'month' ? 31 : period === '2weeks' ? 14 : 7;

      const result_raw2 = await db.execute(sql`
        SELECT
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'DD.MM') as date,
          (COALESCE(SUM(amount), 0) / 100000.0)::float as amount
        FROM earnings
        WHERE user_id = ${userId}
          AND source IN ('referral', 'referral_commission', 'referral_commission_l2', 'referral_bonus')
          AND created_at >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY DATE(created_at AT TIME ZONE 'UTC') ASC
      `);

      const rowsArr2 = Array.isArray(result_raw2) ? result_raw2 : (result_raw2 as any).rows ?? [];
      const result = rowsArr2.map((r: any) => ({
        date: r.date,
        amount: parseFloat(r.amount) || 0,
      }));

      res.json(result);
    } catch (error) {
      console.error("Error fetching referral earnings chart:", error);
      res.status(500).json({ message: "Failed to fetch referral earnings chart" });
    }
  });





  // Debug endpoint for referral issues - auth removed to prevent popup spam
  app.get('/api/debug/referrals', authenticateAdmin, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log('⚠️ Debug referrals requested without session - sending empty response');
        return res.json({ success: true, skipAuth: true, data: {} });
      }

      // Get user info
      const user = await storage.getUser(userId);

      // Get all earnings for this user
      const userEarnings = await db
        .select()
        .from(earnings)
        .where(eq(earnings.userId, userId))
        .orderBy(desc(earnings.createdAt));

      // Get referrals where user is referrer
      const myReferrals = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

      // Get referrals where user is referee
      const referredBy = await db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeId, userId));

      res.json({
        user: {
          id: user?.id,
          referralCode: user?.referralCode,
          balance: user?.balance,
          totalEarned: user?.totalEarned
        },
        earnings: userEarnings,
        myReferrals: myReferrals,
        referredBy: referredBy,
        counts: {
          totalEarnings: userEarnings.length,
          referralEarnings: userEarnings.filter(e => e.source === 'referral').length,
          commissionEarnings: userEarnings.filter(e => e.source === 'referral_commission').length,
          adEarnings: userEarnings.filter(e => e.source === 'ad_watch').length
        }
      });
    } catch (error) {
      console.error("Debug referrals error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Production database fix endpoint - run once to fix referrals
  app.post('/api/fix-production-referrals', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('🔧 Fixing production referral system...');

      // 1. Update existing referral bonuses from $0.50 to $0.01
      console.log('📝 Updating referral bonus amounts...');
      await db.execute(sql`
        UPDATE ${earnings}
        SET amount = '0.01',
            description = REPLACE(description, '$0.50', '$0.01')
        WHERE source = 'referral'
        AND amount = '0.50'
      `);

      // 2. Ensure referrals table has correct default
      console.log('🔧 Updating referrals table...');
      await db.execute(sql`
        ALTER TABLE ${referrals}
        ALTER COLUMN reward_amount SET DEFAULT 0.01
      `);

      // 3. Update existing pending referrals to new amount
      await db.execute(sql`
        UPDATE ${referrals}
        SET reward_amount = '0.01'
        WHERE reward_amount = '0.50'
      `);

      // 4. Generate referral codes for users who don't have them
      console.log('🔑 Generating missing referral codes...');
      const usersWithoutCodes = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.referralCode} IS NULL OR ${users.referralCode} = ''`);

      for (const user of usersWithoutCodes) {
        const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db
          .update(users)
          .set({ referralCode })
          .where(eq(users.id, user.id));
      }

      // 5. Get stats for response
      const totalReferralEarnings = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(eq(earnings.source, 'referral'));

      const totalReferrals = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);

      console.log('✅ Production referral system fixed successfully!');

      res.json({
        success: true,
        message: 'Production referral system fixed successfully!',
        changes: {
          updatedReferralBonuses: 'Changed from $0.50 to $0.01',
          totalReferralEarnings: totalReferralEarnings[0]?.total || '0',
          totalReferrals: totalReferrals[0]?.count || 0,
          generatedReferralCodes: usersWithoutCodes.length
        }
      });

    } catch (error) {
      console.error('❌ Error fixing production referrals:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });


  // Get user's daily tasks (new system) - DISABLED
  app.get('/api/tasks/daily', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;

      // Get user's current ads count
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const adsWatchedToday = user?.adsWatchedToday || 0;

      // Get daily tasks
      const tasks = await storage.getUserDailyTasks(userId);

      res.json({
        success: true,
        tasks: tasks.map(task => ({
          id: task.id,
          level: task.taskLevel,
          title: `Watch ${task.required} ads`,
          description: `Watch ${task.required} ads to earn ${parseFloat(task.rewardAmount).toFixed(5)} TON`,
          required: task.required,
          progress: task.progress,
          completed: task.completed,
          claimed: task.claimed,
          rewardAmount: task.rewardAmount,
          canClaim: task.completed && !task.claimed,
        })),
        adsWatchedToday,
        resetInfo: {
          nextReset: "00:00 UTC",
          resetDate: new Date().toISOString().split('T')[0]
        }
      });

    } catch (error) {
      console.error('Error fetching daily tasks:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch daily tasks'
      });
    }
  });

  // Claim a task reward
  app.post('/api/tasks/claim/:taskLevel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const taskLevel = parseInt(req.params.taskLevel);

      if (!taskLevel || taskLevel < 1 || taskLevel > 9) {
        return res.status(400).json({
          success: false,
          message: 'Invalid task level'
        });
      }

      const result = await storage.claimDailyTaskReward(userId, taskLevel);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          rewardAmount: result.rewardAmount
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }

    } catch (error) {
      console.error('Error claiming task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to claim task reward'
      });
    }
  });

  // Get daily task completion status
  app.get('/api/tasks/daily/status', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.json({ success: true, completedTasks: [] });
      }

      const [user] = await db
        .select({
          taskShareCompleted: users.taskShareCompletedToday,
          taskChannelCompleted: users.taskChannelCompletedToday,
          taskCommunityCompleted: users.taskCommunityCompletedToday,
          lastStreakDate: users.lastStreakDate,
          gigapubShortLink1Claimed: users.gigapubShortLink1Claimed,
          gigapubShortLink2Claimed: users.gigapubShortLink2Claimed,
          gigapubShortLink3Claimed: users.gigapubShortLink3Claimed,
        })
        .from(users)
        .where(eq(users.id, userId));

      const completedTasks = [];
      if (user?.taskShareCompleted) completedTasks.push('share-friends');
      if (user?.taskChannelCompleted) completedTasks.push('check-updates');
      if (user?.taskCommunityCompleted) completedTasks.push('join-community');

      if (user?.lastStreakDate) {
        const lastClaim = new Date(user.lastStreakDate);
        const hoursSinceLastClaim = (new Date().getTime() - lastClaim.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastClaim < 24) {
          completedTasks.push('claim-streak');
        }
      }

      if (user?.gigapubShortLink1Claimed) completedTasks.push('gigapub-short-link-1');
      if (user?.gigapubShortLink2Claimed) completedTasks.push('gigapub-short-link-2');
      if (user?.gigapubShortLink3Claimed) completedTasks.push('gigapub-short-link-3');

      res.json({
        success: true,
        completedTasks
      });

    } catch (error) {
      console.error('Error fetching task status:', error);
      res.json({ success: true, completedTasks: [] });
    }
  });

  // Gigapub short-link tasks. The server records the start time so the client
  // cannot claim immediately by skipping its visible countdown.
  const GIGAPUB_SHORT_LINKS = [
    'https://link.gigapub.tech/l/c8hd9h0d7',
    'https://link.gigapub.tech/l/9ttyplb0va',
    'https://link.gigapub.tech/l/vkcp91if6',
  ] as const;
  const GIGAPUB_SHORT_LINK_REWARD = '50';

  app.post('/api/tasks/gigapub-short-link/start', authenticateTelegram, taskRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const taskId = Number(req.body?.taskId);
      if (!userId || !Number.isInteger(taskId) || taskId < 1 || taskId > 3) {
        return res.status(400).json({ success: false, message: 'Invalid Gigapub task' });
      }

      const claimedColumn = [users.gigapubShortLink1Claimed, users.gigapubShortLink2Claimed, users.gigapubShortLink3Claimed][taskId - 1];
      const [user] = await db.select({ claimed: claimedColumn }).from(users).where(eq(users.id, userId));
      if (user?.claimed) return res.status(400).json({ success: false, message: 'Task already completed' });

      await db.update(users).set({ gigapubShortLinkStartedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      res.json({ success: true, url: GIGAPUB_SHORT_LINKS[taskId - 1] });
    } catch (error) {
      console.error('Error starting Gigapub short-link task:', error);
      res.status(500).json({ success: false, message: 'Failed to start task' });
    }
  });

  app.post('/api/tasks/gigapub-short-link/claim', authenticateTelegram, taskRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const taskId = Number(req.body?.taskId);
      if (!userId || !Number.isInteger(taskId) || taskId < 1 || taskId > 3) {
        return res.status(400).json({ success: false, message: 'Invalid Gigapub task' });
      }

      const claimedColumn = [users.gigapubShortLink1Claimed, users.gigapubShortLink2Claimed, users.gigapubShortLink3Claimed][taskId - 1];
      const [user] = await db.select({ claimed: claimedColumn, startedAt: users.gigapubShortLinkStartedAt }).from(users).where(eq(users.id, userId));
      if (user?.claimed) return res.status(400).json({ success: false, message: 'Task already completed' });
      if (!user?.startedAt || Date.now() - new Date(user.startedAt).getTime() < 3_000) {
        return res.status(400).json({ success: false, message: 'Please stay on the Gigapub page for at least 3 seconds' });
      }

      const claimUpdate = [
        { gigapubShortLink1Claimed: true },
        { gigapubShortLink2Claimed: true },
        { gigapubShortLink3Claimed: true },
      ][taskId - 1];
      const result = await db.transaction(async (tx) => {
        const updated = await tx.update(users).set({ ...claimUpdate, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(claimedColumn, false))).returning({ id: users.id });
        if (updated.length === 0) return false;
        await tx.update(users).set({ balance: sql`${users.balance} + ${GIGAPUB_SHORT_LINK_REWARD}::numeric` }).where(eq(users.id, userId));
        await tx.insert(earnings).values({ userId, amount: GIGAPUB_SHORT_LINK_REWARD, source: 'gigapub_short_link', description: `Gigapub short-link task ${taskId} completed`, currency: 'GOLD' });
        return true;
      });
      if (!result) return res.status(400).json({ success: false, message: 'Task already completed' });
      res.json({ success: true, reward: Number(GIGAPUB_SHORT_LINK_REWARD), message: 'Gigapub task completed' });
    } catch (error) {
      console.error('Error claiming Gigapub short-link task:', error);
      res.status(500).json({ success: false, message: 'Failed to claim task' });
    }
  });

  // Unified home tasks API - shows ONLY advertiser/user-created tasks (no daily tasks)
  // Uses getActiveTasksForUser - same data source as Mission page (/api/advertiser-tasks)
  app.get('/api/tasks/home/unified', async (req: any, res) => {
    try {
      let userId = req.session?.user?.user?.id || req.user?.user?.id;

      // In development mode, use test user if no session
      if (!userId && process.env.NODE_ENV === 'development') {
        userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      }

      if (!userId) {
        return res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
      }

      // Get user info for referral code
      const [user] = await db
        .select({
          referralCode: users.referralCode
        })
        .from(users)
        .where(eq(users.id, userId));

      // Get reward settings using the SAME keys that recordTaskClick (payout) uses.
      // Display must mirror payout exactly: partner → partner_task_reward,
      // verificationRequired → task_reward_with_verify, else → task_reward_no_verify.
      // (The old code read channel_task_reward / bot_task_reward which are legacy keys
      //  not updated by the admin panel, causing a display/payout mismatch.)
      const partnerTaskReward    = await storage.getAppSetting('partner_task_reward',    '200');
      const taskRewardWithVerify = await storage.getAppSetting('task_reward_with_verify','500');
      const taskRewardNoVerify   = await storage.getAppSetting('task_reward_no_verify',  '100');
      // Get ALL approved public tasks (admin-created AND user-created after admin approval)
      // Task eligibility: status = 'running' (approved/active), user hasn't completed, not their own task
      const advertiserTasks = await storage.getActiveTasksForUser(userId);

      // Format advertiser tasks — reward calculation mirrors recordTaskClick exactly
      const formattedTasks = advertiserTasks.map(task => {
        let rewardGems = 0;
        if (task.taskType === 'partner') {
          rewardGems = parseInt(partnerTaskReward);
        } else if (task.verificationRequired) {
          rewardGems = parseInt(taskRewardWithVerify);
        } else {
          rewardGems = parseInt(taskRewardNoVerify);
        }

        return {
          id: task.id,
          type: 'advertiser',
          taskType: task.taskType,
          title: task.title,
          link: task.link,
          verificationRequired: task.verificationRequired,
          rewardGold: rewardGems,
          rewardGems,
          rewardSTAR: 0,
          rewardType: 'Gold',
          currentClicks: task.currentClicks ?? 0,
          totalClicksRequired: task.totalClicksRequired ?? 0,
          isAdminTask: false,
          isAdvertiserTask: true,
          priority: 1
        };
      });

      res.json({
        success: true,
        tasks: formattedTasks,
        completedTaskIds: [],
        referralCode: user?.referralCode,
        totalAvailableTasks: formattedTasks.length
      });

    } catch (error) {
      console.error('Error fetching unified home tasks:', error);
      res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
    }
  });

  // New simplified task completion endpoints with daily tracking
  app.post('/api/tasks/complete/share', authenticateTelegram, taskRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }

      // Check if already completed today
      const [user] = await db
        .select({ taskShareCompletedToday: users.taskShareCompletedToday })
        .from(users)
        .where(eq(users.id, userId));

      if (user?.taskShareCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }

      // Reward: 0.0001 TON = 1,000 Gems
      const rewardAmount = '0.0001';

      await db.transaction(async (tx) => {
        // Update balance and mark task complete — no star reward from tasks
        await tx.execute(sql`
          UPDATE users SET
            balance                    = balance + ${rewardAmount}::numeric,
            task_share_completed_today = true,
            updated_at                 = NOW()
          WHERE id = ${userId}
        `);

        // Add earning record
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_share',
          description: 'Share with Friends task completed'
        });
      });

      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });

    } catch (error) {
      console.error('Error completing share task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Send rich share message with photo + caption + inline WebApp button
  app.post('/api/share/send-rich-message', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get user data to find telegram ID and referral code
      const [user] = await db
        .select({
          telegramId: users.telegram_id,
          referralCode: users.referralCode
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user || !user.telegramId) {
        return res.status(400).json({
          success: false,
          message: 'Telegram ID not found for user'
        });
      }

      if (!user.referralCode) {
        return res.status(400).json({
          success: false,
          message: 'Referral code not found for user'
        });
      }

      // Get app URL for WebApp button
      const appUrl = process.env.RENDER_EXTERNAL_URL ||
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';

      // Build the referral URL - bot username fetched live from Telegram Bot API
      const { getBotUsername: getBotUsernameForShare } = await import('./telegram');
      const botUsername = await getBotUsernameForShare();
      const webAppUrl = `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`;

      // Get share banner image URL
      const shareImageUrl = `${appUrl}/images/axionet-share-banner.png?v=axionet`;

      // Caption for the share message
      const caption = '💵 Join Axionet and earn TON just by Mining & completing tasks!';

      // Send the photo message with inline button
      const result = await sendSharePhotoToChat(
        user.telegramId,
        shareImageUrl,
        caption,
        webAppUrl,
        '🚀 Start Earning'
      );

      if (result.success) {
        res.json({
          success: true,
          message: 'Share message sent! You can now forward it to friends.',
          messageId: result.messageId
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error || 'Failed to send share message'
        });
      }

    } catch (error: any) {
      console.error('Error sending rich share message:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send share message'
      });
    }
  });

  app.post('/api/tasks/complete/channel', authenticateTelegram, taskRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();

      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }

      // Check if already completed today
      const [user] = await db
        .select({ taskChannelCompletedToday: users.taskChannelCompletedToday })
        .from(users)
        .where(eq(users.id, userId));

      if (user?.taskChannelCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }

      // MANDATORY: VERIFY CHANNEL MEMBERSHIP BEFORE GIVING REWARD
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken || !telegramUserId) {
        console.error('❌ Channel task claim rejected: Missing bot token or telegram user ID');
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }

      // ALWAYS verify membership - no exceptions
      // verifyChannelMembership handles the actual Telegram API check
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId),
        config.telegram.channelId,
        botToken
      );

      if (!isMember) {
        console.log(`❌ User ${telegramUserId} tried to claim channel task but is not a member (verified via API)`);
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram channel ${config.telegram.channelUrl || config.telegram.channelId} first to complete this task`,
          requiresChannelJoin: true,
          channelUsername: config.telegram.channelId,
          channelUrl: config.telegram.channelUrl
        });
      }

      // Reward: 0.0001 TON = 1,000 Gems
      const rewardAmount = '0.0001';

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE users SET
            balance                      = balance + ${rewardAmount}::numeric,
            task_channel_completed_today = true,
            updated_at                   = NOW()
          WHERE id = ${userId}
        `);

        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_channel',
          description: 'Check for Updates task completed'
        });
      });

      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });

    } catch (error) {
      console.error('Error completing channel task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Verify a user is a member of an advertiser channel task
  app.post('/api/tasks/verify-channel-membership', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUserId = req.user?.telegramUser?.id || req.session?.user?.telegramUser?.id;
      const { channelUsername } = req.body;

      if (!channelUsername) {
        return res.status(400).json({ success: false, message: 'Channel link required' });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        // Dev mode: assume membership
        return res.json({ success: true, verified: true, message: 'Dev mode: membership assumed' });
      }

      if (!telegramUserId) {
        return res.status(401).json({ success: false, message: 'Could not identify Telegram user' });
      }

      // Extract public channel username from URL; reject private invite links (+hash)
      let channelId = channelUsername.trim();
      const urlMatch = channelId.match(/t\.me\/([^/?]+)/);
      if (urlMatch && urlMatch[1]) {
        const segment = urlMatch[1];
        if (segment.startsWith('+') || segment.startsWith('joinchat')) {
          return res.status(400).json({ success: false, message: 'Private invite links cannot be verified. Use a public channel username link.' });
        }
        channelId = `@${segment}`;
      } else if (!channelId.startsWith('@')) {
        channelId = `@${channelId}`;
      }

      // Validate that the resulting identifier looks like a Telegram username
      if (!/^@[A-Za-z][A-Za-z0-9_]{2,31}$/.test(channelId)) {
        return res.status(400).json({ success: false, message: 'Invalid channel username format. Provide a public channel link like https://t.me/YourChannel.' });
      }

      const isMember = await verifyChannelMembership(
        parseInt(String(telegramUserId)),
        channelId,
        botToken
      );

      if (isMember) {
        return res.json({ success: true, verified: true, message: 'Membership verified' });
      } else {
        return res.json({
          success: false, verified: false,
          message: "You haven't joined the channel yet. Please join and try again."
        });
      }
    } catch (error) {
      console.error('Error verifying channel membership:', error);
      res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
    }
  });

  // Check and apply channel-leave penalties (24-hour rejoin window)
  app.post('/api/tasks/check-channel-penalties', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id || req.session?.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id || req.session?.user?.telegramUser?.id;
      if (!userId || !telegramUserId) return res.json({ success: true, penaltiesApplied: 0 });
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.json({ success: true, penaltiesApplied: 0 });

      const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Find verified channel tasks completed by this user in last 24 h
      const completedTasks = await db
        .select({ taskId: taskClicks.taskId, rewardAmount: taskClicks.rewardAmount,
                  clickedAt: taskClicks.clickedAt, link: advertiserTasks.link })
        .from(taskClicks)
        .innerJoin(advertiserTasks, eq(taskClicks.taskId, advertiserTasks.id))
        .where(and(
          eq(taskClicks.publisherId, userId),
          eq(advertiserTasks.taskType, 'channel'),
          eq(advertiserTasks.verificationRequired, true),
          sql`${taskClicks.clickedAt} > ${cutoff24h}`
        ));

      // Delegate to the same processPenaltyCase state machine the scheduled
      // poller uses (watching → suspected → penalized → resolved/permanent,
      // with two-strike confirmation and atomic WHERE-status-guarded
      // transitions). Reimplementing this logic separately here is what
      // previously let this route and the poller race on the same case —
      // e.g. both deducting a penalty, or one crediting a restore the other
      // had already applied — which could surface to the user as a false
      // "Unsubscribed" penalty or an error on the Restore button.
      const { processPenaltyCase } = await import('./telegram');
      let penaltiesApplied = 0;

      for (const task of completedTasks) {
        let channelId = task.link?.trim() || '';
        const m = channelId.match(/t\.me\/([^/?]+)/);
        if (m) channelId = `@${m[1]}`;

        try {
          // Ensure a case exists for this completed task (mirrors the
          // poller's seeding step) so processPenaltyCase has something to act on.
          const existing = await db.select({ id: channelPenaltyCases.id, status: channelPenaltyCases.status })
            .from(channelPenaltyCases)
            .where(and(eq(channelPenaltyCases.userId, userId), eq(channelPenaltyCases.taskId, task.taskId)))
            .limit(1);

          let caseId: string;
          if (existing.length) {
            caseId = existing[0].id;
          } else {
            const originalReward = parseInt(task.rewardAmount || '0');
            const [inserted] = await db.insert(channelPenaltyCases).values({
              userId, telegramId: String(telegramUserId),
              taskId: task.taskId, channelId, channelLink: task.link || '',
              originalReward, penaltyDeducted: 0,
              claimedAt: task.clickedAt || new Date(), status: 'watching',
            }).onConflictDoNothing().returning({ id: channelPenaltyCases.id });
            if (!inserted) continue; // lost the insert race — another process already seeded it
            caseId = inserted.id;
          }

          const statusBefore = existing.length ? existing[0].status : 'watching';
          await processPenaltyCase(caseId, botToken);
          if (statusBefore !== 'penalized') {
            const [after] = await db.select({ status: channelPenaltyCases.status }).from(channelPenaltyCases)
              .where(eq(channelPenaltyCases.id, caseId)).limit(1);
            if (after?.status === 'penalized') penaltiesApplied++;
          }
        } catch (e) {
          console.warn(`Could not check membership for task ${task.taskId}:`, e);
        }
      }

      res.json({ success: true, penaltiesApplied });
    } catch (error) {
      console.error('Error checking channel penalties:', error);
      res.status(500).json({ success: false, message: 'Penalty check failed' });
    }
  });

  app.post('/api/tasks/complete/community', authenticateTelegram, taskRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();

      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }

      // Check if already completed today
      const [user] = await db
        .select({ taskCommunityCompletedToday: users.taskCommunityCompletedToday })
        .from(users)
        .where(eq(users.id, userId));

      if (user?.taskCommunityCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }

      // MANDATORY: VERIFY GROUP/COMMUNITY MEMBERSHIP BEFORE GIVING REWARD
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken || !telegramUserId) {
        console.error('❌ Community task claim rejected: Missing bot token or telegram user ID');
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }

      // ALWAYS verify membership - no exceptions
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId),
        config.telegram.groupId,
        botToken
      );

      if (!isMember) {
        console.log(`❌ User ${telegramUserId} tried to claim community task but is not a member (verified via API)`);
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram group ${config.telegram.groupUrl || config.telegram.groupId} first to complete this task`,
          requiresGroupJoin: true,
          groupUsername: config.telegram.groupId,
          groupUrl: config.telegram.groupUrl
        });
      }

      // Reward: 0.0001 TON = 1,000 Gems
      const rewardAmount = '0.0001';

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE users SET
            balance                        = balance + ${rewardAmount}::numeric,
            task_community_completed_today = true,
            updated_at                     = NOW()
          WHERE id = ${userId}
        `);

        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_community',
          description: 'Join Community task completed'
        });
      });

      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });

    } catch (error) {
      console.error('Error completing community task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Old task system removed - using daily tasks system only

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;

      // Fallback daily tasks when the task DB is not configured yet — values
      // are read from environment variables (TELEGRAM_CHANNEL_LINK / BOT_USERNAME),
      // never hardcoded to a specific channel.
      const fallbackTimestamp = new Date('2025-09-18T11:15:16.000Z');
      const fallbackChannelLink = process.env.TELEGRAM_CHANNEL_LINK || '';
      const fallbackChannelUsername = (fallbackChannelLink.replace(/https?:\/\//, '').replace(/t\.me\//, '').replace('/', '').replace(/^@/, '')) || (process.env.BOT_USERNAME || '').replace('@', '');

      const hardcodedDailyTasks = [
        {
          id: 'channel-visit-check-update',
          type: 'channel_visit',
          title: 'Channel visit (Check Update)',
          description: 'Visit our Telegram channel for updates and news',
          rewardPerUser: '0.00015000', // 8-decimal format to match live API
          url: fallbackChannelLink || 'https://t.me/',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'app-link-share',
          type: 'share_link',
          title: 'App link share (Share link)',
          description: 'Share your affiliate link with friends',
          rewardPerUser: '0.00020000', // 8-decimal format to match live API
          url: 'share://referral',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'invite-friend-valid',
          type: 'invite_friend',
          title: 'Invite friend (valid)',
          description: 'Invite 1 valid friend to earn rewards',
          rewardPerUser: '0.00050000', // 8-decimal format to match live API
          url: 'invite://friend',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-mini',
          type: 'ads_goal_mini',
          title: 'Mini (Watch 15 ads)',
          description: 'Watch 15 ads to complete this daily goal',
          rewardPerUser: '0.00045000', // 8-decimal format to match live API
          url: 'watch://ads/mini',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-light',
          type: 'ads_goal_light',
          title: 'Light (Watch 25 ads)',
          description: 'Watch 25 ads to complete this daily goal',
          rewardPerUser: '0.00060000', // 8-decimal format to match live API
          url: 'watch://ads/light',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-medium',
          type: 'ads_goal_medium',
          title: 'Medium (Watch 45 ads)',
          description: 'Watch 45 ads to complete this daily goal',
          rewardPerUser: '0.00070000', // 8-decimal format to match live API
          url: 'watch://ads/medium',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-hard',
          type: 'ads_goal_hard',
          title: 'Hard (Watch 75 ads)',
          description: 'Watch 75 ads to complete this daily goal',
          rewardPerUser: '0.00080000', // 8-decimal format to match live API
          url: 'watch://ads/hard',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        }
      ];

      // Get active promotions from database (if any) - only show approved promotions
      let activeTasks: any[] = [];
      try {
        activeTasks = await db
          .select({
            id: promotions.id,
            type: promotions.type,
            url: promotions.url,
            rewardPerUser: promotions.rewardPerUser,
            limit: promotions.limit,
            claimedCount: promotions.claimedCount,
            title: promotions.title,
            description: promotions.description,
            channelMessageId: promotions.channelMessageId,
            createdAt: promotions.createdAt
          })
          .from(promotions)
          .where(and(
            eq(promotions.status, 'active'),
            eq(promotions.isApproved, true), // Only show admin-approved promotions
            sql`${promotions.claimedCount} < ${promotions.limit}`
          ))
          .orderBy(desc(promotions.createdAt));
      } catch (dbError) {
        console.log('⚠️ Database query failed, using hardcoded tasks only:', dbError);
        activeTasks = [];
      }

      // Use hardcoded tasks only if database has no active tasks
      let allTasks = [];

      if (activeTasks.length === 0) {
        console.log('🔄 Database empty, using hardcoded daily tasks fallback');
        allTasks = hardcodedDailyTasks;
      } else {
        allTasks = activeTasks;
      }

      // Check which tasks user has already completed
      const completedIds = new Set<string>();

      // Calculate current task date using 18:30 UTC (12:00 AM IST) reset logic
      const getCurrentTaskDate = (): string => {
        const now = new Date();
        // If current time is before 18:30 UTC, use yesterday's date
        if (now.getUTCHours() < 18 || (now.getUTCHours() === 18 && now.getUTCMinutes() < 30)) {
          now.setUTCDate(now.getUTCDate() - 1);
        }
        return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
      };

      const currentTaskDate = getCurrentTaskDate();

      // Query non-daily task completions from taskCompletions table
      try {
        const nonDailyCompletions = await db
          .select({ promotionId: taskCompletions.promotionId })
          .from(taskCompletions)
          .where(eq(taskCompletions.userId, userId));

        // Add non-daily completed tasks (permanently hidden)
        for (const completion of nonDailyCompletions) {
          const task = allTasks.find(t => t.id === completion.promotionId);
          const isDailyTask = task && ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard', 'daily'].includes(task.type);

          if (!isDailyTask) {
            // Only add non-daily tasks to completed set
            completedIds.add(completion.promotionId);
          }
        }
      } catch (dbError) {
        console.log('⚠️ Task completions query failed, continuing without completion check:', dbError);
      }

      // Query daily task completions from dailyTasks table for today only
      try {
        const dailyCompletions = await db
          .select({ promotionId: dailyTasks.id })
          .from(dailyTasks)
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.resetDate, currentTaskDate)
          ));

        // Add daily completed tasks (hidden until tomorrow's reset at 12:00 PM UTC)
        for (const completion of dailyCompletions) {
          completedIds.add(String(completion.promotionId));
        }
      } catch (dbError) {
        console.log('⚠️ Daily task completions query failed, continuing without daily completion check:', dbError);
      }

      // Filter out completed tasks and generate proper task links
      const availableTasks = allTasks
        .filter(task => !completedIds.has(task.id))
        .map(task => {
          // Extract username from URL for link generation
          const urlMatch = task.url?.match(/t\.me\/([^/?]+)/);
          const username = urlMatch ? urlMatch[1] : null;

          let channelPostUrl = null;
          let claimUrl = null;

          if (task.type === 'channel' && username) {
            // Use channel message ID if available, otherwise fallback to channel URL
            if (task.channelMessageId) {
              channelPostUrl = `https://t.me/${username}/${task.channelMessageId}`;
            } else {
              channelPostUrl = `https://t.me/${username}`;
            }
            claimUrl = channelPostUrl;
          } else if (task.type === 'bot' && username) {
            // Bot deep link with task ID
            claimUrl = `https://t.me/${username}?start=task_${task.id}`;
          } else if (task.type === 'daily' && username) {
            // Daily task using channel link
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'channel_visit' && username) {
            // Channel visit task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'share_link' && username) {
            // Share link task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'invite_friend' && username) {
            // Invite friend task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type.startsWith('ads_goal_')) {
            // Ads goal tasks don't need external URLs
            claimUrl = 'internal://ads-goal';
          }

          return {
            ...task,
            reward: task.rewardPerUser, // Map rewardPerUser to reward for frontend compatibility
            channelPostUrl,
            claimUrl,
            username // Include username for mobile fallback
          };
        });

      res.json({
        success: true,
        tasks: availableTasks,
        total: availableTasks.length
      });
    } catch (error) {
            console.error('❌ Error fetching tasks:', error);
      // Fallback: Return empty task list when the query fails (all tasks are DB-driven, no hardcoding)
      const hardcodedDailyTasks: any[] = [];
      const fallbackChannelUsername = '';
      const fallbackDailyTasks = hardcodedDailyTasks.map(task => ({
        ...task,
        reward: task.rewardPerUser, // Map rewardPerUser to reward for frontend compatibility
        channelPostUrl: task.type === 'channel_visit' ? task.url : null,
        claimUrl: task.type === 'channel_visit' ? task.url :
                  task.type.startsWith('ads_goal_') ? null : task.url,
        username: task.type === 'channel_visit' ? fallbackChannelUsername : null
      }));

      res.json({
        success: true,
        tasks: fallbackDailyTasks,
        total: fallbackDailyTasks.length
      });
    }
  });


  // CRITICAL: Public referral data repair endpoint (no auth needed for emergency fix)
  app.post('/api/emergency-fix-referrals', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('🚨 EMERGENCY: Running referral data repair...');

      // Step 1: Run the referral data synchronization
      await storage.fixExistingReferralData();

      // Step 2: Ensure all users have referral codes
      await storage.ensureAllUsersHaveReferralCodes();

      // Step 3: Sync friendsInvited counts from database for withdrawal unlock
      await storage.syncFriendsInvitedCounts();

      // Step 4: Get repair summary
      const totalReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);

      const completedReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'completed'));

      const totalReferralEarningsResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(sql`${earnings.source} IN ('referral', 'referral_commission')`);

      console.log('✅ Emergency referral repair completed successfully!');

      res.json({
        success: true,
        message: 'Emergency referral data repair completed successfully! Your friendsInvited count has been synced for withdrawal unlock.',
        summary: {
          totalReferrals: totalReferralsResult[0]?.count || 0,
          completedReferrals: completedReferralsResult[0]?.count || 0,
          totalReferralEarnings: totalReferralEarningsResult[0]?.total || '0',
          message: 'All missing referral data has been restored. Check your app now!'
        }
      });
    } catch (error) {
      console.error('❌ Error in emergency referral repair:', error);
      res.status(500).json({
        success: false,
        message: 'Emergency repair failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Admin routes



  // Setup webhook endpoint (call this once to register with Telegram)
  app.post('/api/telegram/setup-webhook', async (req: any, res) => {
    try {
      const { webhookUrl } = req.body;

      if (!webhookUrl) {
        return res.status(400).json({ message: 'Webhook URL is required' });
      }

      const success = await setupTelegramWebhook(webhookUrl);

      if (success) {
        res.json({ success: true, message: 'Webhook set up successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to set up webhook' });
      }
    } catch (error) {
      console.error('Setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // One-time production database fix endpoint
  app.get('/api/fix-production-db', authenticateAdmin, async (req: any, res) => {
    try {
      // @ts-ignore - fix-production-db.js is a runtime-only helper with no type declarations
      const { fixProductionDatabase } = await import('../server/fix-production-db.js');
      console.log('🔧 Running production database fix...');
      await fixProductionDatabase();
      res.json({
        success: true,
        message: 'Production database fixed successfully! Your app should work now.',
        instructions: 'Try using your Telegram bot - it should now send messages properly!'
      });
    } catch (error) {
      console.error('Fix production DB error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Database fix failed. Check the logs for details.'
      });
    }
  });

  // Auto-setup webhook endpoint (automatically determines URL)
  app.get('/api/telegram/auto-setup', authenticateAdmin, async (req: any, res) => {
    try {
      // Get the current domain from the request
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

      console.log('Setting up Telegram webhook:', webhookUrl);

      const success = await setupTelegramWebhook(webhookUrl);

      if (success) {
        res.json({
          success: true,
          message: 'Webhook set up successfully',
          webhookUrl
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Failed to set up webhook',
          webhookUrl
        });
      }
    } catch (error) {
      console.error('Auto-setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Test endpoint removed - bot uses inline buttons only
  app.get('/api/telegram/test/:chatId', async (req: any, res) => {
    res.json({
      success: false,
      message: 'Test endpoint removed - bot uses inline buttons only'
    });
  });

  // Admin identity check — returns whether the current user is an admin
  // Checks: SUPER_ADMIN_ID/TELEGRAM_ADMIN_ID env → TELEGRAM_ADMIN_IDS env → DB admin_roles table
  // Returns: { isAdmin, role, permissions, name }
  app.get('/api/admin/check', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      const user = await storage.getUser(userId);
      const telegramId = user?.telegram_id || '';
      const devStatus = process.env.NODE_ENV === 'development' && !!process.env.DEV_ADMIN_ID && telegramId === process.env.DEV_ADMIN_ID;

      // Check env vars + DB (isAdminAsync covers both)
      const adminStatus = devStatus || await isAdminAsync(telegramId);
      if (!adminStatus) {
        return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      }

      const roleInfo = await getAdminRole(telegramId);
      if (!roleInfo && !devStatus) {
        return res.json({ isAdmin: false, role: null, permissions: [], name: null });
      }
      return res.json({
        isAdmin: true,
        role: roleInfo?.role ?? 'super_admin',
        permissions: roleInfo?.permissions ?? ALL_PERMISSIONS,
        name: roleInfo?.name ?? 'Admin',
      });
    } catch {
      return res.json({ isAdmin: false, role: null, permissions: [], name: null });
    }
  });

  // --- Admin Role Management ---

  // List all admins (super admin first, then sub-admins from TELEGRAM_ADMIN_IDS + DB)
  app.get('/api/admin/admins', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      // The one true super admin (TELEGRAM_ADMIN_ID or SUPER_ADMIN_ID)
      const superAdminId = (process.env.TELEGRAM_ADMIN_ID || process.env.SUPER_ADMIN_ID || '').trim();

      // Sub-admins from TELEGRAM_ADMIN_IDS env var
      const subAdminEnvIds = (process.env.TELEGRAM_ADMIN_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);

      // DB admin records
      const dbRecords = await db.select().from(adminRoles).orderBy(adminRoles.createdAt);
      const dbById = new Map(dbRecords.map(r => [r.telegramId, r]));

      const list: any[] = [];

      // 1. Super admin entry (always first, always super_admin role)
      if (superAdminId) {
        const rec = dbById.get(superAdminId);
        list.push({
          telegramId: superAdminId,
          name: rec?.name || 'Super Admin',
          role: 'super_admin',
          permissions: ALL_PERMISSIONS,
          addedBy: null,
          isSuperAdmin: true,
          isPrimary: true,
          createdAt: rec?.createdAt || null,
        });
      }

      // 2. Sub-admins from TELEGRAM_ADMIN_IDS env var
      subAdminEnvIds.forEach(id => {
        if (id === superAdminId) return; // skip if same as super admin
        const rec = dbById.get(id);
        let perms: string[] = [];
        try { perms = JSON.parse(rec?.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[rec?.role || 'moderator'] || []; }
        list.push({
          telegramId: id,
          name: rec?.name || 'Admin',
          role: rec?.role || 'moderator',
          permissions: perms,
          addedBy: rec?.addedBy || null,
          isSuperAdmin: false,
          isPrimary: true,
          createdAt: rec?.createdAt || null,
        });
      });

      // 3. DB-only admins (added via admin panel by super admin)
      dbRecords.forEach(rec => {
        if (rec.telegramId === superAdminId) return; // already listed
        if (subAdminEnvIds.includes(rec.telegramId)) return; // already listed
        let perms: string[] = [];
        try { perms = JSON.parse(rec.permissions || '[]'); } catch { perms = ROLE_DEFAULT_PERMISSIONS[rec.role] || []; }
        list.push({
          telegramId: rec.telegramId,
          name: rec.name || 'Admin',
          role: rec.role,
          permissions: perms,
          addedBy: rec.addedBy || null,
          isSuperAdmin: false,
          isPrimary: false,
          createdAt: rec.createdAt || null,
        });
      });

      res.json({ admins: list });
    } catch (error) {
      console.error('Error listing admins:', error);
      res.status(500).json({ message: 'Failed to list admins' });
    }
  });

  // Add or update an admin
  app.post('/api/admin/admins', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      const { telegramId, name, role, permissions } = req.body;
      if (!telegramId || !role) {
        return res.status(400).json({ message: 'telegramId and role are required' });
      }
      if (!['super_admin', 'finance', 'moderator', 'content'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }

      const permsToSave = Array.isArray(permissions)
        ? permissions
        : (ROLE_DEFAULT_PERMISSIONS[role] || []);

      await db.insert(adminRoles).values({
        telegramId: telegramId.toString(),
        name: name || 'Admin',
        role,
        permissions: JSON.stringify(permsToSave),
        addedBy: callerTelegramId,
      }).onConflictDoUpdate({
        target: adminRoles.telegramId,
        set: {
          name: name || 'Admin',
          role,
          permissions: JSON.stringify(permsToSave),
          updatedAt: new Date(),
        }
      });

      res.json({ success: true, message: 'Admin saved' });
    } catch (error) {
      console.error('Error saving admin:', error);
      res.status(500).json({ message: 'Failed to save admin' });
    }
  });

  // Remove an admin from DB (only DB-added admins can be removed; env admins just get reset to super_admin)
  app.delete('/api/admin/admins/:telegramId', authenticateAdmin, async (req: any, res) => {
    try {
      const callerTelegramId = req.user?.telegramUser?.id?.toString() || '';
      const callerRole = await getAdminRole(callerTelegramId);
      if (!callerRole?.permissions.includes('manage_admins')) {
        return res.status(403).json({ message: 'Permission denied: manage_admins required' });
      }

      const targetId = req.params.telegramId;

      // Prevent self-removal
      if (targetId === callerTelegramId) {
        return res.status(400).json({ message: 'Cannot remove yourself' });
      }

      // Super admin can never be removed
      if (isSuperAdmin(targetId)) {
        return res.status(400).json({ message: 'Cannot remove the super admin (TELEGRAM_ADMIN_ID / SUPER_ADMIN_ID).' });
      }

      // Sub-admins in TELEGRAM_ADMIN_IDS env var cannot be removed via UI either
      const subEnvIds = (process.env.TELEGRAM_ADMIN_IDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (subEnvIds.includes(targetId)) {
        return res.status(400).json({ message: 'Cannot remove env-configured admin. Remove from TELEGRAM_ADMIN_IDS env var instead.' });
      }

      await db.delete(adminRoles).where(eq(adminRoles.telegramId, targetId));
      res.json({ success: true, message: 'Admin removed' });
    } catch (error) {
      console.error('Error removing admin:', error);
      res.status(500).json({ message: 'Failed to remove admin' });
    }
  });

  // ── Admin-day helpers ────────────────────────────────────────────────────
  // Admin statistics use a daily period that starts at 18:30 UTC (= 12:00 AM IST)
  // and runs for 24 hours — one reset per day, matching the midnight IST boundary.
  function getAdminPeriodStart(): Date {
    const now = new Date();
    const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 30, 0, 0));
    if (now >= boundary) return boundary;
    // Before 18:30 UTC today → admin day started yesterday at 18:30 UTC
    boundary.setUTCDate(boundary.getUTCDate() - 1);
    return boundary;
  }
  // Returns a stable YYYY-MM-DD key for the current admin day (changes at 18:30 UTC)
  function getAdminDayKey(): string {
    return getAdminPeriodStart().toISOString().slice(0, 10);
  }

  // Admin stats endpoint
  app.get('/api/admin/stats', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('📊 Admin stats requested by:', req.user?.telegramUser?.id);

      // Admin "today" starts at 06:30 UTC (once-daily reset, = 12:00 PM IST)
      const adminPeriodStart = getAdminPeriodStart().toISOString();

      // Get various statistics for admin dashboard using drizzle
      const totalUsersCount = await db.select({ count: sql<number>`count(*)` }).from(users);
      const totalEarningsSum = await db.select({ total: sql<string>`COALESCE(SUM(${users.totalEarned}), '0')` }).from(users);

      // Fixed status filters to match database values exactly
      const validStatuses = ['completed', 'success', 'paid', 'Approved'];
      const totalWithdrawalsSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
      const pendingWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(eq(withdrawals.status, 'pending'));
      const successfulWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);
      const rejectedWithdrawalsCount = await db.select({ count: sql<number>`count(*)` }).from(withdrawals).where(sql`LOWER(${withdrawals.status}) = 'rejected'`);

      const activePromosCount = await db.select({ count: sql<number>`count(*)` }).from(promoCodes).where(eq(promoCodes.isActive, true));

      // Daily active users — counted from 06:30 UTC (admin day start)
      const dailyActiveCount = await db.select({ count: sql<number>`count(distinct ${earnings.userId})` })
        .from(earnings)
        .where(sql`${earnings.createdAt} >= ${adminPeriodStart}::timestamptz`);

      const totalAdsSum = await db.select({ total: sql<number>`COALESCE(SUM(${users.adsWatched}), 0)` }).from(users);
      // Ads watched since 06:30 UTC today (admin day boundary, once-daily reset)
      const todayAdsSum = await db.select({ total: sql<number>`COUNT(*)` }).from(earnings)
        .where(sql`${earnings.createdAt} >= ${adminPeriodStart}::timestamptz AND ${earnings.source} IN ('ad_watch', 'mission_ad')`);
      const tonWithdrawnSum = await db.select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), '0')` }).from(withdrawals).where(sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`);

      const stats = {
        totalUsers: Number(totalUsersCount[0]?.count || 0),
        totalEarnings: totalEarningsSum[0]?.total || '0',
        totalWithdrawals: totalWithdrawalsSum[0]?.total || '0',
        tonWithdrawn: tonWithdrawnSum[0]?.total || '0',
        pendingWithdrawals: Number(pendingWithdrawalsCount[0]?.count || 0),
        successfulWithdrawals: Number(successfulWithdrawalsCount[0]?.count || 0),
        rejectedWithdrawals: Number(rejectedWithdrawalsCount[0]?.count || 0),
        activePromos: Number(activePromosCount[0]?.count || 0),
        dailyActiveUsers: Number(dailyActiveCount[0]?.count || 0),
        totalAdsWatched: Number(totalAdsSum[0]?.total || 0),
        todayAdsWatched: Number(todayAdsSum[0]?.total || 0),
      };

      console.log('✅ Admin stats calculated:', stats);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({
        message: "Failed to fetch admin stats",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get admin settings
  app.get('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settings = await db.select().from(adminSettings);

      // Helper function to get setting value
      const getSetting = (key: string, defaultValue: any) => {
        const setting = settings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };

      // Return all settings in format expected by frontend with NEW defaults
      res.json({
        dailyAdLimit: parseInt(getSetting('daily_ad_limit', '50')),
        rewardPerAd: parseInt(getSetting('reward_per_ad', '2')), // Default 2 Gems
        affiliateCommission: parseFloat(getSetting('affiliate_commission', '10')),
        l1CommissionPercent: parseFloat(getSetting('l1_commission_percent', '20')),
        l2CommissionPercent: parseFloat(getSetting('l2_commission_percent', '4')),
        walletChangeFee: parseInt(getSetting('wallet_change_fee', '100')), // Return as Gems, default 100
        minimumWithdrawalUSD: parseFloat(getSetting('minimum_withdrawal_usd', '1.00')), // NEW: Min USD withdrawal
        minimumCashoutGold: parseInt(getSetting('minimum_cashout_gold', '1000')),
        minimumWithdrawalTON: parseFloat(getSetting('minimum_withdrawal_ton', '0.5')), // NEW: Min TON withdrawal
        withdrawalFeeTON: parseFloat(getSetting('withdrawal_fee_ton', '5')), // NEW: TON withdrawal fee %
        withdrawalFeeUSD: parseFloat(getSetting('withdrawal_fee_usd', '3')), // NEW: USD withdrawal fee %
        channelTaskCost: parseFloat(getSetting('channel_task_cost_usd', '0.003')), // NEW: Channel cost in USD (admin only)
        botTaskCost: parseFloat(getSetting('bot_task_cost_usd', '0.003')), // NEW: Bot cost in USD (admin only)
        channelTaskCostTON: parseFloat(getSetting('channel_task_cost_ton', '0.0003')), // TON cost for regular users
        botTaskCostTON: parseFloat(getSetting('bot_task_cost_ton', '0.0003')), // TON cost for regular users
        channelTaskReward: parseInt(getSetting('channel_task_reward', '100')), // Channel reward (legacy)
        botTaskReward: parseInt(getSetting('bot_task_reward', '100')), // Bot reward (legacy)
        partnerTaskReward: parseInt(getSetting('partner_task_reward', '200')), // Partner task reward in Gems
        taskRewardNoVerify: parseInt(getSetting('task_reward_no_verify', '100')), // Task without verification
        taskRewardWithVerify: parseInt(getSetting('task_reward_with_verify', '500')), // Task with verification
        minimumConvertGems: parseInt(getSetting('minimum_convert_pad', '100')), // NEW: Min convert in Gems (100 Gems = $0.01)
        minimumConvertUSD: parseInt(getSetting('minimum_convert_pad', '100')) / 10000, // Convert to USD
        minimumClicks: parseInt(getSetting('minimum_clicks', '500')), // NEW: Min clicks for task creation
        seasonBroadcastActive: getSetting('season_broadcast_active', 'false') === 'true',
        hourlyAdLimit: parseInt(getSetting('hourly_ad_limit', '63')),
        referralRewardEnabled: getSetting('referral_reward_enabled', 'false') === 'true',
        referralRewardUSD: parseFloat(getSetting('referral_reward_usd', '0.0005')),
        referralRewardGems: parseInt(getSetting('referral_reward_pad', '2500')),
        referralRewardGemsEnabled: getSetting('referral_reward_pad_enabled', 'true') === 'true',
        referralRewardUSDEnabled: getSetting('referral_reward_usd_enabled', 'false') === 'true',
        referralAdsRequired: 5,
        // Daily task rewards
        streakReward: parseInt(getSetting('streak_reward', '100')),
        shareTaskReward: parseInt(getSetting('share_task_reward', '1000')),
        communityTaskReward: parseInt(getSetting('community_task_reward', '1000')),
        // Withdrawal requirements
        withdrawalAdRequirementEnabled: getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true',
        minimumAdsForWithdrawal: parseInt(getSetting('minimum_ads_for_withdrawal', '100')),
        withdrawalInviteRequirementEnabled: getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true',
        minimumInvitesForWithdrawal: parseInt(getSetting('minimum_invites_for_withdrawal', '3')),
        withdrawalTaskRequirementEnabled: getSetting('withdrawal_task_requirement_enabled', 'true') === 'true',
        minimumTasksForWithdrawal: parseInt(getSetting('minimum_tasks_for_withdrawal', '10')),
        // Withdrawal packages
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]')),
        // Legacy fields for backwards compatibility
        minimumWithdrawal: parseFloat(getSetting('minimum_withdrawal_ton', '0.5')),
        taskPerClickReward: parseInt(getSetting('channel_task_reward', '1000')),
        taskCreationCost: parseFloat(getSetting('channel_task_cost_usd', '0.003')),
        minimumConvert: parseInt(getSetting('minimum_convert_pad', '100')) / 10000,
        // Weekly giveaway
        weeklyGiveawayAmount: parseFloat(getSetting('weekly_giveaway_amount', '10')),
        // Mission page ad platform settings
        monetagMissionReward: parseInt(getSetting('monetag_mission_reward', '1000')),
        monetagMissionLimit: parseInt(getSetting('monetag_mission_limit', '25')),
        adexiumMissionReward: parseInt(getSetting('adexium_mission_reward', '1000')),
        adexiumMissionLimit: parseInt(getSetting('adexium_mission_limit', '25')),
        gigaPubMissionReward: parseInt(getSetting('giga_pub_mission_reward', '1000')),
        gigaPubMissionLimit: parseInt(getSetting('giga_pub_mission_limit', '25')),
        minimumWithdrawAmount: parseFloat(getSetting('minimumWithdrawAmount', '0.20')),
        maximumWithdrawAmount: parseFloat(getSetting('maximumWithdrawAmount', '0.50')),
        maxWithdrawalsPerDay: parseInt(getSetting('maxWithdrawalsPerDay', '1')),
        // Daily mission rewards
        shareReferralReward: parseInt(getSetting('share_referral_reward', '1000')),
        checkAnnouncementReward: parseInt(getSetting('check_announcement_reward', '1000')),
        adsgramCheckinReward: parseInt(getSetting('adsgram_checkin_reward', '1000')),
        firstActiveReferralReward: parseInt(getSetting('first_active_referral_reward', '2500')),
        // Per-provider ad card settings (with enabled/disabled status)
        adsgramAdLimit: parseInt(getSetting('adsgram_ad_limit', '40')),
        adsgramRewardPerAd: parseInt(getSetting('adsgram_reward_per_ad', '50')),
        adsgramEnabled: getSetting('adsgram_enabled', 'true') === 'true',
        monetagAdLimit: parseInt(getSetting('monetag_ad_limit', '30')),
        monetagRewardPerAd: parseInt(getSetting('monetag_reward_per_ad', '30')),
        monetagEnabled: getSetting('monetag_enabled', 'true') === 'true',
        gigapubAdLimit: parseInt(getSetting('gigapub_ad_limit', '30')),
        gigapubRewardPerAd: parseInt(getSetting('gigapub_reward_per_ad', '30')),
        gigapubEnabled: getSetting('gigapub_enabled', 'true') === 'true',
        usladsAdLimit: parseInt(getSetting('uslads_ad_limit', '20')),
        usladsRewardPerAd: parseInt(getSetting('uslads_reward_per_ad', '20')),
        usladsEnabled: getSetting('uslads_enabled', 'true') === 'true',
      });
    } catch (error) {
      console.error("Error fetching admin settings:", error);
      res.status(500).json({ message: "Failed to fetch admin settings" });
    }
  });

  // Update admin settings (handled by the route below)

  // Mission Ads Watch endpoint — per-platform reward from admin settings
  app.post('/api/missions/ads/watch', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { platform, sessionId, backgroundDuration, backgroundEntered } = req.body as {
        platform?: string; sessionId?: string; backgroundDuration?: number; backgroundEntered?: boolean;
      };

      if (!['monetag', 'gigapub'].includes(platform ?? '')) {
        return res.status(400).json({ success: false, message: 'Invalid platform' });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.banned) return res.status(403).json({ success: false, message: 'Account banned' });

      // ── Server-authoritative session validation ───────────────────────────
      // Mission providers may keep the Mini App focused, so they do not use
      // AdsGram's minimize gate. They still need a server-measured watch
      // window before a pending session can be claimed.
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
        return res.status(400).json({ success: false, message: "Invalid session. Please start a new ad session.", errorType: 'invalid_session' });
      }
      const [missionSession] = await db.select().from(adSessions).where(eq(adSessions.id, sessionId)).limit(1);
      if (!missionSession) {
        return res.status(400).json({ success: false, message: "Session was not pre-registered. Please start the ad flow again.", errorType: 'invalid_session' });
      }
      if (missionSession.userId !== String(userId) || missionSession.context !== 'mission_ad' || missionSession.adType !== platform) {
        return res.status(403).json({ success: false, message: "Session mismatch.", errorType: 'invalid_session' });
      }
      if (missionSession.status !== 'pending') {
        return res.status(400).json({ success: false, message: "Session already used. Please watch a new ad.", errorType: 'duplicate_session' });
      }
      const missionSessionAge = Date.now() - new Date(missionSession.registeredAt as any).getTime();
      if (missionSessionAge > AD_SESSION_MAX_AGE_MS) {
        return res.status(400).json({ success: false, message: "Session expired. Please start a new ad session.", errorType: 'invalid_session' });
      }
      const bgDuration = typeof backgroundDuration === 'number' ? backgroundDuration : 0;
      const bgEntered = backgroundEntered === true;
      const serverSessionAgeMs = Date.now() - new Date(missionSession.registeredAt as any).getTime();
      if (serverSessionAgeMs < MIN_PROVIDER_SESSION_MS) {
        await db.update(adSessions)
          .set({ status: 'failed', usedAt: new Date(), backgroundEntered: bgEntered, backgroundDurationMs: bgDuration })
          .where(eq(adSessions.id, sessionId));
        return res.status(400).json({
          success: false,
          message: "The ad session finished too quickly. Please watch the full ad and try again.",
          errorType: 'insufficient_session_duration',
        });
      }
      // Get per-platform reward from admin settings
      const settings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) => settings.find(s => s.settingKey === key)?.settingValue || def;

      const safeInt = (raw: string, fallback: number) => {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };

      let reward: number;
      let limit: number;
      switch (platform) {
        case 'monetag':
          reward = safeInt(getSetting('monetag_mission_reward', '1000'), 1000);
          limit = safeInt(getSetting('monetag_mission_limit', '25'), 25);
          break;
        case 'gigapub':
          reward = safeInt(getSetting('giga_pub_mission_reward', '1000'), 1000);
          limit = safeInt(getSetting('giga_pub_mission_limit', '25'), 25);
          break;
        default:
          reward = 1000;
          limit = 25;
      }

      // Atomically claim the session (only succeeds if still 'pending') before
      // granting anything — this is what prevents a duplicated/resumed request
      // for the same session from being rewarded twice.
      const [claimedMissionSession] = await db.update(adSessions)
        .set({ status: 'used', usedAt: new Date(), backgroundEntered: bgEntered, backgroundDurationMs: bgDuration })
        .where(and(eq(adSessions.id, sessionId), eq(adSessions.status, 'pending')))
        .returning({ id: adSessions.id });
      if (!claimedMissionSession) {
        return res.status(400).json({ success: false, message: "Session already used. Please watch a new ad.", errorType: 'duplicate_session' });
      }

      // Atomically increment today's claim counter for this user/platform and
      // enforce the admin-configured daily limit. This prevents the endpoint
      // from being called an unlimited number of times to mint Gems.
      const resetDate = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const [counter] = await db
        .insert(missionAdClaims)
        .values({ userId, platform, resetDate, count: 1 })
        .onConflictDoUpdate({
          target: [missionAdClaims.userId, missionAdClaims.platform, missionAdClaims.resetDate],
          set: { count: sql`${missionAdClaims.count} + 1`, updatedAt: new Date() },
        })
        .returning({ count: missionAdClaims.count });

      if (counter.count > limit) {
        return res.status(429).json({
          success: false,
          message: `Daily limit reached for ${platform} (${limit}/day). Try again tomorrow.`,
        });
      }

      await storage.addEarning({
        userId,
        amount: String(reward),
        source: 'mission_ad',
        description: `Mission ad reward (${platform})`,
      });

      return res.json({ success: true, reward, claimsToday: counter.count, dailyLimit: limit });
    } catch (error) {
      console.error('Error in mission ad watch:', error);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  });

  // Create or Update Task (Admin)
  app.post('/api/admin/tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const taskData = req.body;
      const [task] = await db.insert(dailyTasks)
        .values({
          ...taskData,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: dailyTasks.id,
          set: {
            ...taskData,
            updatedAt: new Date()
          }
        })
        .returning();
      res.json(task);
    } catch (error) {
      console.error("Error creating/updating task:", error);
      res.status(500).json({ message: "Failed to save task" });
    }
  });

  // Create or Update Promo (Admin)
  app.post('/api/admin/promos', authenticateAdmin, async (req: any, res) => {
    try {
      const promoData = req.body;
      const [promo] = await db.insert(promoCodes)
        .values({
          ...promoData,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: promoCodes.id,
          set: {
            ...promoData,
            updatedAt: new Date()
          }
        })
        .returning();
      res.json(promo);
    } catch (error) {
      console.error("Error creating/updating promo:", error);
      res.status(500).json({ message: "Failed to save promo" });
    }
  });

  // Admin settings update (Optimized)
  app.put('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settingsData = req.body;
      console.log('📝 Updating admin settings:', settingsData);

      // Proper camelCase → snake_case that handles acronyms (Gems, USD, BUG, etc.)
      const toSnakeCase2 = (key: string): string =>
        key
          .replace(/([a-z\d])([A-Z])/g, '$1_$2')
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
          .toLowerCase();

      const updatePromises = Object.entries(settingsData).map(async ([key, value]) => {
        if (value === undefined || value === null) return;
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        await db.insert(adminSettings)
          .values({
            settingKey: key,
            settingValue: stringValue,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: adminSettings.settingKey,
            set: {
              settingValue: stringValue,
              updatedAt: new Date()
            }
          });

        const snakeKey = toSnakeCase2(key);
        if (snakeKey !== key) {
          await db.insert(adminSettings)
            .values({
              settingKey: snakeKey,
              settingValue: stringValue,
              updatedAt: new Date()
            })
            .onConflictDoUpdate({
              target: adminSettings.settingKey,
              set: {
                settingValue: stringValue,
                updatedAt: new Date()
              }
            });
        }
      });

      await Promise.all(updatePromises);

      // Broadcast update
      broadcastUpdate({
        type: 'settings_updated',
        message: 'App settings have been updated by admin'
      });

      res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
      console.error("Error updating admin settings:", error);
      res.status(500).json({ success: false, message: "Failed to update admin settings" });
    }
  });

  // Toggle season broadcast
  app.post('/api/admin/season-broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { active } = req.body;

      if (active === undefined) {
        return res.status(400).json({ message: "active field is required" });
      }

      await db.execute(sql`
        INSERT INTO admin_settings (setting_key, setting_value, updated_at)
        VALUES ('season_broadcast_active', ${active ? 'true' : 'false'}, NOW())
        ON CONFLICT (setting_key)
        DO UPDATE SET setting_value = ${active ? 'true' : 'false'}, updated_at = NOW()
      `);

      res.json({
        success: true,
        message: active ? "Season broadcast enabled" : "Season broadcast disabled",
        active
      });
    } catch (error) {
      console.error("Error toggling season broadcast:", error);
      res.status(500).json({ success: false, message: "Failed to toggle season broadcast" });
    }
  });

  // Send task notification to all users who have at least one incomplete running task
  app.post('/api/admin/notify-incomplete-tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const { getBotUsername: getBotUsernameForTaskNotice } = await import('./telegram');
      const botUsername = await getBotUsernameForTaskNotice();

      if (!botToken) {
        return res.status(400).json({ success: false, message: 'Bot token not configured' });
      }

      // Check if there are any running tasks at all
      const runningTasks = await db.select({ id: advertiserTasks.id })
        .from(advertiserTasks)
        .where(eq(advertiserTasks.status, 'running'));

      if (runningTasks.length === 0) {
        return res.json({ success: true, message: 'No running tasks found', details: { sent: 0, failed: 0 } });
      }

      // Find users who have NOT clicked at least one of the running tasks
      // i.e. users with telegram_id where at least one running task has no click from them
      const allUsersWithTg = await db.select({
        telegramId: users.telegram_id,
        id: users.id
      }).from(users).where(sql`${users.telegram_id} IS NOT NULL`);

      // Get all (taskId, userId) pairs that have been clicked
      const clickedPairs = await db.select({ taskId: taskClicks.taskId, userId: taskClicks.publisherId })
        .from(taskClicks)
        .where(sql`${taskClicks.taskId} IN (${sql.join(runningTasks.map(t => sql`${t.id}`), sql`, `)})`);

      const clickedSet = new Set(clickedPairs.map(c => `${c.taskId}:${c.userId}`));
      const runningTaskIds = runningTasks.map(t => t.id);

      // Keep only users who have at least one running task they haven't clicked
      const eligibleUsers = allUsersWithTg.filter(user => {
        return runningTaskIds.some(taskId => !clickedSet.has(`${taskId}:${user.id}`));
      });

      const message = `<tg-emoji emoji-id="5472239203590888751">💌</tg-emoji> <b>New tasks available!</b>\n\n<tg-emoji emoji-id="5361813743279821319">🤑</tg-emoji> Complete them now and claim your rewards!`;

      const replyMarkup = {
        inline_keyboard: [[
          {
            text: '👉 Complete Tasks 👈',
            url: `https://t.me/${botUsername}?start=tasks`,
          }
        ]]
      };

      let successCount = 0;
      let failCount = 0;

      for (const user of eligibleUsers) {
        if (user.telegramId) {
          const sent = await sendUserTelegramNotification(user.telegramId, message, replyMarkup, 'HTML');
          if (sent) successCount++;
          else failCount++;
        }
      }

      res.json({
        success: true,
        message: `Task notifications sent to eligible users`,
        details: {
          eligible: eligibleUsers.length,
          sent: successCount,
          failed: failCount,
        }
      });
    } catch (error) {
      console.error('Error sending task notifications:', error);
      res.status(500).json({ success: false, message: 'Failed to send task notifications' });
    }
  });

  // Broadcast message to all users (for admin use)
  app.post('/api/admin/broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      // Get all users with Telegram IDs
      const allUsers = await db.select({
        telegramId: users.telegram_id
      }).from(users).where(sql`${users.telegram_id} IS NOT NULL`);

      let successCount = 0;
      let failCount = 0;

      // Send message to each user
      for (const user of allUsers) {
        if (user.telegramId) {
          const sent = await sendUserTelegramNotification(user.telegramId, message);
          if (sent) {
            successCount++;
          } else {
            failCount++;
          }
        }
      }

      res.json({
        success: true,
        message: `Broadcast sent`,
        details: {
          total: allUsers.length,
          sent: successCount,
          failed: failCount
        }
      });
    } catch (error) {
      console.error("Error broadcasting message:", error);
      res.status(500).json({ message: "Failed to broadcast message" });
    }
  });

  // Admin chart analytics endpoint - get real time-series data
  // ?range=day   → last 24 hours, grouped by hour
  // ?range=week  → last 7 days, grouped by day (default)
  // ?range=month → last 30 days, grouped by day
  app.get('/api/admin/analytics/chart', authenticateAdmin, async (req: any, res) => {
    try {
      const range = (req.query.range === 'day' || req.query.range === 'month') ? req.query.range : 'week';

      let rows: any[];
      let cumulativeBeforeWindow: number;

      if (range === 'day') {
        const result = await db.execute(sql`
          WITH hour_series AS (
            SELECT generate_series(
              date_trunc('hour', NOW() - INTERVAL '23 hours'),
              date_trunc('hour', NOW()),
              INTERVAL '1 hour'
            ) AS hour
          ),
          hourly_stats AS (
            SELECT date_trunc('hour', e.created_at) as hour,
              COUNT(DISTINCT e.user_id) as active_users,
              COALESCE(SUM(e.amount), 0) as earnings
            FROM ${earnings} e
            WHERE e.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY date_trunc('hour', e.created_at)
          ),
          hourly_withdrawals AS (
            SELECT date_trunc('hour', w.created_at) as hour,
              COALESCE(SUM(w.amount), 0) as withdrawals
            FROM ${withdrawals} w
            WHERE w.created_at >= NOW() - INTERVAL '24 hours'
              AND w.status IN ('completed', 'success', 'paid', 'Approved')
            GROUP BY date_trunc('hour', w.created_at)
          ),
          hourly_user_count AS (
            SELECT date_trunc('hour', u.created_at) as hour,
              COUNT(*) as new_users
            FROM ${users} u
            WHERE u.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY date_trunc('hour', u.created_at)
          )
          SELECT hs.hour as period_key,
            COALESCE(s.active_users, 0) as active_users,
            COALESCE(s.earnings, 0) as earnings,
            COALESCE(w.withdrawals, 0) as withdrawals,
            COALESCE(u.new_users, 0) as new_users
          FROM hour_series hs
          LEFT JOIN hourly_stats s ON hs.hour = s.hour
          LEFT JOIN hourly_withdrawals w ON hs.hour = w.hour
          LEFT JOIN hourly_user_count u ON hs.hour = u.hour
          ORDER BY hs.hour ASC
        `);
        rows = result.rows;
        const before = await db.select({ count: sql<number>`count(*)` })
          .from(users)
          .where(sql`${users.createdAt} < NOW() - INTERVAL '23 hours'`);
        cumulativeBeforeWindow = Number(before[0]?.count || 0);
      } else {
        const daysBack = range === 'month' ? 29 : 6;
        const result = await db.execute(sql`
          WITH date_series AS (
            SELECT generate_series(
              CURRENT_DATE - ${sql.raw(`INTERVAL '${daysBack} days'`)},
              CURRENT_DATE,
              INTERVAL '1 day'
            )::date AS date
          ),
          daily_stats AS (
            SELECT DATE(e.created_at) as date,
              COUNT(DISTINCT e.user_id) as active_users,
              COALESCE(SUM(e.amount), 0) as earnings
            FROM ${earnings} e
            WHERE e.created_at >= CURRENT_DATE - ${sql.raw(`INTERVAL '${daysBack} days'`)}
            GROUP BY DATE(e.created_at)
          ),
          daily_withdrawals AS (
            SELECT DATE(w.created_at) as date,
              COALESCE(SUM(w.amount), 0) as withdrawals
            FROM ${withdrawals} w
            WHERE w.created_at >= CURRENT_DATE - ${sql.raw(`INTERVAL '${daysBack} days'`)}
              AND w.status IN ('completed', 'success', 'paid', 'Approved')
            GROUP BY DATE(w.created_at)
          ),
          daily_user_count AS (
            SELECT DATE(u.created_at) as date,
              COUNT(*) as new_users
            FROM ${users} u
            WHERE u.created_at >= CURRENT_DATE - ${sql.raw(`INTERVAL '${daysBack} days'`)}
            GROUP BY DATE(u.created_at)
          )
          SELECT ds.date as period_key,
            COALESCE(s.active_users, 0) as active_users,
            COALESCE(s.earnings, 0) as earnings,
            COALESCE(w.withdrawals, 0) as withdrawals,
            COALESCE(u.new_users, 0) as new_users
          FROM date_series ds
          LEFT JOIN daily_stats s ON ds.date = s.date
          LEFT JOIN daily_withdrawals w ON ds.date = w.date
          LEFT JOIN daily_user_count u ON ds.date = u.date
          ORDER BY ds.date ASC
        `);
        rows = result.rows;
        const before = await db.select({ count: sql<number>`count(*)` })
          .from(users)
          .where(sql`${users.createdAt} < CURRENT_DATE - ${sql.raw(`INTERVAL '${daysBack} days'`)}`);
        cumulativeBeforeWindow = Number(before[0]?.count || 0);
      }

      let cumulativeUsers = cumulativeBeforeWindow;
      const chartData = rows.map((row: any) => {
        cumulativeUsers += Number(row.new_users || 0);
        const label = range === 'day'
          ? new Date(row.period_key).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
          : new Date(row.period_key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return {
          period: label,
          users: Number(cumulativeUsers),
          earnings: parseFloat(row.earnings || '0'),
          withdrawals: parseFloat(row.withdrawals || '0'),
          activeUsers: Number(row.active_users || 0)
        };
      });

      res.json({
        success: true,
        range,
        data: chartData
      });
    } catch (error) {
      console.error("Error fetching chart analytics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch analytics data"
      });
    }
  });


  // Admin user tracking endpoint - search by UID/referral code OR user ID
  app.get('/api/admin/user-tracking/:uid', authenticateAdmin, async (req: any, res) => {
    try {
      const { uid } = req.params;

      // Search user by referral code OR user ID
      const userResults = await db
        .select()
        .from(users)
        .where(sql`${users.referralCode} = ${uid} OR ${users.id} = ${uid}`)
        .limit(1);

      if (userResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found - please check the UID/ID and try again'
        });
      }

      const user = userResults[0];

      // Get withdrawal count
      const withdrawalCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id));

      // Get referral count
      const referralCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.referrerId, user.id));

      res.json({
        success: true,
        user: {
          uid: user.referralCode,
          userId: user.id,
          balance: user.balance,
          totalEarnings: user.totalEarned,
          withdrawalCount: withdrawalCount[0]?.count || 0,
          referralCount: referralCount[0]?.count || 0,
          status: user.banned ? 'Banned' : 'Active',
          joinedDate: user.createdAt,
          adsWatched: user.adsWatched,
          walletAddress: user.tonWalletAddress || 'Not set'
        }
      });
    } catch (error) {
      console.error("Error fetching user tracking:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch user data"
      });
    }
  });

  // Admin users endpoint
  // Admin users list
  app.get('/api/admin/users', authenticateAdmin, async (req: any, res) => {
    try {
      const q = (req.query.q as string || '').trim();
      const page = Math.max(1, parseInt(req.query.page as string || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '50')));
      const offset = (page - 1) * limit;

      // Optional status filter: ?status=active|banned
      const statusFilter = (req.query.status as string || '').trim().toLowerCase();

      // Build WHERE clause for search + optional status filter — done in SQL for performance
      const conditions: any[] = [];
      if (q) {
        conditions.push(sql`(
            u.telegram_id ILIKE ${'%' + q + '%'} OR
            u.first_name  ILIKE ${'%' + q + '%'} OR
            u.last_name   ILIKE ${'%' + q + '%'} OR
            u.username    ILIKE ${'%' + q + '%'} OR
            u.referral_code ILIKE ${'%' + q + '%'} OR
            u.personal_code ILIKE ${'%' + q + '%'}
          )`);
      }
      if (statusFilter === 'active') conditions.push(sql`(u.banned IS NULL OR u.banned = false)`);
      if (statusFilter === 'banned') conditions.push(sql`u.banned = true`);
      const whereClause = conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

      // Count total matching users (fast — no data transfer)
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total FROM users u ${whereClause}
      `);
      const total = parseInt((countResult.rows[0] as any)?.total || '0');

      // Fetch only the current page
      const pageResult = await db.execute(sql`
        SELECT
          u.id, u.telegram_id, u.username, u.first_name, u.last_name,
          u.balance, u.usd_balance, u.ton_balance, u.total_earned, u.friends_invited,
          u.referral_code, u.personal_code, u.cwallet_id, u.usdt_wallet_address,
          u.telegram_stars_username, u.referred_by,
          u.banned, u.ads_watched, u.platform, u.created_at, u.last_login_at
        FROM users u
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const mappedUsers = (pageResult.rows as any[]).map(u => ({
        id: u.id,
        telegramId: u.telegram_id,
        telegram_id: u.telegram_id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        balance: u.balance?.toString() || '0',
        usdBalance: u.usd_balance?.toString() || '0',
        tonBalance: u.ton_balance?.toString() || '0',
        totalEarned: u.total_earned?.toString() || '0',
        friendsInvited: u.friends_invited || 0,
        referralCode: u.referral_code,
        personalCode: u.personal_code,
        cwalletId: u.cwallet_id,
        usdtWalletAddress: u.usdt_wallet_address,
        telegramStarsUsername: u.telegram_stars_username,
        referrerUid: u.referred_by,
        banned: u.banned || false,
        adsWatched: u.ads_watched || 0,
        platform: u.platform || null,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
      }));

      res.json({
        users: mappedUsers,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        limit,
      });
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // GET /api/admin/users/:id — fetch a single user in the same shape as the
  // list endpoint above, so any admin-panel list that references a user by
  // id (e.g. clicking a referral in the Friends tab) can open their profile.
  app.get('/api/admin/users/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const result = await db.execute(sql`
        SELECT
          u.id, u.telegram_id, u.username, u.first_name, u.last_name,
          u.balance, u.usd_balance, u.ton_balance, u.total_earned, u.friends_invited,
          u.referral_code, u.personal_code, u.cwallet_id, u.usdt_wallet_address,
          u.telegram_stars_username, u.referred_by,
          u.banned, u.banned_reason, u.banned_at,
          u.ads_watched, u.ads_watched_today, u.daily_ads_watched,
          u.monetag_ads_watched_today, u.gigapub_ads_watched_today, u.last_ad_watch,
          u.platform, u.created_at, u.last_login_at
        FROM users u
        WHERE u.id = ${id}
        LIMIT 1
      `);

      const u = (result.rows as any[])[0];
      if (!u) return res.status(404).json({ success: false, message: 'User not found' });

      res.json({
        success: true,
        user: {
          id: u.id,
          telegramId: u.telegram_id,
          telegram_id: u.telegram_id,
          username: u.username,
          firstName: u.first_name,
          lastName: u.last_name,
          balance: u.balance?.toString() || '0',
          usdBalance: u.usd_balance?.toString() || '0',
          tonBalance: u.ton_balance?.toString() || '0',
          totalEarned: u.total_earned?.toString() || '0',
          friendsInvited: u.friends_invited || 0,
          referralCode: u.referral_code,
          personalCode: u.personal_code,
          cwalletId: u.cwallet_id,
          usdtWalletAddress: u.usdt_wallet_address,
          telegramStarsUsername: u.telegram_stars_username,
          referrerUid: u.referred_by,
          banned: u.banned || false,
          bannedReason: u.banned_reason,
          bannedAt: u.banned_at,
          adsWatched: u.ads_watched || 0,
          adsWatchedToday: u.ads_watched_today || 0,
          dailyAdsWatched: u.daily_ads_watched || 0,
          monetagAdsWatchedToday: u.monetag_ads_watched_today || 0,
          gigapubAdsWatchedToday: u.gigapub_ads_watched_today || 0,
          usladsAdsWatchedToday: u.uslads_ads_watched_today || 0,
          lastAdWatch: u.last_ad_watch,
          platform: u.platform || null,
          createdAt: u.created_at,
          lastLoginAt: u.last_login_at,
        },
      });
    } catch (error) {
      console.error('❌ Error fetching admin user:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch user' });
    }
  });

  // Admin banned users endpoint
  app.get('/api/admin/banned-users', authenticateAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const bannedUsers = allUsers.filter(user => user.banned);
      res.json(bannedUsers);
    } catch (error) {
      console.error("Error fetching banned users:", error);
      res.status(500).json({ message: "Failed to fetch banned users" });
    }
  });

  // Admin ban/unban user endpoint (by URL param)
  app.post('/api/admin/users/:id/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { banned } = req.body;

      await storage.updateUserBanStatus(id, banned);

      res.json({
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Admin ban/unban user endpoint (by body)
  app.post('/api/admin/users/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId, banned, reason } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required" });
      }

      // Get admin user ID for logging
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';

      await storage.updateUserBanStatus(userId, banned, reason, adminUserId);

      res.json({
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ success: false, message: "Failed to update user status" });
    }
  });

  // Admin get ban logs endpoint with filtering
  app.get('/api/admin/ban-logs', authenticateAdmin, async (req: any, res) => {
    try {
      const { getBanLogs } = await import('./deviceTracking');
      const limit = parseInt(req.query.limit as string) || 100;
      const filters: any = {};

      if (req.query.deviceId) filters.deviceId = req.query.deviceId;
      if (req.query.ip) filters.ip = req.query.ip;
      if (req.query.reason) filters.reason = req.query.reason;
      if (req.query.banType) filters.banType = req.query.banType;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate);

      const logs = await getBanLogs(limit, Object.keys(filters).length > 0 ? filters : undefined);

      res.json({ success: true, logs });
    } catch (error) {
      console.error("Error fetching ban logs:", error);
      res.status(500).json({ success: false, message: "Failed to fetch ban logs" });
    }
  });

  // Admin get banned users with full details for admin panel
  app.get('/api/admin/banned-users-details', authenticateAdmin, async (req: any, res) => {
    try {
      const { getBannedUsersWithDetails } = await import('./deviceTracking');
      const bannedUsers = await getBannedUsersWithDetails();

      res.json({ success: true, bannedUsers });
    } catch (error) {
      console.error("Error fetching banned users details:", error);
      res.status(500).json({ success: false, message: "Failed to fetch banned users" });
    }
  });

  // Admin linked-account view. Device identity is the hard link; IP is shown
  // as supporting information only because shared networks are common.
  app.get('/api/admin/secondary-accounts', authenticateAdmin, async (_req: any, res) => {
    try {
      const result = await db.execute(sql`
        WITH ranked AS (
          SELECT
            u.*,
            ROW_NUMBER() OVER (
              PARTITION BY u.device_id
              ORDER BY u.created_at NULLS LAST, u.id
            ) AS device_rank
          FROM users u
          WHERE u.device_id IS NOT NULL AND TRIM(u.device_id) <> ''
        )
        SELECT
          secondary.id AS secondary_id,
          secondary.telegram_id AS secondary_telegram_id,
          secondary.username AS secondary_username,
          secondary.first_name AS secondary_first_name,
          secondary.last_name AS secondary_last_name,
          secondary.banned AS secondary_banned,
          secondary.banned_reason AS secondary_banned_reason,
          secondary.device_id,
          secondary.last_login_ip AS secondary_last_login_ip,
          secondary.created_at AS secondary_created_at,
          primary_user.id AS primary_id,
          primary_user.telegram_id AS primary_telegram_id,
          primary_user.username AS primary_username,
          primary_user.first_name AS primary_first_name,
          primary_user.last_name AS primary_last_name,
          primary_user.created_at AS primary_created_at
        FROM ranked secondary
        JOIN ranked primary_user
          ON primary_user.device_id = secondary.device_id
         AND primary_user.device_rank = 1
        WHERE secondary.device_rank > 1
        ORDER BY secondary.created_at DESC NULLS LAST
      `);
      res.json({ success: true, accounts: result.rows });
    } catch (error) {
      console.error('Error fetching secondary accounts:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch secondary accounts' });
    }
  });

  // Admin: manually trigger full referral repair (sync + activate)
  app.post('/api/admin/referrals/sync', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('🔧 Admin triggered fullReferralRepair');
      const stats = await storage.fullReferralRepair();
      res.json({ success: true, stats });
    } catch (error) {
      console.error('Error in admin referral sync:', error);
      res.status(500).json({ success: false, message: 'Referral sync failed' });
    }
  });

  // Admin: manually link two users by referral code (recover missed referral links)
  app.post('/api/admin/referrals/manual-link', authenticateAdmin, async (req: any, res) => {
    try {
      const { referrerCode, refereeId } = req.body;
      if (!referrerCode || !refereeId) {
        return res.status(400).json({ success: false, message: 'referrerCode and refereeId are required' });
      }
      const referrer = await storage.getUserByReferralCode(referrerCode);
      if (!referrer) {
        return res.status(404).json({ success: false, message: `Referrer not found for code: ${referrerCode}` });
      }
      const referee = await storage.getUser(refereeId);
      if (!referee) {
        return res.status(404).json({ success: false, message: `Referee user not found: ${refereeId}` });
      }
      if (referrer.id === referee.id) {
        return res.status(400).json({ success: false, message: 'Cannot self-refer' });
      }
      const existing = await storage.getReferralByUsers(referrer.id, referee.id);
      if (existing) {
        return res.json({ success: false, message: 'Referral relationship already exists', referral: existing });
      }
      const referral = await storage.createReferral(referrer.id, referee.id);
      // Immediately try to activate if eligible
      await storage.checkAndActivateReferralBonus(referee.id);
      res.json({ success: true, message: `Linked ${referee.username || refereeId} under ${referrer.username || referrerCode}`, referral });
    } catch (error: any) {
      console.error('Error in manual referral link:', error);
      res.status(500).json({ success: false, message: error.message || 'Manual link failed' });
    }
  });

  // Admin: get referral overview stats
  app.get('/api/admin/referrals/stats', authenticateAdmin, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) AS total
        FROM referrals
      `);
      const usersWithReferrer = await db.execute(sql`
        SELECT COUNT(*) AS count FROM users
        WHERE referred_by IS NOT NULL AND referred_by != ''
      `);
      res.json({
        success: true,
        referrals: result.rows[0],
        usersWithReferrer: usersWithReferrer.rows[0],
      });
    } catch (error) {
      console.error('Error in admin referral stats:', error);
      res.status(500).json({ success: false, message: 'Failed to get referral stats' });
    }
  });

  // Admin unban user endpoint
  app.post('/api/admin/users/:id/unban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';

      const { unbanUser } = await import('./deviceTracking');
      const success = await unbanUser(id, adminUserId);

      if (success) {
        res.json({
          success: true,
          message: 'User unbanned successfully'
        });
      } else {
        res.status(400).json({ success: false, message: "Failed to unban user" });
      }
    } catch (error) {
      console.error("Error unbanning user:", error);
      res.status(500).json({ success: false, message: "Failed to unban user" });
    }
  });

  // ── Security / Suspicious Users endpoint ─────────────────────────────────
  // Returns top users sorted by suspicion_score with risk signals
  app.get('/api/admin/suspicious-users', authenticateAdmin, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const minScore = parseInt(req.query.minScore as string) || 1;

      const rows = await db.execute(sql`
        SELECT
          id,
          telegram_id,
          username,
          first_name,
          last_name,
          referral_code,
          suspicion_score,
          platform,
          flagged,
          flag_reason,
          banned,
          last_login_ip,
          last_login_user_agent,
          app_version,
          last_login_at,
          ads_watched,
          balance,
          created_at
        FROM users
        WHERE suspicion_score >= ${minScore}
        ORDER BY suspicion_score DESC
        LIMIT ${limit}
      `);

      const users = (rows.rows as any[]).map(u => ({
        id: u.id,
        telegramId: u.telegram_id,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        referralCode: u.referral_code,
        suspicionScore: u.suspicion_score ?? 0,
        platform: u.platform || 'unknown',
        flagged: u.flagged,
        flagReason: u.flag_reason,
        banned: u.banned,
        lastLoginIp: u.last_login_ip,
        lastLoginUserAgent: u.last_login_user_agent,
        appVersion: u.app_version,
        lastLoginAt: u.last_login_at,
        adsWatched: u.ads_watched,
        balance: u.balance,
        createdAt: u.created_at,
        riskLevel: u.suspicion_score >= 76 ? 'CRITICAL'
                 : u.suspicion_score >= 56 ? 'HIGH'
                 : u.suspicion_score >= 31 ? 'MEDIUM'
                 : 'LOW',
      }));

      // Summary counts
      const critical = users.filter(u => u.riskLevel === 'CRITICAL').length;
      const high     = users.filter(u => u.riskLevel === 'HIGH').length;
      const medium   = users.filter(u => u.riskLevel === 'MEDIUM').length;

      res.json({ users, summary: { critical, high, medium, total: users.length } });
    } catch (err) {
      console.error('Error fetching suspicious users:', err);
      res.status(500).json({ success: false, message: 'Failed to fetch suspicious users' });
    }
  });

  // ── Clear suspicion score for a user ─────────────────────────────────────
  app.post('/api/admin/users/:id/clear-suspicion', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`
        UPDATE users
        SET suspicion_score = 0,
            flagged = false,
            flag_reason = NULL,
            updated_at = NOW()
        WHERE id = ${id}
      `);
      res.json({ success: true, message: 'Suspicion score cleared' });
    } catch (err) {
      console.error('Error clearing suspicion score:', err);
      res.status(500).json({ success: false, message: 'Failed to clear suspicion score' });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────

  // Admin self-unban endpoint (for emergency recovery when admin is accidentally banned)
  app.post('/api/admin/self-unban', async (req: any, res) => {
    try {
      const { initData } = req.body;

      if (!initData) {
        return res.status(400).json({ success: false, message: "Missing Telegram initData" });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const adminTelegramId = process.env.TELEGRAM_ADMIN_ID;

      if (!botToken || !adminTelegramId) {
        console.error('❌ Self-unban failed: Missing bot token or admin ID config');
        return res.status(500).json({ success: false, message: "Server configuration error" });
      }

      // Verify Telegram initData signature
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);

      if (!isValid || !telegramUser) {
        console.log('❌ Self-unban failed: Invalid Telegram data signature');
        return res.status(401).json({ success: false, message: "Invalid authentication" });
      }

      // Verify the user is the admin
      if (!isAdmin(telegramUser.id.toString())) {
        console.log(`❌ Self-unban denied: User ${telegramUser.id} is not admin`);
        return res.status(403).json({ success: false, message: "Only admin can use this feature" });
      }

      // Find admin user by telegram_id
      const [adminUser] = await db
        .select({ id: users.id, banned: users.banned })
        .from(users)
        .where(eq(users.telegram_id, adminTelegramId));

      if (!adminUser) {
        return res.status(404).json({ success: false, message: "Admin user not found" });
      }

      if (!adminUser.banned) {
        return res.json({ success: true, message: "Admin is not banned" });
      }

      // Unban the admin
      const { unbanUser } = await import('./deviceTracking');
      const success = await unbanUser(adminUser.id, 'self-unban');

      if (success) {
        console.log(`✅ Admin ${adminTelegramId} successfully self-unbanned`);
        res.json({
          success: true,
          message: 'Admin successfully unbanned'
        });
      } else {
        res.status(400).json({ success: false, message: "Failed to unban admin" });
      }
    } catch (error) {
      console.error("Error in admin self-unban:", error);
      res.status(500).json({ success: false, message: "Failed to process self-unban" });
    }
  });

  // ============ Admin Task Management Endpoints ============

  app.get('/api/admin/pending-tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const pendingTasks = await storage.getPendingTasks();

      const tasksWithUserInfo = await Promise.all(
        pendingTasks.map(async (task) => {
          const advertiser = await storage.getUser(task.advertiserId);
          return {
            ...task,
            advertiserUid: advertiser?.id || 'Unknown',
            advertiserName: advertiser?.firstName || advertiser?.username || 'Unknown',
            advertiserTelegramUsername: advertiser?.username || '',
          };
        })
      );

      res.json({ success: true, tasks: tasksWithUserInfo });
    } catch (error) {
      console.error("Error fetching pending tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch pending tasks" });
    }
  });

  app.get('/api/admin/all-tasks', authenticateAdmin, async (req: any, res) => {
    try {
      const allTasks = await storage.getAllTasks();

      const tasksWithUserInfo = await Promise.all(
        allTasks.map(async (task) => {
          const advertiser = await storage.getUser(task.advertiserId);
          return {
            ...task,
            advertiserUid: advertiser?.id || 'Unknown',
            advertiserName: advertiser?.firstName || advertiser?.username || 'Unknown',
            advertiserTelegramUsername: advertiser?.username || '',
          };
        })
      );

      res.json({ success: true, tasks: tasksWithUserInfo });
    } catch (error) {
      console.error("Error fetching all tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch tasks" });
    }
  });

  app.post('/api/admin/tasks/:taskId/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.status !== "under_review") {
        return res.status(400).json({ success: false, message: "Task is not under review" });
      }

      const updatedTask = await storage.approveTask(taskId);
      console.log(`✅ Task ${taskId} approved by admin`);

      res.json({ success: true, task: updatedTask, message: "Task approved successfully" });
    } catch (error) {
      console.error("Error approving task:", error);
      res.status(500).json({ success: false, message: "Failed to approve task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.status !== "under_review") {
        return res.status(400).json({ success: false, message: "Task is not under review" });
      }

      const updatedTask = await storage.rejectTask(taskId);
      console.log(`❌ Task ${taskId} rejected by admin`);

      res.json({ success: true, task: updatedTask, message: "Task rejected" });
    } catch (error) {
      console.error("Error rejecting task:", error);
      res.status(500).json({ success: false, message: "Failed to reject task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/pause', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.status !== "running") {
        return res.status(400).json({ success: false, message: "Only running tasks can be paused" });
      }

      const updatedTask = await storage.pauseTask(taskId);
      console.log(`⏸️ Task ${taskId} paused by admin`);

      res.json({ success: true, task: updatedTask, message: "Task paused" });
    } catch (error) {
      console.error("Error pausing task:", error);
      res.status(500).json({ success: false, message: "Failed to pause task" });
    }
  });

  app.post('/api/admin/tasks/:taskId/resume', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.status !== "paused") {
        return res.status(400).json({ success: false, message: "Only paused tasks can be resumed" });
      }

      const updatedTask = await storage.resumeTask(taskId);
      console.log(`▶️ Task ${taskId} resumed by admin`);

      res.json({ success: true, task: updatedTask, message: "Task resumed" });
    } catch (error) {
      console.error("Error resuming task:", error);
      res.status(500).json({ success: false, message: "Failed to resume task" });
    }
  });

  app.delete('/api/admin/tasks/:taskId', authenticateAdmin, async (req: any, res) => {
    try {
      const { taskId } = req.params;
      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      const success = await storage.deleteTask(taskId);

      if (success) {
        console.log(`🗑️ Task ${taskId} deleted by admin`);
        res.json({ success: true, message: "Task deleted successfully" });
      } else {
        res.status(500).json({ success: false, message: "Failed to delete task" });
      }
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ success: false, message: "Failed to delete task" });
    }
  });

  // ============ End Admin Task Management ============

  // ============ Admin Database Backups ============

  // GET /api/admin/backups — list available backups
  app.get('/api/admin/backups', authenticateAdmin, async (req: any, res) => {
    try {
      const backups = await listBackups();
      res.json({ success: true, backups });
    } catch (error) {
      console.error('❌ Error listing backups:', error);
      res.status(500).json({ success: false, message: 'Failed to list backups' });
    }
  });

  // POST /api/admin/backups — create a manual backup now
  app.post('/api/admin/backups', authenticateAdmin, async (req: any, res) => {
    try {
      const backup = await createBackup('manual');
      console.log(`🗄️ Manual backup created by admin: ${backup.filename} (${backup.sizeHuman})`);
      res.json({ success: true, backup });
    } catch (error) {
      console.error('❌ Error creating backup:', error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Failed to create backup' });
    }
  });

  // GET /api/admin/backups/:filename/download — download a backup file
  app.get('/api/admin/backups/:filename/download', authenticateAdmin, async (req: any, res) => {
    try {
      const { filename } = req.params;
      const filePath = getBackupPath(filename);
      res.download(filePath, filename, (err) => {
        if (err && !res.headersSent) {
          console.error('❌ Error downloading backup:', err);
          res.status(404).json({ success: false, message: 'Backup file not found' });
        }
      });
    } catch (error) {
      console.error('❌ Error downloading backup:', error);
      res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Invalid backup file' });
    }
  });

  // POST /api/admin/backups/:filename/restore — restore the database from a backup
  app.post('/api/admin/backups/:filename/restore', authenticateAdmin, async (req: any, res) => {
    try {
      const { filename } = req.params;
      const result = await restoreBackup(filename);
      console.log(`♻️ Database restored from ${filename} by admin — ${result.tablesRestored} tables, ${result.rowsRestored} rows`);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('❌ Error restoring backup:', error);
      res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Failed to restore backup' });
    }
  });

  // DELETE /api/admin/backups/:filename — delete a backup
  app.delete('/api/admin/backups/:filename', authenticateAdmin, async (req: any, res) => {
    try {
      const { filename } = req.params;
      await deleteBackup(filename);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error deleting backup:', error);
      res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Failed to delete backup' });
    }
  });

  // ============ End Admin Database Backups ============

  // Database setup endpoint for free plan deployments (call once after deployment)
  app.post('/api/setup-database', authenticateAdmin, async (req: any, res) => {
    try {
      // Only allow this in production and with a setup key for security
      const { setupKey } = req.body;

      if (setupKey !== 'setup-database-schema-2024') {
        return res.status(403).json({ message: "Invalid setup key" });
      }

      console.log('🔧 Setting up database schema...');

      // Use drizzle-kit to push schema
      const { execSync } = await import('child_process');

      try {
        execSync('npx drizzle-kit push --force', {
          stdio: 'inherit',
          cwd: process.cwd()
        });


        console.log('✅ Database setup completed successfully');

        res.json({
          success: true,
          message: 'Database schema setup completed successfully'
        });
      } catch (dbError) {
        console.error('Database setup error:', dbError);
        res.status(500).json({
          success: false,
          message: 'Database setup failed',
          error: String(dbError)
        });
      }
    } catch (error) {
      console.error("Error setting up database:", error);
      res.status(500).json({ message: "Failed to setup database" });
    }
  });

  // Task/Promotion API routes

  // Get all active promotions/tasks for current user
  app.get('/api/tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const result = await storage.getAvailablePromotionsForUser(userId);
      res.json(result);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Complete a task
  app.post('/api/tasks/:promotionId/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramUserId = req.user.telegramUser.id.toString();
      const { promotionId } = req.params;
      const { taskType, channelUsername, botUsername } = req.body;

      // Validate required parameters
      if (!taskType) {
        console.log(`❌ Task completion blocked: Missing taskType for user ${userId}`);
        return res.status(400).json({
          success: false,
          message: '❌ Task cannot be completed: Missing task type parameter.'
        });
      }

      // Validate taskType is one of the allowed values
      const allowedTaskTypes = [
        'channel', 'bot', 'daily', 'fix',
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ];
      if (!allowedTaskTypes.includes(taskType)) {
        console.log(`❌ Task completion blocked: Invalid taskType '${taskType}' for user ${userId}`);
        return res.status(400).json({
          success: false,
          message: '❌ Task cannot be completed: Invalid task type.'
        });
      }

      console.log(`📋 Task completion attempt:`, {
        userId,
        telegramUserId,
        promotionId,
        taskType,
        channelUsername,
        botUsername
      });

      // Perform Telegram verification based on task type
      let isVerified = false;
      let verificationMessage = '';

      if (taskType === 'channel' && channelUsername) {
        // Verify channel membership using Telegram Bot API
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
        } else {
          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
          isVerified = isMember;
        }
        verificationMessage = isVerified
          ? 'Channel membership verified successfully'
          : `Please join the channel @${channelUsername} first to complete this task`;
      } else if (taskType === 'bot' && botUsername) {
        // For bot tasks, we'll consider them verified if the user is in the WebApp
        // (since they would need to interact with the bot to access the WebApp)
        isVerified = true;
        verificationMessage = 'Bot interaction verified';
      } else if (taskType === 'daily') {
        // Daily tasks require channel membership if channelUsername is provided
        if (channelUsername) {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (!botToken) {
            console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
            isVerified = false;
          } else {
            const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
            isVerified = isMember;
          }
          verificationMessage = isVerified
            ? 'Daily task verification successful'
            : `Please join the channel @${channelUsername} first to complete this task`;
        } else {
          isVerified = true;
          verificationMessage = 'Daily task completed';
        }
      } else if (taskType === 'fix') {
        // Fix tasks are verified by default (user opening link is verification)
        isVerified = true;
        verificationMessage = 'Fix task completed';
      } else if (taskType === 'channel_visit') {
        // Channel visit task requires channel membership verification
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
          verificationMessage = 'Channel verification failed - bot token not configured';
        } else {
          // Extract channel username from promotion URL
          const promotion = await storage.getPromotion(promotionId);
          const channelMatch = promotion?.url?.match(/t\.me\/([^/?]+)/);
          const channelName = channelMatch ? channelMatch[1] : (process.env.BOT_USERNAME || '').replace(/^@/, '') || '';

          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelName}`, botToken);
          isVerified = isMember;
          verificationMessage = isVerified
            ? 'Channel membership verified successfully'
            : `Please join the channel @${channelName} first to complete this task`;
        }
      } else if (taskType === 'share_link') {
        // Share link task requires user to have shared their affiliate link
        const hasSharedToday = await storage.hasSharedLinkToday(userId);
        isVerified = hasSharedToday;
        verificationMessage = isVerified
          ? 'App link sharing verified successfully'
          : 'Not completed yet. Please share your affiliate link first.';
      } else if (taskType === 'invite_friend') {
        // Invite friend task requires exactly 1 valid referral today
        const hasValidReferralToday = await storage.hasValidReferralToday(userId);
        isVerified = hasValidReferralToday;
        verificationMessage = isVerified
          ? 'Valid friend invitation verified for today'
          : 'Not completed yet. Please invite a friend using your referral link first.';
      } else if (taskType.startsWith('ads_goal_')) {
        // Ads goal tasks require checking user's daily ad count
        const hasMetGoal = await storage.checkAdsGoalCompletion(userId, taskType);
        const user = await storage.getUser(userId);
        const adsWatchedToday = user?.adsWatchedToday || 0;

        // Get required ads for this task type
        const adsGoalThresholds = {
          'ads_goal_mini': 15,
          'ads_goal_light': 25,
          'ads_goal_medium': 45,
          'ads_goal_hard': 75
        };
        const requiredAds = adsGoalThresholds[taskType as keyof typeof adsGoalThresholds] || 0;

        isVerified = hasMetGoal;
        verificationMessage = isVerified
          ? 'Ads goal achieved successfully!'
          : `Not eligible yet. Watch ${requiredAds - adsWatchedToday} more ads (${adsWatchedToday}/${requiredAds} watched).`;
      } else {
        console.log(`❌ Task validation failed: Invalid task type '${taskType}' or missing parameters`, {
          taskType,
          channelUsername,
          botUsername,
          promotionId,
          userId
        });
        return res.status(400).json({
          success: false,
          message: '❌ Task cannot be completed: Invalid task type or missing parameters.'
        });
      }

      if (!isVerified) {
        console.log(`❌ Task verification failed for user ${userId}:`, verificationMessage);
        let friendlyMessage = '❌ Verification failed. Please complete the required action first.';
        if (taskType === 'channel' && channelUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you joined the required channel @${channelUsername}.`;
        } else if (taskType === 'bot' && botUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you started the bot @${botUsername}.`;
        }
        return res.status(400).json({
          success: false,
          message: verificationMessage,
          friendlyMessage
        });
      }

      console.log(`✅ Task verification successful for user ${userId}:`, verificationMessage);

      // Get promotion to fetch actual reward amount
      const promotion = await storage.getPromotion(promotionId);
      if (!promotion) {
        return res.status(404).json({
          success: false,
          message: 'Task not found'
        });
      }

      const rewardAmount = promotion.rewardPerUser || '0.00025';
      console.log(`🔍 Promotion details:`, { rewardPerUser: promotion.rewardPerUser, type: promotion.type, id: promotion.id });

      // Determine if this is a daily task (new task types that reset daily)
      const isDailyTask = [
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ].includes(taskType);

      if (isDailyTask) {
        console.log(`💰 Using dynamic reward amount: ${rewardAmount} TON`);
      } else {
        console.log(`💰 Using dynamic reward amount: $${rewardAmount}`);
      }

      // Complete the task using appropriate method
      const result = isDailyTask
        ? await storage.completeDailyTask(promotionId, userId, rewardAmount)
        : await storage.completeTask(promotionId, userId, rewardAmount);

      if (result.success) {
        // Get updated balance for real-time sync
        let updatedBalance;
        try {
          updatedBalance = await storage.getUserBalance(userId);
          console.log(`💰 Balance updated for user ${userId}: $${updatedBalance?.balance || '0'}`);

          // Send real-time balance update to WebSocket clients
          const currencySymbol = isDailyTask ? 'TON' : '$';
          const balanceUpdate = {
            type: 'balance_update',
            balance: updatedBalance?.balance || '0',
            delta: rewardAmount,
            message: `🎉 Task completed! +${currencySymbol}${parseFloat(rewardAmount).toFixed(5)}`
          };
          sendRealtimeUpdate(userId, balanceUpdate);
          console.log(`📡 Real-time balance update sent to user ${userId}`);

        } catch (balanceError) {
          console.error('⚠️ Failed to fetch updated balance for real-time sync:', balanceError);
        }

        res.json({
          ...result,
          verificationMessage,
          rewardAmount,
          newBalance: updatedBalance?.balance || '0'
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  // Promotional system endpoints removed - using daily tasks system only

  // Wallet management endpoints

  // Get user's saved wallet details - auth removed to prevent popup spam
  app.get('/api/wallet/details', authenticateTelegram, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Wallet details requested without session - sending empty response");
        return res.json({ success: true, skipAuth: true, wallet: null });
      }

      const [user] = await db
        .select({
          tonWalletAddress: users.tonWalletAddress,
          tonWalletComment: users.tonWalletComment,
          telegramUsername: users.telegramUsername,
          cwalletId: users.cwalletId,
          walletUpdatedAt: users.walletUpdatedAt
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        walletDetails: {
          tonWalletAddress: user.tonWalletAddress || '',
          tonWalletComment: user.tonWalletComment || '',
          telegramUsername: user.telegramUsername || '',
          cwalletId: user.cwalletId || '',
          cwallet_id: user.cwalletId || '', // Support both formats
          canWithdraw: true
        }
      });

    } catch (error) {
      console.error('❌ Error fetching wallet details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch wallet details'
      });
    }
  });

  // Save user's wallet details
  app.post('/api/wallet/save', authenticateTelegram, walletMutationRateLimit, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Wallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { tonWalletAddress, tonWalletComment, telegramUsername } = req.body;

      console.log('💾 Saving wallet details for user:', userId);

      // Update user's wallet details
      await db
        .update(users)
        .set({
          tonWalletAddress: tonWalletAddress || null,
          tonWalletComment: tonWalletComment || null,
          telegramUsername: telegramUsername || null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      console.log('✅ Wallet details saved successfully');

      res.json({
        success: true,
        message: 'Wallet details saved successfully.'
      });

    } catch (error) {
      console.error('❌ Error saving wallet details:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save wallet details'
      });
    }
  });

  app.patch('/api/wallet/payout', authenticateTelegram, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const currency = String(req.body?.currency || '').toUpperCase();
      const address = String(req.body?.address || '').trim();
      if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });
      if (currency !== 'TON') return res.status(400).json({ success: false, message: 'Only TON withdrawals are supported' });
      if (address.length < 8 || address.length > 180) return res.status(400).json({ success: false, message: 'Enter a valid wallet address' });
      await db.update(users).set({ payoutCurrency: currency, payoutWalletAddress: address, walletUpdatedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
      res.json({ success: true, currency, address });
    } catch (error) { res.status(500).json({ success: false, message: 'Could not save wallet' }); }
  });

  app.post('/api/payouts', authenticateTelegram, requireVerifiedSession, withdrawRateLimit, async (req: any, res) => {
    try {
      if (req.user?.secondaryAccountBlocked) {
        return res.status(403).json({
          success: false,
          code: 'SECONDARY_ACCOUNT_BLOCKED',
          message: `This is not your active account. Your original account is ${req.user.primaryAccountName || 'the first account created on this device'}. Withdrawals are disabled here.`,
          primaryAccountName: req.user.primaryAccountName || null,
        });
      }
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.payoutWalletAddress) return res.status(400).json({ success: false, message: 'Save your TON address first' });
      const requestedGold = req.body?.goldAmount === undefined || req.body?.goldAmount === '' ? Number(user.balance || 0) : Number(req.body.goldAmount);
      const gold = Math.trunc(requestedGold);
      const [minimumCashoutSetting] = await db.select({ settingValue: adminSettings.settingValue }).from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_cashout_gold')).limit(1);
      const minimumCashoutGold = Math.max(1, parseInt(minimumCashoutSetting?.settingValue || '1000', 10) || 1000);
      if (!Number.isFinite(gold) || gold < minimumCashoutGold) return res.status(400).json({ success: false, message: `Minimum withdrawal is ${minimumCashoutGold.toLocaleString()} GOLD` });
      if (gold > Number(user.balance || 0)) return res.status(400).json({ success: false, message: 'Insufficient GOLD balance' });
      // Admin flows have historically stored status values with mixed casing.
      // Normalize them here so only genuinely active payouts block a new request.
      const [existing] = await db.select({ id: withdrawals.id }).from(withdrawals).where(and(
        eq(withdrawals.userId, userId),
        sql`LOWER(TRIM(CAST(${withdrawals.status} AS TEXT))) IN ('pending', 'processing', 'under_review')`,
      )).limit(1);
      if (existing) return res.status(409).json({ success: false, message: 'A payout is already awaiting admin approval or processing' });
      const usdValue = gold / 100000;
      const feePercent = 9;
      const fee = usdValue * (feePercent / 100);
      const netAmount = usdValue - fee;
      const { getLiveTonPriceUSD } = await import('./tonPriceService');
      const { price: withdrawalTonPrice, source: withdrawalPriceSource } = await getLiveTonPriceUSD();
      if (withdrawalPriceSource.includes('(stale)')) {
        throw new Error('Live TON price is temporarily unavailable. Please try again in a few seconds.');
      }
      const withdrawalTonAmount = netAmount / withdrawalTonPrice;
      const result = await db.transaction(async (tx) => {
        const locked = await tx.update(users).set({ balance: sql`${users.balance} - ${gold}`, updatedAt: new Date() }).where(and(eq(users.id, userId), sql`CAST(${users.balance} AS NUMERIC) >= ${gold}`)).returning({ id: users.id });
        if (locked.length === 0) throw new Error('Balance changed; please try again');
        const [withdrawal] = await tx.insert(withdrawals).values({ userId, amount: netAmount.toFixed(10), method: 'TON', status: 'pending', details: { walletAddress: user.payoutWalletAddress, goldAmount: Math.trunc(gold), axnAmount: Math.trunc(gold), usdValue, fee, feePercent, netAmount, tonAmount: withdrawalTonAmount, marketRateUsd: withdrawalTonPrice, totalDeducted: Math.trunc(gold), manualTonWithdrawal: true }, goldAmount: String(Math.trunc(gold)), usdValue: netAmount.toFixed(10), payoutCurrency: 'TON', cryptoAmount: withdrawalTonAmount.toFixed(18), marketRateUsd: withdrawalTonPrice.toFixed(18), walletAddress: user.payoutWalletAddress!, deducted: true, refunded: false }).returning();
        return withdrawal;
      });
      const notificationSent = await sendWithdrawalRequestToAdmins({ withdrawalId: result.id, userTelegramId: String(user.telegram_id || user.id), userName: user.firstName || user.username || user.id, userTelegramUsername: user.username || 'unknown', walletAddress: user.payoutWalletAddress, amount: netAmount, usdAmount: netAmount, fee, feePercent, axnAmount: gold, tonAmount: withdrawalTonAmount, tonPrice: withdrawalTonPrice });
      if (!notificationSent) console.error(`❌ Withdrawal ${result.id} created but private admin delivery failed`);
      res.json({ success: true, status: 'pending', withdrawalId: result.id, goldAmount: gold, usdValue: netAmount, fee, feePercent, currency: 'TON' });
    } catch (error) { res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Could not create payout' }); }
  });

  // Save Cwallet ID endpoint
  app.post('/api/wallet/cwallet', authenticateTelegram, walletMutationRateLimit, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Cwallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { cwalletId } = req.body;

      console.log('💾 Saving Cwallet ID for user:', userId);

      if (!cwalletId || !cwalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID'
        });
      }

      // Validate Cwallet ID (numeric only)
      if (!/^\d+$/.test(cwalletId.trim())) {
        console.log('🚫 Invalid Cwallet ID format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID (numeric only)'
        });
      }

      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));

      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }

      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);

        if (walletInUse) {
          console.log('🚫 Cwallet ID already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This Cwallet ID is already linked to another account.'
          });
        }
      }

      // Update user's Cwallet ID
      await db
        .update(users)
        .set({
          cwalletId: cwalletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      console.log('✅ TON wallet address saved successfully');

      res.json({
        success: true,
        message: 'TON wallet address saved successfully.'
      });

    } catch (error) {
      console.error('❌ Error saving TON wallet address:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to save TON wallet address'
      });
    }
  });

  // Alternative Cwallet save endpoint for compatibility - /api/set-wallet
  app.post('/api/set-wallet', authenticateTelegram, walletMutationRateLimit, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Wallet save (set-wallet) requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { cwallet_id, cwalletId } = req.body;
      const walletId = cwallet_id || cwalletId; // Support both formats

      console.log('💾 Saving Cwallet ID via /api/set-wallet for user:', userId);

      if (!walletId || !walletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Missing TON wallet address'
        });
      }

      // Validate TON wallet address (must start with UQ or EQ)
      if (!/^(UQ|EQ)[A-Za-z0-9_-]{46}$/.test(walletId.trim())) {
        console.log('🚫 Invalid TON wallet address format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid TON wallet address'
        });
      }

      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));

      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }

      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);

        if (walletInUse) {
          console.log('🚫 Cwallet ID already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This Cwallet ID is already linked to another account.'
          });
        }
      }

      // Update user's Cwallet ID in database - permanent storage
      await db
        .update(users)
        .set({
          cwalletId: cwalletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      console.log('✅ Cwallet ID saved permanently via /api/set-wallet');

      res.json({
        success: true,
        message: 'Cwallet ID saved successfully'
      });

    } catch (error) {
      console.error('❌ Error saving Cwallet ID via /api/set-wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save wallet'
      });
    }
  });

  // Change wallet endpoint - requires dynamic Gems fee from admin settings
  app.post('/api/wallet/change', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Wallet change requested without session - skipping");
        return res.status(401).json({
          success: false,
          message: 'Please log in to change wallet'
        });
      }

      const { newWalletId } = req.body;

      console.log('🔄 Wallet change request for user:', userId);

      if (!newWalletId || !newWalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID'
        });
      }

      // Validate Cwallet ID (numeric only)
      if (!/^\d+$/.test(newWalletId.trim())) {
        console.log('🚫 Invalid Cwallet ID format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Cwallet ID (numeric only)'
        });
      }

      // Get wallet change fee from admin settings (stored in Gems)
      const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
      const feeInPow = parseInt(walletChangeFee);
      const feeInTon = feeInPow / 10000000;

      console.log(`💰 Wallet change fee: ${feeInPow} Gems (${feeInTon} TON)`);

      // Use database transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Get current user with balance
        const [user] = await tx
          .select({
            id: users.id,
            balance: users.balance,
            cwalletId: users.cwalletId,
            telegramId: users.telegram_id
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          throw new Error('User not found');
        }

        // Validation check: ensure it's a different wallet
        if (user.cwalletId === newWalletId.trim()) {
          throw new Error('New Cwallet ID must be different from the current one');
        }

        // Check wallet uniqueness
        const [uniqueWalletCheck] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, newWalletId.trim()),
            sql`${users.id} != ${userId}`
          ))
          .limit(1)
          .for('update');

        if (uniqueWalletCheck) {
          throw new Error('This Cwallet ID is already linked to another account');
        }

        const currentBalance = parseFloat(user.balance || '0');
        const currentBalancePow = Math.floor(currentBalance * 10000000);

        if (currentBalancePow < feeInPow) {
          throw new Error(`Insufficient balance. You need ${feeInPow} Gems to change wallet. Current balance: ${currentBalancePow} Gems`);
        }

        // Deduct fee from balance
        const newBalance = currentBalance - feeInTon;

        // Update wallet and balance atomically
        await tx
          .update(users)
          .set({
            cwalletId: newWalletId.trim(),
            balance: newBalance.toFixed(8),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Record transaction
        await tx.insert(transactions).values({
          userId: userId,
          amount: feeInTon.toFixed(8),
          type: 'deduction',
          source: 'wallet_change_fee',
          description: `Fee for changing Cwallet ID (${feeInPow} Gems)`,
          metadata: { oldWallet: user.cwalletId, newWallet: newWalletId.trim(), feePad: feeInPow }
        });

        return {
          newBalance: newBalance.toFixed(8),
          newWallet: newWalletId.trim(),
          feeCharged: feeInTon.toFixed(8),
          feePad: feeInPow,
          telegramId: user.telegramId
        };
      });

      console.log('✅ Wallet changed successfully with fee deduction');

      // Send notification via WebSocket
      if (result.telegramId && wss) {
        wss.clients.forEach((client: WebSocket) => {
          if ((client as any).userId === userId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'wallet_changed',
              message: `Wallet updated successfully! ${result.feePad} Gems fee deducted.`,
              data: {
                newWalletId: result.newWallet,
                newBalance: result.newBalance,
                feeCharged: result.feePad
              }
            }));
          }
        });
      }

      res.json({
        success: true,
        message: 'Wallet updated successfully',
        data: {
          newWalletId: result.newWallet,
          newBalance: result.newBalance,
          feeCharged: result.feeCharged,
          feePad: result.feePad
        }
      });

    } catch (error) {
      console.error('❌ Error changing wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to change wallet'
      });
    }
  });


  // ── Live TON price endpoint ──────────────────────────────────────────────────
  // Returns current TON/USD market price fetched from CoinGecko → Binance → OKX
  // with a 60-second server-side cache.  The client should call this rather than
  // hitting exchanges directly so rate limits are shared across all users.
  app.get('/api/ton-price', async (_req, res) => {
    try {
      const { getLiveTonPriceUSD, GEMS_PER_USD } = await import('./tonPriceService');
      const result = await getLiveTonPriceUSD();
      res.json({
        price: result.price,
        source: result.source,
        cached: Boolean((result as any).stale),
        stale: Boolean((result as any).stale),
        fetchedAt: result.fetchedAt,
        // Helpful display info
        powPerUsd: GEMS_PER_USD,
        powPerTon: GEMS_PER_USD * result.price,
      });
    } catch (err) {
      console.error('[GET /api/ton-price] Failed:', err);
      res.status(503).json({
        error: 'TON price temporarily unavailable',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Gems conversion endpoint (supports USD, TON, BUG)
  app.post('/api/convert-to-usd', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { axnAmount, powAmount: powAmountBody, convertTo = 'USD' } = req.body;
      const powAmount = axnAmount ?? powAmountBody;

      console.log('💵 Gems conversion request:', { userId, axnAmount, powAmount, convertTo });

      const convertAmount = parseFloat(powAmount);
      if (!powAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Gems amount'
        });
      }

      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Lock user row and get current balances
        const [user] = await tx
          .select({
            balance: users.balance,
            usdBalance: users.usdBalance,
            tonBalance: users.tonBalance,
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          throw new Error('User not found');
        }

        const currentPowBalance = parseFloat(user.balance || '0');

        if (currentPowBalance < convertAmount) {
          throw new Error('Insufficient Gems balance');
        }

        const newPowBalance = currentPowBalance - convertAmount;
        let updateData: any = {
          balance: String(Math.round(newPowBalance)),
          updatedAt: new Date()
        };

        let convertedAmount = 0;
        let convertedCurrency = convertTo;

        if (convertTo === 'USD') {
          // User requirement: 100,000 Gems = 1 USD
          const Gems_TO_USD_RATE = 100_000;
          convertedAmount = convertAmount / Gems_TO_USD_RATE;
          const currentUsdBalance = parseFloat(user.usdBalance || '0');
          updateData.usdBalance = (currentUsdBalance + convertedAmount).toFixed(10);
          console.log(`✅ Gems to USD: ${convertAmount} Gems → $${convertedAmount.toFixed(4)} USD`);
        } else if (convertTo === 'TON') {
          // Use live market price: Gems → USD → TON
          const { getLiveTonPriceUSD, convertGemsToTon } = await import('./tonPriceService');
          const priceResult = await getLiveTonPriceUSD();
          const tonUsdPrice = priceResult.price;
          convertedAmount = await convertGemsToTon(convertAmount);
          const currentTonBalance = parseFloat(user.tonBalance || '0');
          updateData.tonBalance = (currentTonBalance + convertedAmount).toFixed(10);
          console.log(`✅ Gems to TON: ${convertAmount} Gems → ${convertedAmount.toFixed(6)} TON (1 TON = ${tonUsdPrice.toFixed(4)}, source: ${priceResult.source})`);
        }

        await tx.update(users).set(updateData).where(eq(users.id, userId));

        // Keep user_balances in sync — deduct the same Gems amount so the integrity guard
        // doesn't mistake a legitimate conversion for drift and restore the old balance.
        await tx
          .update(userBalances)
          .set({
            balance: sql`GREATEST(0, COALESCE(${userBalances.balance}, 0) - ${String(convertAmount)})`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));

        // Log the conversion as a transaction record
        await tx.insert(transactions).values({
          userId,
          amount: String(-convertAmount),
          type: 'debit',
          source: 'convert',
          description: `Converted ${convertAmount.toLocaleString()} Gems to ${convertedCurrency}`,
        });

        return {
          axnAmount: convertAmount,
          powAmount: convertAmount,
          convertedAmount,
          convertedCurrency,
          newAxnBalance: newPowBalance,
          newPowBalance,
          newUsdBalance: updateData.usdBalance ?? user.usdBalance,
          newTonBalance: updateData.tonBalance ?? user.tonBalance,
        };
      });

      // Send actual new balance values so frontend updates INSTANTLY without waiting for refetch
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPowBalance),
        usdBalance: result.newUsdBalance,
        tonBalance: result.newTonBalance,
      });

      res.json({
        success: true,
        message: `Converted to ${result.convertedCurrency} successfully!`,
        ...result
      });

    } catch (error) {
      console.error('❌ Error converting Gems:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      res.status(errorMessage === 'Insufficient Gems balance' ? 400 : 500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // Gems to TON conversion endpoint
  app.post('/api/convert-to-ton', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ TON conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { axnAmount: axnAmountTon, powAmount: powAmountTon } = req.body;
      const powAmount = axnAmountTon ?? powAmountTon;

      console.log('💎 Gems to TON conversion request:', { userId, axnAmount: axnAmountTon, powAmount });

      const convertAmount = parseFloat(powAmount);
      if (!powAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Gems amount'
        });
      }

      // Get minimum conversion from admin settings
      const minConvertSetting = await storage.getAppSetting('minimum_convert_pad_to_ton', '10000');
      const minimumConvertGems = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertGems) {
        return res.status(400).json({
          success: false,
          message: `Minimum Gems required for TON conversion`
        });
      }

      // Use live market price — Gems → USD → TON
      const { getLiveTonPriceUSD, convertGemsToTon, GEMS_PER_USD } = await import('./tonPriceService');
      const priceResult = await getLiveTonPriceUSD();
      const tonUsdPrice = priceResult.price;
      const tonAmount = await convertGemsToTon(convertAmount);

      console.log(`📊 [/api/convert-to-ton] Live rate: 1 TON = ${tonUsdPrice.toFixed(4)} | ${Math.round(GEMS_PER_USD * tonUsdPrice).toLocaleString()} Gems = 1 TON | source: ${priceResult.source}`);

      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({
            balance: users.balance,
            tonBalance: users.tonBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          throw new Error('User not found');
        }

        const currentPowBalance = parseFloat(user.balance || '0');
        const currentTonBalance = parseFloat(user.tonBalance || '0');

        if (currentPowBalance < convertAmount) {
          throw new Error('Insufficient Gems balance');
        }

        const newPowBalance = currentPowBalance - convertAmount;
        const newTonBalance = currentTonBalance + tonAmount;

        await tx
          .update(users)
          .set({
            balance: String(Math.round(newPowBalance)),
            tonBalance: newTonBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Keep user_balances in sync — deduct the same Gems so the integrity guard
        // doesn't mistake this legitimate reduction for drift and restore the old balance.
        await tx
          .update(userBalances)
          .set({
            balance: sql`GREATEST(0, COALESCE(${userBalances.balance}, 0) - ${String(convertAmount)})`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));

        // Log the conversion as a transaction record
        await tx.insert(transactions).values({
          userId,
          amount: String(-convertAmount),
          type: 'debit',
          source: 'convert',
          description: `Converted ${convertAmount.toLocaleString()} Gems to TON`,
        });

        console.log(`✅ Gems to TON conversion successful: ${convertAmount} Gems → ${tonAmount.toFixed(6)} TON`);

        return {
          axnAmount: convertAmount,
          powAmount: convertAmount,
          tonAmount,
          newAxnBalance: newPowBalance,
          newPowBalance,
          newTonBalance
        };
      });

      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPowBalance),
        tonBalance: result.newTonBalance.toFixed(10)
      });

      res.json({
        success: true,
        message: 'Conversion to TON successful!',
        ...result
      });

    } catch (error) {
      console.error('❌ Error converting Gems to TON:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';

      res.status(errorMessage === 'Insufficient Gems balance' ? 400 : 500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // USDT balance to TON conversion endpoint — lets users who accidentally
  // accumulated USDT balance convert it into TON (e.g. to fund advertiser
  // campaigns, which are paid in TON) without needing to withdraw first.
  app.post('/api/convert-usd-to-ton', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ USDT→TON conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { usdAmount } = req.body;

      console.log('💱 USDT to TON conversion request:', { userId, usdAmount });

      const convertAmount = parseFloat(usdAmount);
      if (!usdAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid USDT amount'
        });
      }

      // Get minimum conversion from admin settings (defaults to $0.10)
      const minConvertSetting = await storage.getAppSetting('minimum_convert_usd_to_ton', '0.10');
      const minimumConvertUSD = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertUSD) {
        return res.status(400).json({
          success: false,
          message: `Minimum $${minimumConvertUSD.toFixed(2)} USDT required for TON conversion`
        });
      }

      // Use live market price — USDT → TON
      const { getLiveTonPriceUSD } = await import('./tonPriceService');
      const priceResult = await getLiveTonPriceUSD();
      const tonUsdPrice = priceResult.price;
      const tonAmount = convertAmount / tonUsdPrice;

      console.log(`📊 [/api/convert-usd-to-ton] Live rate: 1 TON = $${tonUsdPrice.toFixed(4)} | source: ${priceResult.source}`);

      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({
            usdBalance: users.usdBalance,
            tonBalance: users.tonBalance,
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          throw new Error('User not found');
        }

        const currentUsdBalance = parseFloat(user.usdBalance || '0');
        const currentTonBalance = parseFloat(user.tonBalance || '0');

        if (currentUsdBalance < convertAmount) {
          throw new Error('Insufficient USDT balance');
        }

        const newUsdBalance = currentUsdBalance - convertAmount;
        const newTonBalance = currentTonBalance + tonAmount;

        await tx
          .update(users)
          .set({
            usdBalance: newUsdBalance.toFixed(10),
            tonBalance: newTonBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Log the conversion as a transaction record
        await tx.insert(transactions).values({
          userId,
          amount: String(-convertAmount),
          type: 'debit',
          source: 'convert',
          description: `Swapped $${convertAmount.toFixed(4)} USDT to ${tonAmount.toFixed(6)} TON`,
        });

        console.log(`✅ USDT to TON conversion successful: $${convertAmount} USDT → ${tonAmount.toFixed(6)} TON`);

        return {
          usdAmount: convertAmount,
          tonAmount,
          newUsdBalance,
          newTonBalance
        };
      });

      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        usdBalance: result.newUsdBalance.toFixed(10),
        tonBalance: result.newTonBalance.toFixed(10)
      });

      res.json({
        success: true,
        message: 'Swap to TON successful!',
        ...result
      });

    } catch (error) {
      console.error('❌ Error converting USDT to TON:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';

      res.status(errorMessage === 'Insufficient USDT balance' ? 400 : 500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // Setup USDT wallet (Optimism network only)
  app.post('/api/wallet/usdt', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up wallet'
        });
      }

      const { usdtAddress } = req.body;

      if (!usdtAddress || !usdtAddress.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your USDT wallet address'
        });
      }

      // Validate Optimism USDT address (0x... format, 42 characters)
      if (!/^0x[a-fA-F0-9]{40}$/.test(usdtAddress.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Optimism USDT address'
        });
      }

      // Check if address is already in use
      const [existingWallet] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.usdtWalletAddress, usdtAddress.trim()),
          sql`${users.id} != ${userId}`
        ))
        .limit(1);

      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This USDT address is already linked to another account'
        });
      }

      // Check if user already has a USDT wallet - if yes, charge fee for change
      const [currentUser] = await db
        .select({
          usdtWalletAddress: users.usdtWalletAddress,
          balance: users.balance
        })
        .from(users)
        .where(eq(users.id, userId));

      const isChangingWallet = currentUser?.usdtWalletAddress && currentUser.usdtWalletAddress.trim() !== '';

      if (isChangingWallet) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPow = parseInt(walletChangeFee);

        const currentBalance = parseFloat(currentUser.balance || '0');
        const currentBalancePow = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);

        if (currentBalancePow < feeInPow) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPow} Gems to change wallet. Current balance: ${currentBalancePow} Gems`
          });
        }

        // Deduct fee from balance (stored as Gems integer)
        const newBalancePad = currentBalancePow - feeInPow;

        // Update wallet and deduct fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            balance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Keep user_balances in sync with the fee deduction
        await db
          .update(userBalances)
          .set({
            balance: sql`GREATEST(0, COALESCE(${userBalances.balance}, 0) - ${feeInPow.toString()})`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));

        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPow.toString(),
          type: 'deduction',
          source: 'wallet_change_fee',
          description: `USDT wallet change fee`,
          createdAt: new Date()
        });

        console.log(`✅ USDT wallet changed for user ${userId} - Fee: ${feeInPow} Gems deducted`);

        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`✅ USDT wallet set for user ${userId} (first time - no fee)`);
      }

      res.json({
        success: true,
        message: 'USDT wallet saved successfully'
      });

    } catch (error) {
      console.error('❌ Error setting USDT wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save USDT wallet'
      });
    }
  });

  // Setup Telegram Stars username
  app.post('/api/wallet/telegram-stars', authenticateTelegram, requireVerifiedSession, walletMutationRateLimit, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up username'
        });
      }

      let { telegramUsername } = req.body;

      if (!telegramUsername || !telegramUsername.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your Telegram username'
        });
      }

      // Auto-add @ if not present
      telegramUsername = telegramUsername.trim();
      if (!telegramUsername.startsWith('@')) {
        telegramUsername = '@' + telegramUsername;
      }

      // Validate username format: @username (letters, numbers, underscores only, no spaces or special chars)
      if (!/^@[a-zA-Z0-9_]{1,32}$/.test(telegramUsername)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid username format. Use only letters, numbers, and underscores (e.g., @szxzyz)'
        });
      }

      // Check if user already has a Telegram username - if yes, charge fee for change
      const [currentUser] = await db
        .select({
          telegramStarsUsername: users.telegramStarsUsername,
          balance: users.balance
        })
        .from(users)
        .where(eq(users.id, userId));

      const isChangingUsername = currentUser?.telegramStarsUsername && currentUser.telegramStarsUsername.trim() !== '';

      if (isChangingUsername) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPow = parseInt(walletChangeFee);

        const currentBalance = parseFloat(currentUser.balance || '0');
        const currentBalancePow = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);

        if (currentBalancePow < feeInPow) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPow} Gems to change username. Current balance: ${currentBalancePow} Gems`
          });
        }

        // Deduct fee from balance (stored as Gems integer)
        const newBalancePad = currentBalancePow - feeInPow;

        // Update username and deduct fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            balance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        // Keep user_balances in sync with the fee deduction
        await db
          .update(userBalances)
          .set({
            balance: sql`GREATEST(0, COALESCE(${userBalances.balance}, 0) - ${feeInPow.toString()})`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));

        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPow.toString(),
          type: 'deduction',
          source: 'wallet_change_fee',
          description: `Telegram Stars username change fee`,
          createdAt: new Date()
        });

        console.log(`✅ Telegram Stars username changed for user ${userId} - Fee: ${feeInPow} Gems deducted`);

        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));

        console.log(`✅ Telegram Stars username set for user ${userId}: ${telegramUsername} (first time - no fee)`);
      }

      res.json({
        success: true,
        message: 'Telegram username saved successfully',
        username: telegramUsername
      });

    } catch (error) {
      console.error('❌ Error setting Telegram Stars username:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save username'
      });
    }
  });

  // Advertiser Task System API routes

  // Get all active advertiser tasks (public task feed) - excludes tasks already completed by user
  app.get('/api/advertiser-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const tasks = await storage.getActiveTasksForUser(userId);
      res.json({ success: true, tasks });
    } catch (error) {
      console.error("Error fetching advertiser tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch tasks" });
    }
  });

  // Get my created tasks
  app.get('/api/advertiser-tasks/my-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const myTasks = await storage.getMyTasks(userId);
      res.json({ success: true, tasks: myTasks });
    } catch (error) {
      console.error("Error fetching my tasks:", error);
      res.status(500).json({ success: false, message: "Failed to fetch your tasks" });
    }
  });

  // Create new advertiser task
  app.post('/api/advertiser-tasks/create', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskType, title, link, totalClicksRequired, channelVerified } = req.body;
      const verificationRequired = taskType === 'channel';

      console.log('📝 Task creation request:', { userId, taskType, title, link, totalClicksRequired, verificationRequired, channelVerified });

      // Validation
      if (!taskType || !title || !link || !totalClicksRequired) {
        return res.status(400).json({
          success: false,
          message: "Task type, title, link, and total clicks required are mandatory"
        });
      }

      // Validate task type
      if (taskType !== "channel" && taskType !== "bot" && taskType !== "partner") {
        return res.status(400).json({
          success: false,
          message: "Task type must be 'channel', 'bot', or 'partner'"
        });
      }

      if (taskType === "channel" && channelVerified !== true) {
        return res.status(400).json({
          success: false,
          message: "Channel tasks must be verified before creation"
        });
      }

      // Verification is only supported for Telegram (t.me) links
      if (verificationRequired && !link.includes('t.me')) {
        return res.status(400).json({
          success: false,
          message: "Verification is only supported for Telegram (t.me) links. Please disable verification for external websites."
        });
      }

      // Get user data to check if admin early for partner task validation
      const [userData] = await db
        .select({
          usdBalance: users.usdBalance,
          tonBalance: users.tonBalance,
          telegram_id: users.telegram_id
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const userIsAdmin = isAdmin(userData.telegram_id || '') ||
                          (process.env.NODE_ENV === 'development' && !!process.env.DEV_ADMIN_ID && userData.telegram_id === process.env.DEV_ADMIN_ID);

      // Partner tasks can only be created by admin
      if (taskType === "partner" && !userIsAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only admins can create partner tasks"
        });
      }

      // Minimum clicks: 1 for partner tasks, use admin settings for others.
      // Fixed advertiser package tiers are always
      // accepted regardless of the generic admin minimum — that setting is meant
      // to guard arbitrary/manual click counts, not the official package sizes.
      const CHANNEL_PACKAGE_SIZES = [100, 500, 1000, 2000, 5000, 10000];
      const BOT_PACKAGE_SIZES = [200, 500, 1000, 2000, 5000, 10000];
      const minClicksSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_clicks')).limit(1);
      const minClicksFromSettings = parseInt(minClicksSetting[0]?.settingValue || '500');
      const minClicks = taskType === "partner" ? 1 : minClicksFromSettings;
      const parsedClicksRequired = Number(totalClicksRequired);
      if (!Number.isFinite(parsedClicksRequired) || !Number.isInteger(parsedClicksRequired) || parsedClicksRequired <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid number of completions"
        });
      }
      const isValidPackageSize = (taskType === 'bot' ? BOT_PACKAGE_SIZES : CHANNEL_PACKAGE_SIZES).includes(parsedClicksRequired);
      if (!isValidPackageSize && parsedClicksRequired < minClicks) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minClicks} clicks required`
        });
      }

      // Partner tasks are free and always use Telegram verification
      if (taskType === "partner") {
        // Partner tasks always require verification via Telegram Bot API
        const useVerification = verificationRequired !== false; // default true for partner tasks
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired: parsedClicksRequired,
          costPerClick: "0",
          totalCost: "0",
          status: "running",
          verificationRequired: true, // Partner tasks always require Telegram verification
          channelVerified: channelVerified || false,
        });

        console.log('✅ Partner task created:', task);

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        return res.json({
          success: true,
          message: "Partner task created successfully",
          task
        });
      }

      // Use the userData already fetched for partner task validation
      const user = userData;

      // Admin users: free task creation
      // Regular users: use TON tokens
      if (userIsAdmin) {
        console.log('🔑 Admin task creation - FREE (no charge)');

        // Create task for free (admin always gets 0 cost)
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired: parsedClicksRequired,
          costPerClick: "0",
          totalCost: "0",
          status: "running",
          verificationRequired: verificationRequired === true,
          channelVerified: channelVerified === true,
        });

        console.log('✅ Admin task saved to database:', task);

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        return res.json({
          success: true,
          message: "Task created successfully",
          task
        });
      } else {
        // Regular users: TON-based costs from package pricing table
        console.log('👤 Regular user task creation - using package pricing (TON)');

        // Channel pricing remains unchanged. Bots use a separate 200-click
        // entry package priced at 0.2 TON.
        const CHANNEL_PACKAGES = [
          { clicks: 100,   price: 0.1500, verified: 0.2000 },
          { clicks: 500,   price: 0.7500, verified: 1.0000 },
          { clicks: 1000,  price: 1.5000, verified: 2.0000 },
          { clicks: 2000,  price: 3.0000, verified: 4.0000 },
          { clicks: 5000,  price: 7.5000, verified: 10.000 },
          { clicks: 10000, price: 15.000, verified: 20.000 },
        ];
        const BOT_PACKAGES = [
          { clicks: 200,   price: 0.2000, verified: 0.2000 },
          ...CHANNEL_PACKAGES.slice(1),
        ];

        const pkg = (taskType === 'bot' ? BOT_PACKAGES : CHANNEL_PACKAGES).find(p => p.clicks === parsedClicksRequired);
        const totalCostTON = pkg
          ? (verificationRequired === true ? pkg.verified : pkg.price)
          : (() => {
              // Fallback per-click rate for non-standard counts
              const rate = verificationRequired === true ? 0.0002 : 0.00015;
              return parseFloat((rate * parsedClicksRequired).toFixed(8));
            })();
        const costPerClickTON = totalCostTON / parsedClicksRequired;

        // Fetch TON balance
        const [userTonData] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));

        const currentTONBalance = parseFloat(userTonData?.tonBalance || '0');

        console.log('💰 Payment check (TON):', { currentTONBalance, totalCostTON, sufficient: currentTONBalance >= totalCostTON });

        if (currentTONBalance < totalCostTON) {
          return res.status(400).json({
            success: false,
            message: `Insufficient TON. You need ${totalCostTON.toFixed(4)} TON to create this task.`
          });
        }

        // Deduct TON balance
        const newTONBalance = (currentTONBalance - totalCostTON).toFixed(10);
        await db
          .update(users)
          .set({ tonBalance: newTONBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));

        console.log('✅ Payment deducted (TON):', { oldBalance: currentTONBalance, newBalance: newTONBalance, deducted: totalCostTON });

        // Create task FIRST so we have the real ID for the transaction log
        const task = await storage.createTask({
          advertiserId: userId,
          taskType,
          title,
          link,
          totalClicksRequired: parsedClicksRequired,
          costPerClick: costPerClickTON.toFixed(10),
          totalCost: totalCostTON.toFixed(10),
          status: "under_review",
          verificationRequired: verificationRequired === true,
          channelVerified: channelVerified === true,
        });

        console.log('✅ Task saved to database:', task);

        // Log transaction AFTER task creation so taskId and link are recorded
        await storage.logTransaction({
          userId,
          amount: totalCostTON.toFixed(10),
          type: "deduction",
          source: "task_creation",
          description: `Created ${taskType} task: ${title}`,
          metadata: { taskId: task.id, taskType, title, link, totalClicksRequired: parsedClicksRequired, paymentMethod: 'TON' }
        });

        broadcastUpdate({
          type: 'task:created',
          task: task
        });

        // Send notification to admin about new task submission
        try {
          const adminNotification = `📝 <b>New Task Submitted</b>\n\nType: ${taskType}\nTitle: ${title}\nClicks: ${totalClicksRequired}\nCost: ${totalCostTON.toFixed(4)} TON\n\nPlease review.`;
          await sendTelegramMessage(adminNotification);
          console.log('📩 Admin notification sent for new task');
        } catch (notifyError) {
          console.error('Failed to send admin notification:', notifyError);
        }

        return res.json({
          success: true,
          message: "Task created successfully",
          task
        });
      }
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create task"
      });
    }
  });

  // Record task click (when publisher clicks on a task)
  app.post('/api/advertiser-tasks/:taskId/click', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramUserId = req.user?.telegramUser?.id || req.session?.user?.telegramUser?.id;
      const { taskId } = req.params;

      // For partner tasks or tasks with verificationRequired, enforce server-side Telegram verification (fail-closed)
      const task = await storage.getTaskById(taskId);
      if (task && (task.taskType === 'partner' || task.verificationRequired)) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        // Fail-closed: if we can't verify, block the claim
        if (!botToken) {
          return res.status(403).json({
            success: false,
            message: "Verification service is unavailable — please try again later",
            requiresVerification: true,
          });
        }
        if (!telegramUserId) {
          return res.status(403).json({
            success: false,
            message: "Could not identify your Telegram account — please re-open the app via Telegram",
            requiresVerification: true,
          });
        }
        if (!task.link) {
          return res.status(403).json({
            success: false,
            message: "Task has no verifiable link — contact support",
            requiresVerification: true,
          });
        }

        let channelId = task.link.trim();
        const urlMatch = channelId.match(/t\.me\/([^/?]+)/);
        if (urlMatch && urlMatch[1]) {
          const segment = urlMatch[1];
          if (!segment.startsWith('+') && !segment.startsWith('joinchat')) {
            channelId = `@${segment}`;
          } else {
            // Private invite link — cannot verify server-side, block claim
            return res.status(403).json({
              success: false,
              message: "Please join the channel via the invite link and then verify",
              requiresVerification: true,
            });
          }
        } else if (!channelId.startsWith('@') && !channelId.startsWith('-')) {
          channelId = `@${channelId}`;
        }

        // Verify membership for public channel usernames
        if (/^@[A-Za-z][A-Za-z0-9_]{2,31}$/.test(channelId)) {
          const isMember = await verifyChannelMembership(
            parseInt(String(telegramUserId)),
            channelId,
            botToken
          );
          if (!isMember) {
            return res.status(403).json({
              success: false,
              message: "Please join the channel/bot first and then verify before claiming this reward",
              requiresVerification: true,
            });
          }
        } else {
          // Unrecognized link format — fail-closed
          return res.status(403).json({
            success: false,
            message: "Cannot verify channel membership for this task — contact support",
            requiresVerification: true,
          });
        }
      }

      const result = await storage.recordTaskClick(taskId, userId);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      console.error("Error recording task click:", error);
      res.status(500).json({
        success: false,
        message: "Failed to record task click"
      });
    }
  });

  // Claim task reward (after user clicks on a task)
  app.post('/api/advertiser-tasks/:taskId/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      // Get the task click record
      const taskClick = await db
        .select()
        .from(taskClicks)
        .where(and(
          eq(taskClicks.taskId, taskId),
          eq(taskClicks.publisherId, userId)
        ))
        .limit(1);

      if (taskClick.length === 0) {
        return res.status(400).json({
          success: false,
          message: "You haven't clicked this task yet"
        });
      }

            // Check if already claimed
      if (taskClick[0].claimedAt) {
        return res.status(400).json({
          success: false,
          message: "You have already claimed the reward for this task"
        });
      }
      const rewardGems = parseInt(taskClick[0].rewardAmount || '0');
      const task = await storage.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      // Mark the pending click as claimed first. The click endpoint never pays;
      // this explicit claim is the only point where the reward is credited.
      const [claimedClick] = await db
        .update(taskClicks)
        .set({ claimedAt: new Date() })
        .where(and(
          eq(taskClicks.taskId, taskId),
          eq(taskClicks.publisherId, userId),
          sql`${taskClicks.claimedAt} IS NULL`,
        ))
        .returning({ id: taskClicks.id });
      if (!claimedClick) {
        return res.status(400).json({ success: false, message: "You have already claimed the reward for this task" });
      }
      const taskEarning = await storage.addEarning({
        userId,
        amount: String(rewardGems),
        source: 'task_completion',
        description: `Completed ${task.taskType} task: ${task.title}`,
      });
      await storage.processReferralCommission(userId, taskEarning.id, String(rewardGems));

      // Only a successful claim counts against the advertiser's paid click
      // limit. A user opening a task without claiming must not hide/complete it.
      await db.execute(sql`
        UPDATE advertiser_tasks
        SET current_clicks = current_clicks + 1,
            status = CASE
              WHEN current_clicks + 1 >= total_clicks_required THEN 'completed'
              ELSE status
            END,
            completed_at = CASE
              WHEN current_clicks + 1 >= total_clicks_required THEN COALESCE(completed_at, NOW())
              ELSE completed_at
            END,
            updated_at = NOW()
        WHERE id = ${taskId}
      `);

      console.log(`✅ Task reward claimed: ${taskId} by ${userId} - Reward: ${rewardGems} Gems`);
      res.json({
        success: true,
        message: `Reward claimed! +${rewardGems} Gems`,
        reward: rewardGems,
      });
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({
        success: false,
        message: "Failed to claim task reward"
      });
    }
  });

  // Increase task click limit
  // Per-user+task in-flight lock — prevents double-submission from rapid taps
  const _increaseLimitInFlight = new Set<string>();

  app.post('/api/advertiser-tasks/:taskId/increase-limit', authenticateTelegram, async (req: any, res) => {
    const userId = req.user.user.id;
    const { taskId } = req.params;
    const lockKey = `${userId}:${taskId}`;

    if (_increaseLimitInFlight.has(lockKey)) {
      return res.status(409).json({ success: false, message: "A request for this task is already being processed. Please wait." });
    }
    _increaseLimitInFlight.add(lockKey);

    try {
      // ── Strict input validation ──────────────────────────────────────────
      const rawClicks = req.body?.additionalClicks;
      const additionalClicks = Math.floor(Number(rawClicks));
      if (!Number.isFinite(additionalClicks) || additionalClicks <= 0) {
        return res.status(400).json({ success: false, message: "additionalClicks must be a positive integer" });
      }

      // Minimum clicks from admin settings
      const addMinClicksSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_clicks')).limit(1);
      const minAddClicks = parseInt(addMinClicksSetting[0]?.settingValue || '500');
      if (additionalClicks < minAddClicks) {
        return res.status(400).json({ success: false, message: `Minimum ${minAddClicks} additional clicks required` });
      }

      // ── Ownership check (outside transaction — read-only) ────────────────
      const task = await storage.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }
      if (task.advertiserId !== userId) {
        return res.status(403).json({ success: false, message: "You don't own this task" });
      }

      // ── Cost calculation using package pricing ────────────────────────────────
      const [userRow] = await db
        .select({ tonBalance: users.tonBalance, usdBalance: users.usdBalance, telegram_id: users.telegram_id })
        .from(users).where(eq(users.id, userId)).limit(1);

      if (!userRow) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Package pricing — mirrors frontend CreatePanel.tsx PACKAGES
      const ADD_CLICKS_PACKAGES = [
        { clicks: 100,   price: 0.1500, verified: 0.2000 },
        { clicks: 500,   price: 0.7500, verified: 1.0000 },
        { clicks: 1000,  price: 1.5000, verified: 2.0000 },
        { clicks: 2000,  price: 3.0000, verified: 4.0000 },
        { clicks: 5000,  price: 7.5000, verified: 10.000 },
        { clicks: 10000, price: 15.000, verified: 20.000 },
      ];

      const isVerifiedTask = task.verificationRequired === true;
      const addClicksPkg = ADD_CLICKS_PACKAGES.find(p => p.clicks === additionalClicks);
      const requiredAmount = addClicksPkg
        ? (isVerifiedTask ? addClicksPkg.verified : addClicksPkg.price)
        : (() => {
            const rate = isVerifiedTask ? 0.0002 : 0.00015;
            return parseFloat((rate * additionalClicks).toFixed(8));
          })();
      const additionalCost = requiredAmount.toFixed(8);
      const userIsAdminFlag = isAdmin(userRow.telegram_id || '');

      // Pre-flight balance check (outside transaction — fail fast)
      if (userIsAdminFlag) {
        const currentUSD = parseFloat(userRow.usdBalance || '0');
        if (currentUSD < requiredAmount) {
          return res.status(400).json({ success: false, message: "Insufficient USD balance. Please top up your USD balance." });
        }
      } else {
        const currentTON = parseFloat(userRow.tonBalance || '0');
        if (currentTON < requiredAmount) {
          return res.status(400).json({ success: false, message: "Insufficient TON. You need TON to add more clicks." });
        }
      }

      // ── Atomic transaction: deduct → increase limit → log ───────────────
      let updatedTask: any;
      await db.transaction(async (tx) => {
        if (userIsAdminFlag) {
          console.log('🔑 Admin adding clicks - using USD balance');
          const [freshUser] = await tx.select({ usdBalance: users.usdBalance }).from(users).where(eq(users.id, userId));
          const currentUSD = parseFloat(freshUser?.usdBalance || '0');
          if (currentUSD < requiredAmount) throw new Error("Insufficient USD balance.");
          const newUSD = (currentUSD - requiredAmount).toFixed(10);
          await tx.update(users).set({ usdBalance: newUSD, updatedAt: new Date() }).where(eq(users.id, userId));
          console.log('✅ Payment deducted (USD):', { currentUSD, newUSD, deducted: additionalCost });
        } else {
          console.log('👤 Regular user adding clicks - using TON balance');
          const [freshUser] = await tx.select({ tonBalance: users.tonBalance }).from(users).where(eq(users.id, userId));
          const currentTON = parseFloat(freshUser?.tonBalance || '0');
          if (currentTON < requiredAmount) throw new Error("Insufficient TON.");
          const newTON = (currentTON - requiredAmount).toFixed(8);
          await tx.update(users).set({ tonBalance: newTON, updatedAt: new Date() }).where(eq(users.id, userId));
          console.log('✅ Payment deducted (TON):', { currentTON, newTON, deducted: additionalCost });
        }

        // Increase task limit
        const [result] = await tx
          .update(advertiserTasks)
          .set({ totalClicksRequired: sql`${advertiserTasks.totalClicksRequired} + ${additionalClicks}`, updatedAt: new Date() })
          .where(eq(advertiserTasks.id, taskId))
          .returning();
        if (!result) throw new Error("Task update failed — task may have been deleted.");
        updatedTask = result;

        // Log transaction
        await tx.insert(transactions).values({
          userId,
          amount: additionalCost,
          type: "deduction",
          source: "task_limit_increase",
          description: `Increased limit for task: ${task.title}`,
          metadata: { taskId, additionalClicks },
          createdAt: new Date(),
        } as any);
      });

      res.json({ success: true, message: "Task limit increased successfully", task: updatedTask });
    } catch (error: any) {
      console.error("Error increasing task limit:", error);
      const msg = error?.message || "Failed to increase task limit";
      // Business errors thrown inside the transaction surface as 400/409; unexpected failures as 500
      if (msg.includes("Insufficient")) {
        return res.status(400).json({ success: false, message: msg });
      }
      if (msg.includes("already being processed") || msg.includes("conflict")) {
        return res.status(409).json({ success: false, message: msg });
      }
      res.status(500).json({ success: false, message: "Failed to increase task limit" });
    } finally {
      _increaseLimitInFlight.delete(lockKey);
    }
  });

  // Check if user has clicked a task
  app.get('/api/advertiser-tasks/:taskId/has-clicked', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const hasClicked = await storage.hasUserClickedTask(taskId, userId);

      res.json({ success: true, hasClicked });
    } catch (error) {
      console.error("Error checking task click:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check task click status"
      });
    }
  });

  // User pause their own task
  app.post('/api/advertiser-tasks/:taskId/pause', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.advertiserId !== userId) {
        return res.status(403).json({ success: false, message: "You can only pause your own tasks" });
      }

      if (task.status !== "running") {
        return res.status(400).json({ success: false, message: "Only running tasks can be paused" });
      }

      const updatedTask = await storage.pauseTask(taskId);
      console.log(`⏸️ Task ${taskId} paused by owner ${userId}`);

      res.json({ success: true, task: updatedTask, message: "Task paused" });
    } catch (error) {
      console.error("Error pausing task:", error);
      res.status(500).json({ success: false, message: "Failed to pause task" });
    }
  });

  // User resume their own task
  app.post('/api/advertiser-tasks/:taskId/resume', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      const task = await storage.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({ success: false, message: "Task not found" });
      }

      if (task.advertiserId !== userId) {
        return res.status(403).json({ success: false, message: "You can only resume your own tasks" });
      }

      if (task.status !== "paused") {
        return res.status(400).json({ success: false, message: "Only paused tasks can be resumed" });
      }

      const updatedTask = await storage.resumeTask(taskId);
      console.log(`▶️ Task ${taskId} resumed by owner ${userId}`);

      res.json({ success: true, task: updatedTask, message: "Task resumed" });
    } catch (error) {
      console.error("Error resuming task:", error);
      res.status(500).json({ success: false, message: "Failed to resume task" });
    }
  });

  // Delete advertiser task
  app.delete('/api/advertiser-tasks/:taskId', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { taskId } = req.params;

      console.log('🗑️ Delete task request:', { userId, taskId });

      // Get task details
      const [task] = await db
        .select()
        .from(advertiserTasks)
        .where(eq(advertiserTasks.id, taskId));

      if (!task) {
        return res.status(404).json({
          success: false,
          message: "Task not found"
        });
      }

      // Verify ownership
      if (task.advertiserId !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only delete your own tasks"
        });
      }

      // Calculate refund amount for remaining clicks
      const remainingClicks = task.totalClicksRequired - task.currentClicks;
      const refundAmount = (parseFloat(task.costPerClick) * remainingClicks).toFixed(8);

      console.log('💰 Refund calculation:', {
        totalClicks: task.totalClicksRequired,
        currentClicks: task.currentClicks,
        remainingClicks,
        costPerClick: task.costPerClick,
        refundAmount
      });

      // Delete task and refund user in a transaction
      await db.transaction(async (tx) => {
        // Delete associated clicks first to avoid foreign key constraint issues
        await tx
          .delete(taskClicks)
          .where(eq(taskClicks.taskId, taskId));

        // Delete the task
        await tx
          .delete(advertiserTasks)
          .where(eq(advertiserTasks.id, taskId));

        // Refund remaining balance if any
        if (parseFloat(refundAmount) > 0) {
          const [user] = await tx
            .select({
              tonBalance: users.tonBalance,
              telegram_id: users.telegram_id
            })
            .from(users)
            .where(eq(users.id, userId));

          if (user) {
            const userIsAdminFlag = isAdmin(user.telegram_id || '');

            if (userIsAdminFlag) {
              // Admin: Refund to USD balance
              const [adminUser] = await tx
                .select({ usdBalance: users.usdBalance })
                .from(users)
                .where(eq(users.id, userId));

              const newUSDBalance = (parseFloat(adminUser?.usdBalance || '0') + parseFloat(refundAmount)).toFixed(10);
              await tx
                .update(users)
                .set({ usdBalance: newUSDBalance, updatedAt: new Date() })
                .where(eq(users.id, userId));

              console.log('✅ Admin refund processed (USD):', { oldBalance: adminUser?.usdBalance, refundAmount, newBalance: newUSDBalance });
            } else {
              // Non-admin: Refund to TON balance
              const newTONBalance = (parseFloat(user.tonBalance || '0') + parseFloat(refundAmount)).toFixed(8);
              await tx
                .update(users)
                .set({ tonBalance: newTONBalance, updatedAt: new Date() })
                .where(eq(users.id, userId));

              console.log('✅ User refund processed (TON):', { oldBalance: user.tonBalance, refundAmount, newBalance: newTONBalance });
            }

            // Log transaction
            await storage.logTransaction({
              userId,
              amount: refundAmount,
              type: "credit",
              source: "task_deletion_refund",
              description: `Refund for deleting task: ${task.title} (${userIsAdminFlag ? 'USD' : 'TON'})`,
              metadata: { taskId, remainingClicks, currency: userIsAdminFlag ? 'USD' : 'TON' }
            });
          }
        }
      });

      console.log('✅ Task deleted successfully:', taskId);

      res.json({
        success: true,
        message: "Task deleted successfully",
        refundAmount
      });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete task"
      });
    }
  });

  // Verify channel for bot admin
  app.post('/api/advertiser-tasks/verify-channel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { channelLink } = req.body;

      console.log('🔍 Channel verification request:', { userId, channelLink });

      // Validate channel link
      if (!channelLink || !channelLink.includes('t.me/')) {
        return res.status(400).json({
          success: false,
          message: "Invalid channel link"
        });
      }

      // Normalize a public Telegram channel link/username for getChat().
      // The previous implementation compared usernames returned by
      // getChatAdministrators, which can be missing/obfuscated even when the bot
      // is actually an administrator. The structured helper checks the bot's
      // numeric Telegram ID instead.
      const rawChannel = channelLink.trim();
      const match = rawChannel.match(/(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#]+)/i);
      const channelSegment = match?.[1] || rawChannel.replace(/^@/, '').replace(/[/?#].*$/, '');

      if (!channelSegment || channelSegment.startsWith('+') || channelSegment.toLowerCase().startsWith('joinchat') || channelSegment.toLowerCase() === 'c') {
        return res.status(400).json({
          success: false,
          message: "Use a public channel link such as https://t.me/YourChannel. Private invite links cannot be verified."
        });
      }

      const channelIdentifier = channelSegment.startsWith('-')
        ? channelSegment
        : `@${channelSegment}`;

      // Check if bot token is configured
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        console.warn('⚠️ TELEGRAM_BOT_TOKEN not configured - skipping actual verification');
        return res.json({
          success: true,
          message: "Channel verification successful (dev mode)",
          verified: true
        });
      }

      try {
        const permissionCheck = await checkBotCanPostToChannel(botToken, channelIdentifier);

        if (!permissionCheck.isAdmin) {
          console.error('❌ Bot channel-admin verification failed:', {
            channelIdentifier,
            error: permissionCheck.error,
            chatId: permissionCheck.chatId,
            chatType: permissionCheck.chatType,
          });
          return res.status(400).json({
            success: false,
            message: permissionCheck.error === 'Telegram API error fetching membership' || !permissionCheck.chatId
              ? "Could not access channel. Check the public channel link and make sure the bot is added as an administrator."
              : "The bot is not an administrator in this channel. Please add it as an administrator first."
          });
        }

        // Creating a verified task only requires administrator access. Posting
        // permission is reported for diagnostics but is not incorrectly treated
        // as proof that the bot is absent.
        console.log('✅ Channel bot admin verified:', {
          channelIdentifier,
          chatId: permissionCheck.chatId,
          chatType: permissionCheck.chatType,
          hasPostPermission: permissionCheck.hasPostPermission,
        });

        return res.json({
          success: true,
          message: permissionCheck.hasPostPermission
            ? "Channel verified successfully"
            : "Channel verified successfully. Add Post Messages permission if this task needs bot posting.",
          verified: true,
          chatId: permissionCheck.chatId,
          chatType: permissionCheck.chatType,
          hasPostPermission: permissionCheck.hasPostPermission,
        });
      } catch (error) {
        console.error('❌ Error verifying channel:', error);
        return res.status(500).json({
          success: false,
          message: "Failed to verify channel. Please try again."
        });
      }
    } catch (error) {
      console.error("Error in channel verification:", error);
      res.status(500).json({
        success: false,
        message: "Failed to verify channel"
      });
    }
  });

  // Proxy a Telegram channel/bot's profile photo — never expose the bot token
  // (Telegram's file download URL embeds it) to the client, so we stream the
  // image bytes back through our own server instead of returning a raw URL.
  //
  // NOTE: intentionally NOT behind authenticateTelegram. This is rendered via
  // plain <img src="..."> tags, which cannot attach the x-telegram-data header
  // the rest of the app relies on — they can only send cookies. That made this
  // route silently 401 (and every mission image fall back to a placeholder
  // icon) whenever the session cookie didn't survive a cross-origin request
  // (the frontend fetch() calls use credentials:"include" for exactly this
  // reason, but the session cookie has no `sameSite: 'none'`, so browsers drop
  // it cross-site). The response here is just a public Telegram chat photo —
  // there's no user data to protect — so it's safe to serve unauthenticated.
  app.get('/api/advertiser-tasks/avatar', async (req: any, res) => {
    try {
      const link = String(req.query.link || '').trim();
      // Advertisers type this field freehand, so accept every shape it's
      // realistically entered in: a full t.me/telegram.me/telegram.dog URL,
      // a bare "@username", or just "username" with no link at all.
      const domainMatch = link.match(/(?:t\.me|telegram\.me|telegram\.dog)\/([^/?#]+)/i);
      const bareMatch = !domainMatch ? link.match(/^@?([a-zA-Z0-9_]{5,32})$/) : null;
      const username = domainMatch?.[1] || bareMatch?.[1];
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!username || username.startsWith('+') || username === 'joinchat') {
        // Private invite links (+hash / joinchat) have no public username and
        // no public preview page — neither avatar path can resolve these.
        console.warn(`⚠️ [avatar] link did not resolve to a public username: "${link}"`);
        return res.status(404).end();
      }
      console.log(`🔎 [avatar] request for link="${link}" → resolved username="${username}"`);
      if (!botToken) {
        // Path 1 (Bot API) is unavailable without a token, but Path 2 (og:image
        // scrape) needs no token at all, so we can still serve an avatar.
        console.warn('⚠️ [avatar] TELEGRAM_BOT_TOKEN not configured — falling back to t.me preview scraping only');
      }


      // ── Serve from in-memory cache if fresh (avoids Telegram API round-trips) ─
      const cached = _avatarCache.get(username);
      if (cached && Date.now() - cached.at < AVATAR_TTL) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.end(cached.buf);
      }

      // ── Negative cache — a username with no photo, or a failed lookup, gets
      // re-tried on EVERY page load otherwise (this was a big contributor to
      // the Missions page feeling slow: N tasks × 2-3 unbounded Telegram calls
      // each, every single time). Short TTL so a photo added later still shows
      // up reasonably quickly.
      const negCached = _avatarNegativeCache.get(username);
      if (negCached && Date.now() - negCached.at < AVATAR_NEGATIVE_TTL) {
        return res.status(404).end();
      }

      // ── Coalesce concurrent requests for the same username — several tasks
      // can reference the same channel/bot and would otherwise each fire their
      // own redundant round-trip to Telegram at the same time.
      let inFlight = _avatarInFlight.get(username);
      if (!inFlight) {
        inFlight = (async () => {
          // Path 1: Bot API. Reliable for channels/groups; always fails for
          // bots (see fetchAvatarViaBotApi comment) — that failure is expected
          // and just means we move on to Path 2, not a real error.
          if (botToken) {
            try {
              const viaBotApi = await fetchAvatarViaBotApi(username, botToken);
              if (viaBotApi) return viaBotApi;
            } catch (err) {
              console.warn(`⚠️ [avatar] Bot API path threw for @${username}, falling back to og:image:`, err instanceof Error ? err.message : err);
            }
          }

          // Path 2: public t.me preview page og:image. Covers bots (where
          // Path 1 can never work) and acts as a safety net for channels/groups
          // whenever getChat fails for any other reason.
          try {
            const viaOgImage = await fetchAvatarViaOgImage(username);
            if (viaOgImage) return viaOgImage;
          } catch (err) {
            console.warn(`⚠️ [avatar] og:image path threw for @${username}:`, err instanceof Error ? err.message : err);
          }

          return null;
        })().finally(() => _avatarInFlight.delete(username));

        _avatarInFlight.set(username, inFlight);
      }

      const result = await inFlight;
      if (!result) {
        console.warn(`❌ [avatar] both paths failed for @${username} — no photo available (or Telegram unreachable from this server)`);
        _avatarNegativeCache.set(username, { at: Date.now() });
        return res.status(404).end();
      }

      console.log(`✅ [avatar] served @${username} (${result.buf.length} bytes, ${result.contentType})`);
      _avatarCache.set(username, { buf: result.buf, contentType: result.contentType, at: Date.now() });
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(result.buf);
    } catch (err) {
      // Redact — Telegram fetch errors can embed the bot token in the failed URL.
      const safe = err instanceof Error ? err.message.replace(/bot\d+:[\w-]+/g, 'bot[REDACTED]') : 'unknown error';
      console.error('❌ [avatar] Error fetching chat avatar:', safe);
      res.status(404).end();
    }
  });

  // ── TON Deposit Verification (with on-chain check via TON Center API) ───────
  const DEPOSIT_WALLET = 'UQCW9LwFkPRsLOVsGfl-65t9AJsfPXs8fTpDDEJL_RQhwPvJ';

  // Verify transaction actually landed on-chain at the deposit wallet
  // Uses TonCenter v3 API (v2 returns LITE_SERVER_UNKNOWN errors)
  async function verifyTonTransaction(expectedNano: bigint, windowMs = 30 * 60 * 1000): Promise<{ verified: boolean; txHash?: string; actualNano?: bigint }> {
    try {
      const url = `https://toncenter.com/api/v3/transactions?account=${DEPOSIT_WALLET}&limit=50&sort=desc`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        console.warn(`⚠️ TON Center v3 API returned ${resp.status} — skipping on-chain check`);
        return { verified: false };
      }
      const data = await resp.json() as any;
      // v3 returns { transactions: [...] }
      const txs: any[] = data.transactions ?? [];
      if (!Array.isArray(txs) || txs.length === 0) return { verified: false };

      const nowSec = Math.floor(Date.now() / 1000);
      const windowSec = Math.floor(windowMs / 1000);

      for (const tx of txs) {
        // v3 uses tx.now (unix timestamp) instead of tx.utime
        const txTime: number = tx.now ?? 0;
        if (nowSec - txTime > windowSec) continue; // outside window

        // in_msg.value is the amount in nanotons
        const incoming = tx.in_msg;
        if (!incoming || !incoming.value) continue;

        const inNano = BigInt(incoming.value);
        // Allow up to 1,000,000 nanoton (0.001 TON) tolerance for gas/fees
        if (inNano >= expectedNano - 1n && inNano <= expectedNano + 1_000_000n) {
          // v3 uses tx.hash directly
          const txHash: string = tx.hash ?? '';
          console.log(`✅ On-chain TX verified (v3): hash=${txHash} nano=${inNano} time=${txTime}`);
          return { verified: true, txHash, actualNano: inNano };
        }
      }

      return { verified: false };
    } catch (err) {
      console.warn('⚠️ TON on-chain verification error:', err);
      return { verified: false };
    }
  }

  app.post('/api/ton/deposit/verify', requireAuth, async (req: any, res) => {
    try {
      const userId: string = req.user.user.id;

      const { boc, amount } = req.body;
      if (!boc || !amount) {
        return res.status(400).json({ success: false, message: 'Missing boc or amount' });
      }

      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount < 0.1) {
        return res.status(400).json({ success: false, message: 'Invalid deposit amount' });
      }

      const { tonDeposits } = await import('../shared/schema');

      // Duplicate-prevention: check if this BOC was already processed
      const existing = await db.select().from(tonDeposits).where(eq(tonDeposits.boc, boc)).limit(1);
      if (existing.length > 0 && existing[0].status === 'confirmed') {
        return res.status(409).json({ success: false, message: 'This transaction has already been processed.' });
      }

      // ── On-chain verification via TON Center API ──────────────────────────
      const expectedNano = BigInt(Math.round(depositAmount * 1_000_000_000));
      const { verified, txHash, actualNano } = await verifyTonTransaction(expectedNano);

      if (!verified) {
        // Record as pending — do NOT credit yet
        await db.insert(tonDeposits).values({
          userId,
          amount: depositAmount.toString(),
          boc,
          status: 'pending',
        }).onConflictDoNothing();

        console.warn(`⚠️ TON deposit NOT verified on-chain: userId=${userId} amount=${depositAmount}`);
        return res.status(202).json({
          success: false,
          pending: true,
          message: 'Transaction not yet visible on blockchain. Your balance will be credited within 5 minutes once confirmed.',
        });
      }

      // ── Atomic claim + credit — all inside ONE transaction so confirm & balance update never split ─
      // Strategy:
      //   1. Try UPDATE existing pending record → confirmed (WHERE status='pending')
      //   2. If no pending row, check txHash duplicate, then INSERT as confirmed
      //   3. If both fail → already confirmed; return 409 (no double credit)
      //   Balance update & transaction log happen inside the same DB transaction as the claim.

      const actualAmount = actualNano ? Number(actualNano) / 1_000_000_000 : depositAmount;

      let newTonBalance: string;

      try {
        newTonBalance = await db.transaction(async (tx) => {
          // Step 1: claim by updating existing pending record (original BOC key)
          const claimed = await tx.update(tonDeposits)
            .set({ status: 'confirmed', confirmedAt: new Date() } as any)
            .where(and(eq(tonDeposits.boc, boc), eq(tonDeposits.status as any, 'pending')))
            .returning({ id: tonDeposits.id });

          if (claimed.length === 0) {
            // Step 2: no pending row with this BOC — check if txHash was already confirmed
            if (txHash) {
              const hashExists = await tx.select({ status: tonDeposits.status }).from(tonDeposits).where(eq(tonDeposits.boc, txHash)).limit(1);
              if (hashExists.length > 0 && hashExists[0].status === 'confirmed') {
                throw Object.assign(new Error('already_credited'), { statusCode: 409 });
              }
            }
            // Try inserting as a fresh confirmed record (BOC = original boc, txHash in metadata)
            const inserted = await tx.insert(tonDeposits).values({
              userId,
              amount: actualAmount.toString(),
              boc,   // always use original BOC — prevents poller picking it up again
              status: 'confirmed',
              confirmedAt: new Date(),
            }).onConflictDoNothing().returning({ id: tonDeposits.id });

            if (inserted.length === 0) {
              throw Object.assign(new Error('already_processed'), { statusCode: 409 });
            }
          }

          // Credit balance inside the same transaction — atomic with the claim above
          const [currentUser] = await tx.select({ tonBalance: users.tonBalance }).from(users).where(eq(users.id, userId)).limit(1);
          if (!currentUser) throw Object.assign(new Error('user_not_found'), { statusCode: 404 });

          const bal = (parseFloat(currentUser.tonBalance || '0') + actualAmount).toFixed(10);

          await tx.update(users)
            .set({ tonBalance: bal, updatedAt: new Date() })
            .where(eq(users.id, userId));

          await tx.insert(transactions).values({
            userId,
            amount: actualAmount.toString(),
            type: 'addition',
            source: 'ton_deposit',
            description: `TON deposit verified on-chain: ${actualAmount} TON`,
            metadata: { boc: boc.slice(0, 64), txHash },
          });

          return bal;
        });
      } catch (txErr: any) {
        if (txErr?.statusCode === 409 && txErr?.message === 'already_credited') {
          return res.status(409).json({ success: false, message: 'This transaction has already been credited.' });
        }
        if (txErr?.statusCode === 409 && txErr?.message === 'already_processed') {
          return res.status(409).json({ success: false, message: 'This transaction has already been processed.' });
        }
        if (txErr?.statusCode === 404) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        throw txErr; // re-throw to outer catch
      }

      console.log(`✅ TON deposit credited: userId=${userId} amount=${actualAmount} TON newBalance=${newTonBalance} txHash=${txHash}`);

      return res.json({
        success: true,
        message: `${actualAmount.toFixed(2)} TON credited to your account.`,
        amount: actualAmount,
        newBalance: newTonBalance,
      });
    } catch (err: any) {
      console.error('❌ TON deposit error:', err);
      return res.status(500).json({ success: false, message: 'Deposit processing failed. Your funds will be credited within 5 minutes.' });
    }
  });

  // ── TON Deposit Status — polled by frontend to auto-confirm pending deposits ─
  app.get('/api/ton/deposit/status', requireAuth, async (req: any, res) => {
    try {
      const userId: string = req.user.user.id;
      const { boc } = req.query as { boc?: string };
      if (!boc) return res.json({ confirmed: false });

      const { tonDeposits } = await import('../shared/schema');
      const [dep] = await db
        .select({ status: tonDeposits.status })
        .from(tonDeposits)
        .where(eq(tonDeposits.boc, boc))
        .limit(1);

      if (!dep || dep.status !== 'confirmed') return res.json({ confirmed: false });

      // Deposit confirmed — return fresh TON balance so frontend can update instantly
      const [currentUser] = await db
        .select({ tonBalance: users.tonBalance })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return res.json({ confirmed: true, tonBalance: currentUser?.tonBalance ?? '0' });
    } catch (err) {
      console.error('❌ TON deposit status error:', err);
      return res.json({ confirmed: false });
    }
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // ── One-hour mining cycle ────────────────────────────────────────────────────
  // Mining state is stored on users so it survives reloads and server restarts.
  app.get('/api/farming/state', authenticateTelegram, async (req: any, res: any) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Authentication required' });
      const [user] = await db.select({ miningStartedAt: users.miningStartedAt, miningBoostMultiplier: users.miningBoostMultiplier, miningBoostStep: users.miningBoostStep, miningAccruedGold: users.miningAccruedGold, miningLastAccrualAt: users.miningLastAccrualAt })
        .from(users).where(eq(users.id, userId)).limit(1);
      const startedAt = user?.miningStartedAt ? new Date(user.miningStartedAt).getTime() : 0;
      const elapsedSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
      const remainingSeconds = startedAt ? Math.max(0, MINING_DURATION_SECONDS - elapsedSeconds) : 0;
      const multiplier = Math.max(1, Number(user?.miningBoostMultiplier || 1));
      const lastAccrualAt = user?.miningLastAccrualAt ? new Date(user.miningLastAccrualAt).getTime() : startedAt;
      const segmentSeconds = startedAt ? Math.max(0, Math.min(Date.now(), startedAt + MINING_DURATION_SECONDS * 1000) - lastAccrualAt) / 1000 : 0;
      const minedGold = Math.min(MINING_BASE_RATE_PER_HOUR * multiplier, Number(user?.miningAccruedGold || 0) + (segmentSeconds / 3600) * MINING_BASE_RATE_PER_HOUR * multiplier);
      res.json({ isActive: Boolean(startedAt), isComplete: Boolean(startedAt && remainingSeconds === 0), startedAt: startedAt ? new Date(startedAt).toISOString() : null, remainingSeconds, minedAxn: Number(minedGold.toFixed(4)), minedGold: Number(minedGold.toFixed(4)), baseRatePerHour: MINING_BASE_RATE_PER_HOUR, effectiveRate: MINING_BASE_RATE_PER_HOUR * multiplier, multiplier, boostStep: Number(user?.miningBoostStep || 0), maxBoost: MINING_BOOSTS[MINING_BOOSTS.length - 1] });
    } catch (error) {
      console.error('❌ Mining state error:', error);
      res.status(500).json({ message: 'Could not load mining state' });
    }
  });

  app.post('/api/farming/start', authenticateTelegram, async (req: any, res: any) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Authentication required' });
      const [user] = await db.select({ miningStartedAt: users.miningStartedAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (user?.miningStartedAt) {
        const elapsedSeconds = Math.floor((Date.now() - new Date(user.miningStartedAt).getTime()) / 1000);
        return res.status(409).json({ message: elapsedSeconds < MINING_DURATION_SECONDS ? 'Mining is already active' : 'Claim the completed mining cycle before starting a new one' });
      }
      const startedAt = new Date();
      await db.update(users).set({ miningStartedAt: startedAt, miningBoostMultiplier: '1', miningBoostStep: 0, miningAccruedGold: '0', miningLastAccrualAt: startedAt, updatedAt: startedAt }).where(eq(users.id, userId));
      res.json({ success: true, startedAt: startedAt.toISOString(), durationSeconds: MINING_DURATION_SECONDS, multiplier: 1 });
    } catch (error) {
      console.error('❌ Mining start error:', error);
      res.status(500).json({ message: 'Could not start mining' });
    }
  });

  app.post('/api/farming/boost', authenticateTelegram, async (req: any, res: any) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Authentication required' });
      const [user] = await db.select({ miningStartedAt: users.miningStartedAt, miningBoostMultiplier: users.miningBoostMultiplier, miningBoostStep: users.miningBoostStep, miningAccruedGold: users.miningAccruedGold, miningLastAccrualAt: users.miningLastAccrualAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.miningStartedAt || Date.now() - new Date(user.miningStartedAt).getTime() >= MINING_DURATION_SECONDS * 1000) return res.status(400).json({ message: 'Start a new mining cycle before boosting it' });
      const currentStep = Math.max(0, Number(user.miningBoostStep || 0));
      if (currentStep >= MINING_BOOSTS.length - 1) return res.json({ success: true, multiplier: MINING_BOOSTS[MINING_BOOSTS.length - 1], boostStep: currentStep, maxed: true });
      const nextStep = currentStep + 1;
      const multiplier = MINING_BOOSTS[nextStep];
      const now = new Date();
      const startedAt = new Date(user.miningStartedAt).getTime();
      const lastAccrualAt = user.miningLastAccrualAt ? new Date(user.miningLastAccrualAt).getTime() : startedAt;
      const segmentSeconds = Math.max(0, Math.min(now.getTime(), startedAt + MINING_DURATION_SECONDS * 1000) - lastAccrualAt) / 1000;
      const accruedGold = Math.min(MINING_BASE_RATE_PER_HOUR * Number(user.miningBoostMultiplier || 1), Number(user.miningAccruedGold || 0) + (segmentSeconds / 3600) * MINING_BASE_RATE_PER_HOUR * Number(user.miningBoostMultiplier || 1));
      await db.update(users).set({ miningBoostStep: nextStep, miningBoostMultiplier: String(multiplier), miningAccruedGold: accruedGold.toFixed(10), miningLastAccrualAt: now, updatedAt: now }).where(eq(users.id, userId));
      res.json({ success: true, multiplier, boostStep: nextStep, maxed: nextStep >= MINING_BOOSTS.length - 1 });
    } catch (error) {
      console.error('❌ Mining boost error:', error);
      res.status(500).json({ message: 'Could not apply mining boost' });
    }
  });

  app.post('/api/farming/claim', authenticateTelegram, async (req: any, res: any) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Authentication required' });
      const [user] = await db.select({ balance: users.balance, miningStartedAt: users.miningStartedAt, miningBoostMultiplier: users.miningBoostMultiplier, miningAccruedGold: users.miningAccruedGold, miningLastAccrualAt: users.miningLastAccrualAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.miningStartedAt) return res.status(400).json({ message: 'No completed mining cycle to claim' });
      const elapsedSeconds = Math.floor((Date.now() - new Date(user.miningStartedAt).getTime()) / 1000);
      if (elapsedSeconds < MINING_DURATION_SECONDS) return res.status(400).json({ message: `Mining is still running. Claim available in ${Math.ceil((MINING_DURATION_SECONDS - elapsedSeconds) / 60)} minutes.` });
      const multiplier = Math.max(1, Number(user.miningBoostMultiplier || 1));
      const startedAt = new Date(user.miningStartedAt).getTime();
      const lastAccrualAt = user.miningLastAccrualAt ? new Date(user.miningLastAccrualAt).getTime() : startedAt;
      const segmentSeconds = Math.max(0, Math.min(Date.now(), startedAt + MINING_DURATION_SECONDS * 1000) - lastAccrualAt) / 1000;
      const reward = Number((Number(user.miningAccruedGold || 0) + (segmentSeconds / 3600) * MINING_BASE_RATE_PER_HOUR * multiplier).toFixed(4));
      await db.transaction(async (tx) => {
        await tx.update(users).set({ balance: sql`${users.balance} + ${reward}`, miningStartedAt: null, miningBoostMultiplier: '1', miningBoostStep: 0, miningAccruedGold: '0', miningLastAccrualAt: null, updatedAt: new Date() }).where(eq(users.id, userId));
        await tx.insert(earnings).values({ userId, amount: String(reward), source: 'mining', description: `1-hour mining cycle at ${multiplier}x boost`, currency: 'GOLD' });
      });
      res.json({ success: true, amount: reward, multiplier });
    } catch (error) {
      console.error('❌ Mining claim error:', error);
      res.status(500).json({ message: 'Could not claim mining reward' });
    }
  });

  // User withdrawal endpoints

  // Get user's withdrawal history - auth removed to prevent popup spam
  app.get('/api/withdrawals', authenticateTelegram, async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Withdrawal history requested without session - sending empty");
        return res.json({ success: true, skipAuth: true, withdrawals: [] });
      }

      // Get all user's withdrawals (show all statuses: pending, Approved, paid, rejected, etc.)
      const userWithdrawals = await db
        .select({
          id: withdrawals.id,
          amount: withdrawals.amount,
          goldAmount: withdrawals.goldAmount,
          cryptoAmount: withdrawals.cryptoAmount,
          usdValue: withdrawals.usdValue,
          payoutCurrency: withdrawals.payoutCurrency,
          method: withdrawals.method,
          status: withdrawals.status,
          details: withdrawals.details,
          comment: withdrawals.comment,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));

      res.json({
        success: true,
        withdrawals: userWithdrawals
      });

    } catch (error) {
      console.error('❌ Error fetching user withdrawals:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch withdrawals'
      });
    }
  });

  // Get user's deposit history (PDZ top-ups)
  app.get('/api/deposits/history', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.json({ success: true, deposits: [] });
      }

      // Get PDZ top-up transactions from transactions table
      const depositHistory = await db
        .select({
          id: transactions.id,
          amount: transactions.amount,
          type: transactions.type,
          source: transactions.source,
          createdAt: transactions.createdAt
        })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          eq(transactions.source, 'pdz_topup')
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(10);

      res.json({
        success: true,
        deposits: depositHistory.map(d => ({
          id: d.id,
          amount: d.amount,
          status: 'completed',
          createdAt: d.createdAt
        }))
      });

    } catch (error) {
      console.error('❌ Error fetching deposit history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch deposits'
      });
    }
  });

  // Create new withdrawal request
  app.post('/api/withdrawals', authenticateTelegram, requireVerifiedSession, withdrawRateLimit, async (req: any, res) => {
    try {
      if (req.user?.secondaryAccountBlocked) {
        return res.status(403).json({
          success: false,
          code: 'SECONDARY_ACCOUNT_BLOCKED',
          message: `This is not your active account. Your original account is ${req.user.primaryAccountName || 'the first account created on this device'}. Withdrawals are disabled here.`,
          primaryAccountName: req.user.primaryAccountName || null,
        });
      }
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        console.log("⚠️ Withdrawal requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      // ── Require fresh per-action Turnstile token ────────────────────────────
      if (!await checkActionTurnstile(req, res, 'withdrawal')) return;
      // ───────────────────────────────────────────────────────────────────────

      const { method, starPackage, withdrawalPackage, tonWalletAddress } = req.body;
      // axnAmount: new Gems-direct withdrawal (100,000 Gems = $1 USD)
      const axnAmountInput: number | null = req.body.axnAmount != null ? parseFloat(req.body.axnAmount) : null;
      // Legacy USD custom amount — kept for backward compat but axnAmount takes precedence
      const customAmount: number | null = (axnAmountInput === null && req.body.amount != null) ? parseFloat(req.body.amount) : null;

      const Gems_PER_USD = 100_000; // 100,000 Gems = $1 USD

      console.log('📝 Withdrawal request received:', { userId, method, starPackage, withdrawalPackage, axnAmountInput });

      // Validate withdrawal method
      const validMethods = ['TON', 'USDT', 'STARS'];
      if (!method || !validMethods.includes(method)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid withdrawal method'
        });
      }

      // Check for pending withdrawals
      const pendingWithdrawals = await db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'pending')
        ))
        .limit(1);

      if (pendingWithdrawals.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create new request until current one is processed'
        });
      }

      // Check daily withdrawal limit
      const [dailyLimitSetting] = await db
        .select({ settingValue: adminSettings.settingValue })
        .from(adminSettings)
        .where(eq(adminSettings.settingKey, 'maxWithdrawalsPerDay'))
        .limit(1);
      const maxWithdrawalsPerDay = parseInt(dailyLimitSetting?.settingValue || '1');

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayWithdrawals = await db
        .select({ count: sql<number>`count(*)` })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          gte(withdrawals.createdAt, todayStart),
          sql`LOWER(CAST(${withdrawals.status} AS TEXT)) != 'rejected'`
        ));
      const todayCount = Number(todayWithdrawals[0]?.count ?? 0);
      if (todayCount >= maxWithdrawalsPerDay) {
        return res.status(400).json({
          success: false,
          message: `Daily withdrawal limit reached. You can only withdraw ${maxWithdrawalsPerDay} time${maxWithdrawalsPerDay !== 1 ? 's' : ''} per day.`
        });
      }

      // Use transaction to ensure atomicity and prevent race conditions
      const newWithdrawal = await db.transaction(async (tx) => {
        // Lock user row and get balances, wallet addresses, and device info
        const [user] = await tx
          .select({
            balance: users.balance,
            usdBalance: users.usdBalance,
            cwalletId: users.cwalletId,
            usdtWalletAddress: users.usdtWalletAddress,
            telegramStarsUsername: users.telegramStarsUsername,
            friendsInvited: users.friendsInvited,
            telegram_id: users.telegram_id,
            username: users.username,
            firstName: users.firstName,
            banned: users.banned,
            bannedReason: users.bannedReason,
            deviceId: users.deviceId,
            adsWatched: users.adsWatched
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          throw new Error('User not found');
        }

        // FIX: the "does this user already have a pending withdrawal" check
        // above happens BEFORE this transaction/lock is acquired, so two
        // near-simultaneous requests could both pass it before either one had
        // inserted a row — letting a user end up with two pending withdrawal
        // requests at once, even though balance is only deducted at admin
        // approval time (not at request time). Re-checking here, after the
        // row lock, closes that window: concurrent requests are serialized
        // by the lock, so the second one will now correctly see the first
        // one's row and be rejected.
        const pendingWithdrawalsRecheck = await tx
          .select({ id: withdrawals.id })
          .from(withdrawals)
          .where(and(
            eq(withdrawals.userId, userId),
            eq(withdrawals.status, 'pending')
          ))
          .limit(1);
        if (pendingWithdrawalsRecheck.length > 0) {
          throw new Error('Cannot create new request until current one is processed');
        }

        // CRITICAL: Check if user is banned - prevent banned accounts from withdrawing
        if (user.banned) {
          throw new Error(`Account is banned: ${user.bannedReason || 'Multi-account violation'}`);
        }

        // CRITICAL: Check for duplicate accounts on same device trying to withdraw
        if (user.deviceId) {
          const duplicateAccounts = await tx
            .select({ id: users.id, banned: users.banned, isPrimaryAccount: users.isPrimaryAccount })
            .from(users)
            .where(and(
              eq(users.deviceId, user.deviceId),
              sql`${users.id} != ${userId}`
            ));

          if (duplicateAccounts.length > 0) {
            // Determine if current user is the primary account
            const [currentUserFull] = await tx
              .select({ isPrimaryAccount: users.isPrimaryAccount })
              .from(users)
              .where(eq(users.id, userId));

            const isPrimary = currentUserFull?.isPrimaryAccount === true;

            if (!isPrimary) {
              // Ban this duplicate account only
              const { banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              await banUserForMultipleAccounts(
                userId,
                'Duplicate account attempted withdrawal - only one account per device is allowed'
              );

              // Send warning to primary account
              const primaryAccount = duplicateAccounts.find(u => u.isPrimaryAccount === true) || duplicateAccounts[0];
              if (primaryAccount) {
                await sendWarningToMainAccount(primaryAccount.id);
              }

              throw new Error('Withdrawal blocked - multiple accounts detected on this device. This account has been banned.');
            }
          }
        }

        // ✅ Require at least 1 active (completed) referral before withdrawing (if enabled)
        const [inviteRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_invite_requirement_enabled'))
          .limit(1);
        const withdrawalInviteRequirementEnabled = (inviteRequirementEnabledSetting?.settingValue || 'true') === 'true';

        if (withdrawalInviteRequirementEnabled) {
          const activeReferralCount = await tx
            .select({ count: sql<number>`count(*)` })
            .from(referrals)
            .where(and(
              eq(referrals.referrerId, userId),
              eq(referrals.status, 'completed')
            ));
          if (Number(activeReferralCount[0]?.count ?? 0) < 1) {
            throw new Error('You need at least 1 active referral to withdraw. Invite a friend and have them watch 10 ads to activate your referral.');
          }
        }

        // ✅ Check if user has invited enough friends (based on admin settings)
        // (Settings already fetched above)

        const [minimumInvitesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_invites_for_withdrawal'))
          .limit(1);
        const minimumInvitesForWithdrawal = parseInt(minimumInvitesSetting?.settingValue || '3');

        // Only check invite requirement if it's enabled in admin settings
        if (withdrawalInviteRequirementEnabled) {
          const friendsInvited = user.friendsInvited || 0;
          if (friendsInvited < minimumInvitesForWithdrawal) {
            const remaining = minimumInvitesForWithdrawal - friendsInvited;
            throw new Error(`Invite ${remaining} more friend${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }

        // ✅ Check if user has watched enough ads (based on admin settings)
        const [adRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_ad_requirement_enabled'))
          .limit(1);
        const withdrawalAdRequirementEnabled = (adRequirementEnabledSetting?.settingValue || 'true') === 'true';

        const [minimumAdsSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_ads_for_withdrawal'))
          .limit(1);
        const minimumAdsForWithdrawal = parseInt(minimumAdsSetting?.settingValue || '100');

        // Only check ad requirement if it's enabled in admin settings
        if (withdrawalAdRequirementEnabled) {
          // Get ads watched since last withdrawal
          const lastApprovedWithdrawal = await tx
            .select({ createdAt: withdrawals.createdAt })
            .from(withdrawals)
            .where(and(
              eq(withdrawals.userId, String(userId)),
              sql`LOWER(CAST(${withdrawals.status} AS TEXT)) IN ('completed', 'approved')`
            ))
            .orderBy(desc(withdrawals.createdAt))
            .limit(1);

          let adsWatchedSinceLastWithdrawal = user.adsWatched || 0;

          if (lastApprovedWithdrawal.length > 0) {
            const lastWithdrawalDate = lastApprovedWithdrawal[0].createdAt || new Date(0);
            const adsCountResult = await tx
              .select({ count: sql<number>`count(*)` })
              .from(earnings)
              .where(and(
                eq(earnings.userId, String(userId)),
                eq(earnings.source, 'ad_watch'),
                gte(earnings.createdAt, lastWithdrawalDate)
              ));
            adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
          }

          if (adsWatchedSinceLastWithdrawal < minimumAdsForWithdrawal) {
            const remaining = minimumAdsForWithdrawal - adsWatchedSinceLastWithdrawal;
            throw new Error(`Watch ${remaining} more ad${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }

        // ✅ Check if user has completed enough tasks (based on admin settings)
        const [taskRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_task_requirement_enabled'))
          .limit(1);
        const withdrawalTaskRequirementEnabled = (taskRequirementEnabledSetting?.settingValue || 'true') === 'true';

        const [minimumTasksSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_tasks_for_withdrawal'))
          .limit(1);
        const minimumTasksForWithdrawal = parseInt(minimumTasksSetting?.settingValue || '10');

        // Only check task requirement if it's enabled in admin settings
        if (withdrawalTaskRequirementEnabled) {
          const tasksCompletedResult = await tx
            .select({ count: sql<number>`count(*)` })
            .from(taskClicks)
            .where(eq(taskClicks.publisherId, userId));
          const tasksCompleted = tasksCompletedResult[0]?.count || 0;

          if (tasksCompleted < minimumTasksForWithdrawal) {
            throw new Error(`You must complete at least ${minimumTasksForWithdrawal} tasks before making a withdrawal.`);
          }
        }

        // ✅ Get withdrawal packages from admin settings
        const [withdrawalPackagesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_packages'))
          .limit(1);
        const withdrawalPackagesConfig = JSON.parse(withdrawalPackagesSetting?.settingValue || '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]');

        let packageUsdAmount: number | null = null;
        // Gems metadata is populated before the shared payout calculation below.
        // Keep this object alive so the Gems branch never touches a TDZ variable.
        let withdrawalDetails: any = {};

        if (axnAmountInput !== null && !isNaN(axnAmountInput) && axnAmountInput > 0) {
          // ── Gems-direct withdrawal (new flow) ──────────────────────────────────
          const [minAmtSetting] = await tx
            .select({ settingValue: adminSettings.settingValue })
            .from(adminSettings)
            .where(eq(adminSettings.settingKey, 'minimumWithdrawAmount'))
            .limit(1);
          const minAmtUSD = parseFloat(minAmtSetting?.settingValue || '0.20');
          const minAmtGems = Math.round(minAmtUSD * Gems_PER_USD);

          const [maxAmtSetting] = await tx
            .select({ settingValue: adminSettings.settingValue })
            .from(adminSettings)
            .where(eq(adminSettings.settingKey, 'maximumWithdrawAmount'))
            .limit(1);
          const maxAmtUSD = parseFloat(maxAmtSetting?.settingValue || '0.50');
          const maxAmtGems = Math.round(maxAmtUSD * Gems_PER_USD);

          if (axnAmountInput < minAmtGems) {
            throw new Error(`Minimum withdrawal is ${minAmtGems.toLocaleString()} Gems ($${minAmtUSD.toFixed(2)})`);
          }
          if (axnAmountInput > maxAmtGems) {
            throw new Error(`Maximum withdrawal is ${maxAmtGems.toLocaleString()} Gems ($${maxAmtUSD.toFixed(2)})`);
          }

          // Validate against the user's Gold balance (user.balance)
          const rawAxnBalance = parseFloat(user.balance || '0');
          const currentAxnBalance = rawAxnBalance < 1 ? Math.round(rawAxnBalance * 10_000_000) : Math.round(rawAxnBalance);
          if (currentAxnBalance < axnAmountInput) {
            throw new Error(`Insufficient Gold balance. You have ${currentAxnBalance.toLocaleString()} Gold.`);
          }

          // Convert to USD for the withdrawal record (100,000 Gold = $1)
          const usdEquivalent = axnAmountInput / Gems_PER_USD;
          packageUsdAmount = usdEquivalent;

          // Store Gold withdrawal metadata for history display and approval deduction.
          withdrawalDetails.axnAmount = axnAmountInput;
          withdrawalDetails.axnPerUsd = Gems_PER_USD;
          console.log(`Gold withdrawal: ${axnAmountInput.toLocaleString()} Gold → $${usdEquivalent.toFixed(4)} USD`);
        } else if (customAmount !== null && !isNaN(customAmount) && customAmount > 0) {
          // Legacy USD custom amount — validate against admin min/max settings
          const [minAmtSetting] = await tx
            .select({ settingValue: adminSettings.settingValue })
            .from(adminSettings)
            .where(eq(adminSettings.settingKey, 'minimumWithdrawAmount'))
            .limit(1);
          const minAmt = parseFloat(minAmtSetting?.settingValue || '0.20');

          const [maxAmtSetting] = await tx
            .select({ settingValue: adminSettings.settingValue })
            .from(adminSettings)
            .where(eq(adminSettings.settingKey, 'maximumWithdrawAmount'))
            .limit(1);
          const maxAmt = parseFloat(maxAmtSetting?.settingValue || '0.50');

          if (customAmount < minAmt) {
            throw new Error(`Minimum withdrawal is $${minAmt.toFixed(2)}`);
          }
          if (customAmount > maxAmt) {
            throw new Error(`Maximum withdrawal is $${maxAmt.toFixed(2)}`);
          }
          const currentBalanceForCustom = parseFloat(user.usdBalance || '0');
          if (currentBalanceForCustom < customAmount) {
            throw new Error(`Insufficient balance. You need $${customAmount.toFixed(2)}.`);
          }
          packageUsdAmount = customAmount;
        } else if (withdrawalPackage && withdrawalPackage !== 'FULL') {
          const selectedPkg = withdrawalPackagesConfig.find((p: any) => p.usd === withdrawalPackage);
          if (!selectedPkg) {
            throw new Error('Invalid withdrawal package selected');
          }
          packageUsdAmount = selectedPkg.usd;
          const currentUsdBalanceForPkg = parseFloat(user.usdBalance || '0');
          if (packageUsdAmount !== null && currentUsdBalanceForPkg < packageUsdAmount) {
            throw new Error(`Insufficient balance. You need $${packageUsdAmount.toFixed(2)} for this package.`);
          }
        }

        // Check if user has appropriate wallet address based on method
        let walletAddress: string;
        if (method === 'TON') {
          if (!tonWalletAddress) {
            throw new Error('Please connect your TON wallet before withdrawing.');
          }
          walletAddress = tonWalletAddress;
        } else if (method === 'USD' || method === 'USDT') {
          if (!user.usdtWalletAddress) {
            throw new Error('USD address not set');
          }
          walletAddress = user.usdtWalletAddress;
        } else if (method === 'STARS') {
          if (!user.telegramStarsUsername) {
            throw new Error('Telegram username not set');
          }
          walletAddress = user.telegramStarsUsername;
        } else {
          throw new Error('Invalid withdrawal method');
        }

        const currentUsdBalance = parseFloat(user.usdBalance || '0');

        // Get minimum withdrawal and fee settings from admin settings
        const [minWithdrawalSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_withdrawal_usd'))
          .limit(1);
        const minimumWithdrawalUSD = parseFloat(minWithdrawalSetting?.settingValue || '1.00');

        const [minWithdrawalTONSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_withdrawal_ton'))
          .limit(1);
        const minimumWithdrawalTON = parseFloat(minWithdrawalTONSetting?.settingValue || '0.5');

        const [feePercentTONSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_fee_ton'))
          .limit(1);
        const feePercentTON = parseFloat(feePercentTONSetting?.settingValue || '5') / 100;

        const [feePercentUSDSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_fee_usd'))
          .limit(1);
        const feePercentUSD = parseFloat(feePercentUSDSetting?.settingValue || '3') / 100;

        // Calculate withdrawal amount and fee (ALL IN USD ONLY)
        let withdrawalAmount: number; // Always in USD
        let fee: number;
        let usdToDeduct: number;
        withdrawalDetails = {
          paymentDetails: walletAddress,
          walletAddress: walletAddress,
          method: method
        };
        if (axnAmountInput !== null && !isNaN(axnAmountInput) && axnAmountInput > 0) {
          withdrawalDetails.axnAmount = axnAmountInput;
          withdrawalDetails.axnPerUsd = Gems_PER_USD;
        }

        if (method === 'STARS') {
          if (!starPackage) {
            throw new Error('Star package selection is required for Telegram Stars withdrawal');
          }

          const starPackages = [
            { stars: 15, usdCost: 0.30 },
            { stars: 25, usdCost: 0.50 },
            { stars: 50, usdCost: 1.00 },
            { stars: 100, usdCost: 2.00 }
          ];

          const selectedPkg = starPackages.find(p => p.stars === starPackage);
          if (!selectedPkg) {
            throw new Error('Invalid star package selected');
          }

          const totalCost = selectedPkg.usdCost * 1.05;
          if (currentUsdBalance < totalCost) {
            throw new Error(`Insufficient balance. You need $${totalCost.toFixed(2)} (including 5% fee)`);
          }

          withdrawalAmount = selectedPkg.usdCost; // USD amount
          fee = selectedPkg.usdCost * 0.05;
          usdToDeduct = totalCost;
          withdrawalDetails.starPackage = starPackage;
          withdrawalDetails.stars = starPackage;
          withdrawalDetails.telegramUsername = walletAddress;
        } else {
          // TON or USD withdrawal - package-based or FULL balance
          const isAxnWithdrawal = axnAmountInput !== null && !isNaN(axnAmountInput) && axnAmountInput > 0;
          if (!isAxnWithdrawal && currentUsdBalance <= 0) {
            throw new Error('Insufficient balance for withdrawal');
          }

          // Determine the USD amount to withdraw based on package selection
          let baseAmount: number;
          if (isAxnWithdrawal) {
            // Gems is the source balance; packageUsdAmount is its USD equivalent.
            // Do not require or read legacy usdBalance for this path.
            baseAmount = packageUsdAmount!;
          } else if (packageUsdAmount !== null) {
            // Package-based withdrawal: use exact package amount
            baseAmount = packageUsdAmount;
          } else {
            // FULL withdrawal: use full balance
            baseAmount = currentUsdBalance;

            // Check minimum withdrawal requirement only for FULL withdrawals
            const requiredMinimum = method === 'TON' ? minimumWithdrawalTON : minimumWithdrawalUSD;
            if (baseAmount < requiredMinimum) {
              throw new Error(`Minimum ${requiredMinimum.toFixed(2)}`);
            }
          }

          // Use admin-configured fees: TON and USD have different fees
          const feePercent = method === 'TON' ? feePercentTON : feePercentUSD;
          fee = baseAmount * feePercent;
          withdrawalAmount = baseAmount - fee; // USD amount after fee
          usdToDeduct = baseAmount;

          // Store package info if applicable
          if (packageUsdAmount !== null) {
            withdrawalDetails.withdrawalPackage = packageUsdAmount;
          }
          withdrawalDetails.starDeducted = 0;

          // Store wallet address based on method
          if (method === 'TON') {
            withdrawalDetails.tonWalletAddress = walletAddress;
          } else if (method === 'USD' || method === 'USDT') {
            withdrawalDetails.usdtWalletAddress = walletAddress;
          }
        }

        console.log(`📝 Creating withdrawal request for $${withdrawalAmount.toFixed(2)} USD via ${method} (balance will be deducted on approval)`);

        // Store the fee percentage from admin settings for consistent display
        const feePercentForDetails = method === 'TON' ? feePercentTON : (method === 'STARS' ? 0.05 : feePercentUSD);
        withdrawalDetails.totalDeducted = usdToDeduct.toFixed(10);
        withdrawalDetails.fee = fee.toFixed(10);
        withdrawalDetails.feePercent = (feePercentForDetails * 100).toString(); // Store exact percentage (e.g., "5" or "2.5")
        withdrawalDetails.requestedAmount = usdToDeduct.toFixed(10); // Total amount before fee
        withdrawalDetails.netAmount = withdrawalAmount.toFixed(10); // Amount after fee

        const withdrawalData: any = {
          userId,
          amount: withdrawalAmount.toFixed(10),
          method: method,
          status: 'pending',
          deducted: false,
          refunded: false,
          details: withdrawalDetails
        };

        const [withdrawal] = await tx.insert(withdrawals).values(withdrawalData).returning();

        // NOTE: Balance is NOT deducted here - it will be deducted ONLY when admin approves the withdrawal
        // This prevents "insufficient balance" errors during approval when balance was already deducted at request time
        console.log(`📋 Withdrawal request created for $${usdToDeduct.toFixed(2)} USD (balance will be deducted on admin approval)`);

        return {
          withdrawal,
          withdrawnAmount: withdrawalAmount, // USD amount
          fee: fee,
          feePercent: (feePercentForDetails * 100).toString(), // Fee percentage as string (exact value)
          method: method,
          starPackage: method === 'STARS' ? starPackage : undefined,
          userTelegramId: user.telegram_id,
          username: user.username,
          firstName: user.firstName || user.username || 'Unknown',
          walletAddress: walletAddress
        };
      });

      console.log(`✅ Withdrawal request created: ${newWithdrawal.withdrawal.id} for user ${userId}, amount: $${newWithdrawal.withdrawnAmount.toFixed(2)} via ${newWithdrawal.method}`);

      // Send withdrawal_requested notification via WebSocket
      sendRealtimeUpdate(userId, {
        type: 'withdrawal_requested',
        amount: newWithdrawal.withdrawnAmount.toFixed(2),
        method: newWithdrawal.method,
        message: 'You have sent a withdrawal request.'
      });

      // Send the request only to the configured admin withdrawal group.
      const userName = newWithdrawal.firstName;
      const userTelegramId = newWithdrawal.userTelegramId || '';
      const userTelegramUsername = newWithdrawal.username ? `@${newWithdrawal.username}` : 'N/A';
      const walletAddress = newWithdrawal.walletAddress || 'N/A';
      const feeAmount = newWithdrawal.fee;
      const feePercent = newWithdrawal.feePercent;
      const { sendWithdrawalRequestToAdmins } = await import('./telegram');
      const { getLiveTonPriceUSD } = await import('./tonPriceService');
      const { price: currentTonPrice, source: currentTonPriceSource } = await getLiveTonPriceUSD();
      if (currentTonPriceSource.includes('(stale)')) {
        console.warn(`⚠️ Withdrawal ${newWithdrawal.withdrawal.id} notification uses stale TON price source: ${currentTonPriceSource}`);
      }

      const axnAmtForGroup = (newWithdrawal.withdrawal.details as any)?.axnAmount
        ? parseFloat((newWithdrawal.withdrawal.details as any).axnAmount)
        : undefined;
      await sendWithdrawalRequestToAdmins({
        withdrawalId: newWithdrawal.withdrawal.id,
        userTelegramId,
        userName,
        userTelegramUsername,
        walletAddress,
        amount: newWithdrawal.withdrawnAmount,
        fee: feeAmount,
        feePercent,
        axnAmount: axnAmtForGroup,
        tonPrice: currentTonPrice,
        tonAmount: Number((newWithdrawal.withdrawal as any).cryptoAmount || (newWithdrawal.withdrawal.details as any)?.tonAmount || (newWithdrawal.withdrawnAmount / currentTonPrice)),
        usdAmount: newWithdrawal.withdrawnAmount,
      }).catch(err => console.error('❌ Private admin withdrawal request delivery failed:', err));


      res.json({
        success: true,
        message: 'You have sent a withdrawal request',
        withdrawal: {
          id: newWithdrawal.withdrawal.id,
          amount: newWithdrawal.withdrawal.amount,
          status: newWithdrawal.withdrawal.status,
          method: newWithdrawal.withdrawal.method,
          createdAt: newWithdrawal.withdrawal.createdAt
        }
      });

    } catch (error) {
      console.error('❌ Error creating withdrawal request:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      const errorMessage = error instanceof Error ? error.message : 'Failed to create withdrawal request';

      // Return 400 for validation errors (user-facing errors), 500 for system errors
      // Use substring matching to catch all variations of user-facing errors
      const isValidationError =
        errorMessage.includes('Insufficient') ||
        errorMessage.includes('balance') ||
        errorMessage.includes('Minimum withdrawal') ||
        errorMessage.includes('User not found') ||
        errorMessage.includes('wallet address') ||
        errorMessage.includes('invite') ||
        errorMessage.includes('friends') ||
        errorMessage.includes('already in use') ||
        errorMessage.includes('Cannot create new request') ||
        errorMessage.includes('Star package') ||
        errorMessage.includes('Invalid') ||
        errorMessage.includes('banned') ||
        errorMessage.includes('complete at least') ||
        errorMessage.includes('more ad');

      if (isValidationError) {
        return res.status(400).json({
          success: false,
          message: errorMessage
        });
      }

      res.status(500).json({
        success: false,
        message: errorMessage
      });
    }
  });

  // Alternative withdrawal endpoint for compatibility - /api/withdraw
  // TON balance is ONLY for task creation (advertising). Withdrawal is blocked.
  app.post('/api/withdraw', async (req: any, res) => {
    return res.status(403).json({
      success: false,
      message: 'TON balance can only be used to create advertising tasks. Withdrawal is not available.'
    });

  });

  // Alternative withdrawal history endpoint - /api/withdraw/history
  app.get('/api/withdraw/history', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;

      if (!userId) {
        return res.json({ success: true, skipAuth: true, history: [] });
      }

      const history = await db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));

      res.json({
        success: true,
        history
      });

    } catch (error) {
      console.error('❌ Error fetching withdrawal history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch history' });
    }
  });

  // Admin withdrawal management endpoints

  // All withdrawals for a specific user (admin user profile)
  app.get('/api/admin/user-withdrawals/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userWithdrawals = await db
        .select({
          id: withdrawals.id,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          deducted: withdrawals.deducted,
          refunded: withdrawals.refunded,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, id))
        .orderBy(desc(withdrawals.createdAt));

      const completedStatuses = ['completed', 'success', 'paid', 'Approved', 'Successfull'];
      const completedCount = userWithdrawals.filter((w: any) => completedStatuses.includes(w.status)).length;
      const totalPaid = userWithdrawals
        .filter((w: any) => completedStatuses.includes(w.status))
        .reduce((sum: number, w: any) => sum + parseFloat(w.amount || '0'), 0);

      res.json({
        success: true,
        withdrawals: userWithdrawals,
        summary: {
          total: userWithdrawals.length,
          completed: completedCount,
          pending: userWithdrawals.filter((w: any) => w.status === 'pending').length,
          rejected: userWithdrawals.filter((w: any) => w.status?.toLowerCase() === 'rejected').length,
          totalPaid: totalPaid.toFixed(4),
        },
      });
    } catch (error) {
      console.error('❌ Error fetching user withdrawals:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch user withdrawals' });
    }
  });

  // Get pending withdrawals (admin only)
  app.get('/api/admin/withdrawals/pending', authenticateAdmin, async (req: any, res) => {
    try {

      // Get pending withdrawals only
      const pendingWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(eq(withdrawals.status, 'pending'))
        .orderBy(desc(withdrawals.createdAt));

      res.json({
        success: true,
        withdrawals: pendingWithdrawals,
        total: pendingWithdrawals.length
      });

    } catch (error) {
      console.error('❌ Error fetching pending withdrawals:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pending withdrawals'
      });
    }
  });

  // Get processed withdrawals (approved/rejected) - admin only
  app.get('/api/admin/withdrawals/processed', authenticateAdmin, async (req: any, res) => {
    try {

      // Get all processed withdrawals (approved and rejected)
      const processedWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(sql`${withdrawals.status} IN ('paid', 'success', 'rejected', 'Successfull', 'Approved')`)
        .orderBy(desc(withdrawals.updatedAt));

      res.json({
        success: true,
        withdrawals: processedWithdrawals,
        total: processedWithdrawals.length
      });

    } catch (error) {
      console.error('❌ Error fetching processed withdrawals:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch processed withdrawals'
      });
    }
  });

  // Approve withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes, transactionHash } = req.body;

      if (!transactionHash || !String(transactionHash).trim()) {
        return res.status(400).json({ success: false, message: 'TON transaction hash is required before approval' });
      }

      const result = await storage.approveWithdrawal(withdrawalId, adminNotes, String(transactionHash).trim());

      if (result.success) {
        console.log(`✅ Withdrawal ${withdrawalId} approved by admin ${req.user.telegramUser.id}`);

        // Approval posts the completed payment only to the admin withdrawal group.
        if (result.withdrawal) {
          const { sendWithdrawalApprovedNotification } = await import('./telegram');
          await sendWithdrawalApprovedNotification(result.withdrawal);
        }

        // Send real-time update to user
        if (result.withdrawal) {
          sendRealtimeUpdate(result.withdrawal.userId, {
            type: 'withdrawal_approved',
            amount: result.withdrawal.amount,
            method: result.withdrawal.method,
            message: `Your ${result.withdrawal.goldAmount || result.withdrawal.amount} GOLD TON withdrawal was approved; admin will pay manually`
          });

          // Also send a balance_update so the frontend refreshes balance AND stars correctly
          // This prevents the "stars disappeared after withdrawal" display bug
          try {
            const freshUser = await storage.getUser(result.withdrawal.userId);
            if (freshUser) {
              sendRealtimeUpdate(result.withdrawal.userId, {
                type: 'balance_update',
                balance: freshUser.balance,
                usdBalance: freshUser.usdBalance,
              });
            }
          } catch (_) {}

          // Broadcast to all admins for instant UI update
          broadcastUpdate({
            type: 'withdrawal_approved',
            withdrawalId: result.withdrawal.id,
            amount: result.withdrawal.amount,
            userId: result.withdrawal.userId
          });
        }

        res.json({
          success: true,
          message: '✅ Withdrawal approved and processed',
          withdrawal: result.withdrawal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }

    } catch (error) {
      console.error('❌ Error approving withdrawal:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve withdrawal'
      });
    }
  });

  // Reject withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes, reason } = req.body;

      // Reject the withdrawal using existing storage method
      const result = await storage.rejectWithdrawal(withdrawalId, adminNotes || reason);

      if (result.success) {
        console.log(`❌ Withdrawal ${withdrawalId} rejected by admin ${req.user.telegramUser.id}`);

        // Send Telegram notification to the withdrawal channel
        const { sendWithdrawalRejectedNotification } = await import('./telegram');
        await sendWithdrawalRejectedNotification(result.withdrawal, adminNotes || reason);

        // Send real-time update to user
        if (result.withdrawal) {
          sendRealtimeUpdate(result.withdrawal.userId, {
            type: 'withdrawal_rejected',
            amount: result.withdrawal.amount,
            method: result.withdrawal.method,
            message: `Your withdrawal of ${result.withdrawal.amount} TON has been rejected`
          });

          // Broadcast to all admins for instant UI update
          broadcastUpdate({
            type: 'withdrawal_rejected',
            withdrawalId: result.withdrawal.id,
            amount: result.withdrawal.amount,
            userId: result.withdrawal.userId
          });
        }

        res.json({
          success: true,
          message: '❌ Withdrawal rejected',
          withdrawal: result.withdrawal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }

    } catch (error) {
      console.error('❌ Error rejecting withdrawal:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reject withdrawal'
      });
    }
  });

  // Test withdrawal group notification (admin only)
  app.post('/api/admin/withdrawals/test-group-notification', authenticateAdmin, async (req: any, res) => {
    try {
      const { sendWithdrawalApprovedNotification } = await import('./telegram');
      const fakeWithdrawal = {
        id: 'test-000',
        userId: req.user.user.id,
        amount: '0.50',
        method: 'TON',
        details: {
          netAmount: '0.50',
          paymentDetails: 'TEST_WALLET_ADDRESS',
          walletAddress: 'TEST_WALLET_ADDRESS'
        }
      };
      const success = await sendWithdrawalApprovedNotification(fakeWithdrawal);
      if (success) {
        res.json({ success: true, message: '✅ Test message sent to withdrawal group successfully' });
      } else {
        res.status(500).json({ success: false, message: '❌ Failed to send test message — check server logs for the Telegram API error' });
      }
    } catch (error: any) {
      console.error('❌ Error sending test group notification:', error);
      res.status(500).json({ success: false, message: `Error: ${error.message}` });
    }
  });

  // Check if user has completed a task
  app.get('/api/tasks/:promotionId/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;

      const hasCompleted = await storage.hasUserCompletedTask(promotionId, userId);
      res.json({ completed: hasCompleted });
    } catch (error) {
      console.error("Error checking task status:", error);
      res.status(500).json({ message: "Failed to check task status" });
    }
  });

  // NEW TASK STATUS SYSTEM ENDPOINTS

  // Verify task (makes it claimable if requirements are met)
  app.post('/api/tasks/:promotionId/verify', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      const { taskType } = req.body;

      if (!taskType) {
        return res.status(400).json({
          success: false,
          message: 'Task type is required'
        });
      }

      console.log(`🔍 Task verification attempt: UserID=${userId}, TaskID=${promotionId}, TaskType=${taskType}`);

      const result = await storage.verifyTask(userId, promotionId, taskType);

      if (result.success) {
        console.log(`✅ Task verification result: ${result.message}, Status: ${result.status}`);
        res.json(result);
      } else {
        console.log(`❌ Task verification failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error verifying task:", error);
      res.status(500).json({ success: false, message: "Failed to verify task" });
    }
  });

  // Claim task reward (credits balance and marks as claimed)
  app.post('/api/tasks/:promotionId/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;

      console.log(`🎁 Task claim attempt: UserID=${userId}, TaskID=${promotionId}`);

      const result = await storage.claimPromotionReward(userId, promotionId);

      if (result.success) {
        console.log(`✅ Task claimed successfully: ${result.message}, Reward: ${result.rewardAmount}`);

        // Send real-time balance update via WebSocket
        try {
          const connection = connectedUsers.get(req.sessionID);
          if (connection && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({
              type: 'balance_update',
              balance: result.newBalance,
              rewardAmount: result.rewardAmount,
              source: 'task_claim'
            }));
          }
        } catch (wsError) {
          console.error('Failed to send WebSocket balance update:', wsError);
        }

        res.json(result);
      } else {
        console.log(`❌ Task claim failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ success: false, message: "Failed to claim task reward" });
    }
  });

  // Create promotion (via Telegram bot only - internal endpoint)
  app.post('/api/internal/promotions', authenticateTelegram, async (req: any, res) => {
    try {
      const promotionData = insertPromotionSchema.parse(req.body);
      const promotion = await storage.createPromotion(promotionData);
      res.json(promotion);
    } catch (error) {
      console.error("Error creating promotion:", error);
      res.status(500).json({ message: "Failed to create promotion" });
    }
  });

  // Get user balance
  app.get('/api/user/balance', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const balance = await storage.getUserBalance(userId);

      if (!balance) {
        // Create initial balance if doesn't exist
        const newBalance = await storage.createOrUpdateUserBalance(userId, '0');
        res.json(newBalance);
      } else {
        res.json(balance);
      }
    } catch (error) {
      console.error("Error fetching user balance:", error);
      res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Add funds to main balance (via bot only - internal endpoint)
  app.post('/api/internal/add-funds', authenticateTelegram, async (req: any, res) => {
    try {
      const { userId, amount } = req.body;

      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const balance = await storage.createOrUpdateUserBalance(userId, amount);
      res.json({ success: true, balance });
    } catch (error) {
      console.error("Error adding funds:", error);
      res.status(500).json({ message: "Failed to add funds" });
    }
  });

  // Deduct main balance for promotion creation (internal endpoint)
  app.post('/api/internal/deduct-balance', async (req: any, res) => {
    try {
      const { userId, amount } = req.body;

      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const result = await storage.deductBalance(userId, amount);
      res.json(result);
    } catch (error) {
      console.error("Error deducting balance:", error);
      res.status(500).json({ message: "Failed to deduct balance" });
    }
  });

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];

            // Get daily task completion records for today
      const dailyTaskRows = await db.select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.resetDate, currentDate)
        ));
      // Get current user data for ads progress
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      // Format task statuses
      const taskStatuses: any[] = dailyTaskRows.map(task => ({
        taskType: String(task.taskLevel),
        progress: task.progress,
        required: task.required,
        completed: task.completed,
        claimed: task.claimed,
        rewardAmount: parseFloat(task.rewardAmount).toFixed(7),
        status: task.claimed ? 'completed' : (task.completed ? 'claimable' : 'in_progress')
      }));
      // Add ads progress from user data
      const adsToday = user.adsWatchedToday || 0;
      taskStatuses.forEach((task: any) => {
        if (task.taskType.startsWith('ads_')) {
          task.progress = adsToday;
          task.completed = adsToday >= task.required;
          task.status = task.claimed ? 'completed' : (task.completed ? 'claimable' : 'in_progress');
        }
      });

      res.json({ tasks: taskStatuses, adsWatchedToday: adsToday });
    } catch (error) {
      console.error("Error fetching task status:", error);
      res.status(500).json({ message: "Failed to fetch task status" });
    }
  });



  // Increment ads counter
  app.post('/api/tasks/ads/increment', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];

      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const currentAds = (user.adsWatchedToday || 0) + 1;

      // Update user's ads watched count
      await db.update(users)
        .set({
          adsWatchedToday: currentAds,
          adsWatched: (user.adsWatched || 0) + 1,
          lastAdWatch: new Date()
        })
        .where(eq(users.id, userId));

      // Update all ads goal tasks progress
      const adsGoals = ['ads_mini', 'ads_light', 'ads_medium', 'ads_hard'];
      for (const goalType of adsGoals) {
        const taskData = await db.select()
          .from(dailyTasks)
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.taskLevel, Number(goalType) || 0),
            eq(dailyTasks.resetDate, currentDate)
          ))
          .limit(1);

        if (taskData.length > 0) {
          const task = taskData[0];
          const completed = currentAds >= task.required;

          await db.update(dailyTasks)
            .set({
              progress: currentAds,
              completed: completed
            })
            .where(and(
              eq(dailyTasks.userId, userId),
              eq(dailyTasks.taskLevel, Number(goalType) || 0),
              eq(dailyTasks.resetDate, currentDate)
            ));
        }
      }

      res.json({
        success: true,
        adsWatchedToday: currentAds,
        message: `Ads watched today: ${currentAds}`
      });
    } catch (error) {
      console.error("Error incrementing ads counter:", error);
      res.status(500).json({ message: "Failed to increment ads counter" });
    }
  });

  // Complete invite friend task
  app.post('/api/tasks/invite-friend/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];

      // Update user's friend invited flag
      await db.update(users)
        .set({ friendInvited: true })
        .where(eq(users.id, userId));

      // Update daily task completion
      await db.update(dailyTasks)
        .set({ completed: true, progress: 1 })
        .where(and(
          eq(dailyTasks.userId, userId),
            eq(dailyTasks.taskLevel, 0),
            eq(dailyTasks.resetDate, currentDate)
        ));

      res.json({ success: true, message: 'Friend invite completed' });
    } catch (error) {
      console.error("Error completing friend invite:", error);
      res.status(500).json({ message: "Failed to complete friend invite" });
    }
  });

  // Claim completed task reward
  app.post('/api/tasks/:taskType/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const taskType: number = Number(req.params.taskType) || 0;
      const currentDate = new Date().toISOString().split('T')[0];

      // Get task completion record
      const taskData = await db.select()
        .from(dailyTasks)
        .where(and(
          eq(dailyTasks.userId, userId),
          eq(dailyTasks.taskLevel, taskType),
          eq(dailyTasks.resetDate, currentDate)
        ))
        .limit(1);

      if (taskData.length === 0) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const task = taskData[0];

      if (task.claimed) {
        return res.status(400).json({ message: 'Task already claimed' });
      }

      if (!task.completed) {
        return res.status(400).json({ message: 'Task not completed yet' });
      }

      // Claim the reward in a transaction
      await db.transaction(async (tx) => {
        // Mark task as claimed
        await tx.update(dailyTasks)
          .set({ claimed: true })
          .where(and(
            eq(dailyTasks.userId, userId),
            eq(dailyTasks.taskLevel, taskType),
            eq(dailyTasks.resetDate, currentDate)
          ));

        // Add earning record through the canonical pipeline. It updates Gold

        await storage.addEarning({
          userId,
          amount: task.rewardAmount,
          source: 'daily_task_completion',
          description: `Daily task completed: ${taskType}`,
        });
      });

      // Get updated balance
      const user = await storage.getUser(userId);

      res.json({
        success: true,
        message: 'Task reward claimed successfully',
        rewardAmount: parseFloat(task.rewardAmount).toFixed(7),
        newBalance: user?.balance || '0'
      });
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ message: "Failed to claim task reward" });
    }
  });

  // Promo code endpoints
  // Redeem promo code
  app.post('/api/promo-codes/redeem', authenticateTelegram, async (req: any, res) => {
    // Declared here (not inside try) so the catch block can safely check
    // whether a usage slot was already reserved before the failure, and
    // release it if so — see releasePromoCodeUsage() below.
    let promoCodeIdForRollback: string | undefined;
    let usageIdForRollback: string | undefined;
    try {
      const userId = req.user.user.id;

      // ── Require fresh per-action Turnstile token ────────────────────────────
      if (!await checkActionTurnstile(req, res, 'promo_redeem')) return;
      // ───────────────────────────────────────────────────────────────────────

      const { code } = req.body;

      if (!code || !code.trim()) {
        return res.status(400).json({ success: false, message: 'Please enter a promo code' });
      }

      const cleanCode = code.trim().toUpperCase();

      // STEP 0: Check if this code belongs to an ambassador who requires channel membership
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        const [promoRow] = await db.select({ id: promoCodes.id, code: promoCodes.code })
          .from(promoCodes).where(eq(promoCodes.code, cleanCode)).limit(1);
        if (promoRow) {
          // Find the ambassador who owns this code (via ambassador_earnings pattern — match prefix)
          const [ambRow] = await db.select({
            channelId: ambassadors.channelId,
            requireChannelJoin: ambassadors.requireChannelJoin,
            channelUsername: ambassadorApplications.channelUsername,
            channelTitle: ambassadorApplications.channelTitle,
          })
            .from(ambassadors)
            .leftJoin(ambassadorApplications, eq(ambassadors.applicationId, ambassadorApplications.id))
            .where(sql`${ambassadors.requireChannelJoin} = true AND ${ambassadors.channelId} IS NOT NULL AND ${cleanCode} LIKE UPPER(COALESCE(${ambassadors.promoPrefix}, ${ambassadors.promoCodeName})) || '%'`)
            .limit(1);

          if (ambRow?.requireChannelJoin && ambRow.channelId) {
            const [userRow] = await db.select({ telegram_id: users.telegram_id }).from(users).where(eq(users.id, userId)).limit(1);
            const telegramId = userRow?.telegram_id ? parseInt(userRow.telegram_id) : null;
            if (telegramId) {
              const { verifyChannelMembership } = await import('./telegram');
              const isMember = await verifyChannelMembership(telegramId, ambRow.channelId, botToken);
              if (!isMember) {
                const channelLink = ambRow.channelUsername ? `https://t.me/${ambRow.channelUsername}` : null;
                return res.status(403).json({
                  success: false,
                  message: `You must join the ambassador's Telegram channel before claiming this promo code.`,
                  errorType: 'channel_required',
                  channelLink,
                  channelName: ambRow.channelTitle || ambRow.channelUsername || 'Channel',
                });
              }
            }
          }
        }
      }

      // STEP 1: Validate only — does NOT record usage yet
      const result = await storage.usePromoCode(cleanCode, userId);
      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }

      // Pull validated values from result (no second DB fetch needed)
      const rewardAmount  = result.reward || '0';
      const promoCodeId   = result.promoCodeId!;
      const usageId       = result.usageId!;
      promoCodeIdForRollback = promoCodeId;
      usageIdForRollback = usageId;
      let   rewardType    = (result.rewardType || 'Gems').toUpperCase();
      // Normalize aliases
      if (rewardType === 'PDZ')  rewardType = 'TON';
      if (rewardType === 'Gems')  rewardType = 'Gems';

      // STEP 2: Give the reward. Usage was already reserved atomically inside
      // usePromoCode() above — if giving the reward throws, the outer catch
      // block below releases that reservation so the user/code aren't
      // penalized for a failed attempt.
      if (rewardType === 'Gems') {
        const rewardPow = parseInt(rewardAmount);
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'promo_code',
          description: `Redeemed promo code: ${cleanCode}`,
        });

        // STEP 3: Only record usage after reward is successfully given
        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        // STEP 4: Ambassador commission
        await creditAmbassadorCommission(cleanCode, promoCodeId, userId);

        return res.json({
          success: true,
          message: `${rewardPow.toLocaleString()} Gems added to your balance!`,
          reward: rewardAmount,
          rewardType: 'Gems',
        });

      } else if (rewardType === 'TON') {
        // FIX: atomic increment (was read-then-write, which could lose an update
        // if the same user redeemed two different TON-reward codes concurrently)
        await db.update(users).set({
          tonBalance: sql`COALESCE(${users.tonBalance}, 0) + ${rewardAmount}`,
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
        await storage.logTransaction({ userId, amount: rewardAmount, type: 'credit', source: 'promo_code', description: `Redeemed promo code: ${cleanCode}`, metadata: { code: cleanCode, rewardType: 'TON' } });

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        await creditAmbassadorCommission(cleanCode, promoCodeId, userId);

        return res.json({
          success: true,
          message: `${rewardAmount} TON added to your balance!`,
          reward: rewardAmount,
          rewardType: 'TON',
        });

      } else {
        // Default fallback: Gems
        const rewardPow = parseInt(rewardAmount);
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'promo_code',
          description: `Redeemed promo code: ${cleanCode}`,
        });

        await storage.confirmPromoCodeUsage(promoCodeId, userId, rewardAmount);

        await creditAmbassadorCommission(cleanCode, promoCodeId, userId);

        return res.json({
          success: true,
          message: `${rewardPow.toLocaleString()} Gems added to your balance!`,
          reward: rewardAmount,
          rewardType: 'Gems',
        });
      }

    } catch (error) {
      console.error("Error redeeming promo code:", error);
      // If a usage slot was already reserved (validation succeeded) but crediting
      // the reward threw before we responded, release the reservation so the
      // user isn't permanently locked out and the code's usage count stays accurate.
      if (promoCodeIdForRollback && usageIdForRollback) {
        try {
          await storage.releasePromoCodeUsage(usageIdForRollback, promoCodeIdForRollback);
        } catch (rollbackError) {
          console.error("Error rolling back promo code usage reservation:", rollbackError);
        }
      }
      res.status(500).json({ success: false, message: "Failed to redeem promo code. Please try again." });
    }
  });

  // Helper: credit ambassador commission when their promo code is claimed
  async function creditAmbassadorCommission(code: string, promoCodeId: string, claimUserId: string) {
    try {
      // Check if ambassador program is enabled
      const [programSetting] = await db.select({ settingValue: adminSettings.settingValue })
        .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_program_enabled')).limit(1);
      if (programSetting?.settingValue === 'false') return;

      // Find ambassador whose promo prefix is the start of this code — pick longest match to avoid prefix-overlap ambiguity
      const allMatchingAmbs = await db.select().from(ambassadors)
        .where(sql`${code.toUpperCase()} LIKE UPPER(COALESCE(${ambassadors.promoPrefix}, ${ambassadors.promoCodeName})) || '%'`);
      const [ambassador] = allMatchingAmbs.sort((a, b) => {
        const lenA = (a.promoPrefix || a.promoCodeName || '').length;
        const lenB = (b.promoPrefix || b.promoCodeName || '').length;
        return lenB - lenA; // longest prefix first
      });
      if (!ambassador || ambassador.status !== 'active') return;

      // Get commission rate from admin settings
      const [commSetting] = await db.select({ settingValue: adminSettings.settingValue })
        .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_commission_usd')).limit(1);
      const commissionUsd = commSetting?.settingValue || '0.0001';

      // Insert ambassador earning (unique constraint prevents duplicates)
      await db.insert(ambassadorEarnings).values({
        ambassadorId: ambassador.id,
        promoCodeId,
        claimUserId,
        promoCode: code,
        commissionUsd,
      }).onConflictDoNothing();

      // Update ambassador stats
      const today = new Date().toISOString().split('T')[0];
      const lastReset = ambassador.lastClaimResetDate;
      const isNewDay = lastReset !== today;

      await db.update(ambassadors).set({
        totalClaims: sql`${ambassadors.totalClaims} + 1`,
        todayClaims: isNewDay ? 1 : sql`${ambassadors.todayClaims} + 1`,
        weekClaims: sql`${ambassadors.weekClaims} + 1`,
        monthClaims: sql`${ambassadors.monthClaims} + 1`,
        totalEarningsUsd: sql`${ambassadors.totalEarningsUsd} + ${commissionUsd}`,
        lastClaimResetDate: today,
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, ambassador.id));

      // Credit USD to ambassador's account
      await storage.addUSDBalance(ambassador.userId, commissionUsd, 'ambassador_commission',
        `Ambassador commission: ${code} claimed`);

      // Notify ambassador via Telegram
      try {
        const ambUser = await storage.getUser(ambassador.userId);
        if (ambUser?.telegram_id) {
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `🎉 Your promo code <b>${code}</b> was just claimed!\n` +
            `💰 You earned <b>$${parseFloat(commissionUsd).toFixed(4)}</b>\n` +
            `📊 Total claims: <b>${(ambassador.totalClaims || 0) + 1}</b>`,
            { parse_mode: 'HTML', chat_id: ambUser.telegram_id }
          );
        }
      } catch (_) {}

    } catch (err) {
      console.error('Ambassador commission error:', err);
    }
  }

  // Create promo code (admin only)
  app.post('/api/promo-codes/create', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);

      // Check if user is admin
      const userIsAdminFlag = isAdmin(user?.telegram_id || '') || (user?.telegram_id === process.env.DEV_ADMIN_ID && process.env.NODE_ENV === 'development');
      if (!userIsAdminFlag) {
        return res.status(403).json({ message: 'Unauthorized: Admin access required' });
      }

      const { code, rewardAmount, rewardType, usageLimit, perUserLimit, expiresAt } = req.body;

      if (!rewardAmount) {
        return res.status(400).json({ message: 'Reward amount is required' });
      }

      // Auto-generate code if not provided or if "GENERATE" is passed
      let finalCode = code?.trim();
      if (!finalCode || finalCode === 'GENERATE') {
        // Generate random 8-character code
        finalCode = 'PROMO' + Math.random().toString(36).substring(2, 10).toUpperCase();
        console.log('🎲 Auto-generated promo code:', finalCode);
      }

      // Validate reward type - Gems, TON supported (USD/BUG/STAR are removed)
      let finalRewardType = rewardType || 'GEMS';
      // Normalize aliases
      if (finalRewardType === 'PDZ') finalRewardType = 'TON';
      if (finalRewardType === 'Gems' || finalRewardType === 'SWAG') finalRewardType = 'GEMS';
      if (finalRewardType !== 'GEMS' && finalRewardType !== 'TON') {
        return res.status(400).json({ message: 'Reward type must be Gems or TON' });
      }

      const promoCode = await storage.createPromoCode({
        code: finalCode.toUpperCase(),
        rewardAmount: rewardAmount.toString(),
        rewardType: finalRewardType,
        rewardCurrency: finalRewardType,
        usageLimit: usageLimit || null,
        perUserLimit: perUserLimit || 1,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      });

      res.json({
        success: true,
        message: `Promo code created successfully (${finalRewardType})`,
        promoCode
      });
    } catch (error) {
      console.error("Error creating promo code:", error);
      res.status(500).json({ message: "Failed to create promo code" });
    }
  });

  // Get all promo codes (admin only)
  app.get('/api/admin/promo-codes', authenticateAdmin, async (req: any, res) => {
    try {
      const promoCodes = await storage.getAllPromoCodes();

      // Calculate stats for each promo code
      const promoCodesWithStats = promoCodes.map(promo => {
        const usageCount = promo.usageCount || 0;
        const usageLimit = promo.usageLimit || 0;
        const remainingCount = usageLimit > 0 ? Math.max(0, usageLimit - usageCount) : Infinity;
        const totalDistributed = parseFloat(promo.rewardAmount) * usageCount;
        const rewardType = promo.rewardType || 'Gems';

        return {
          ...promo,
          rewardType,
          usageCount,
          remainingCount: remainingCount === Infinity ? 'Unlimited' : remainingCount,
          totalDistributed: totalDistributed.toFixed(8)
        };
      });

      res.json({
        success: true,
        promoCodes: promoCodesWithStats
      });
    } catch (error) {
      console.error("Error fetching promo codes:", error);
      res.status(500).json({ message: "Failed to fetch promo codes" });
    }
  });

  // ArcPay Integration Routes
  const { createArcPayCheckout, verifyArcPayWebhookSignature, parseArcPayWebhook } = await import('./arcpay');

  // Create ArcPay payment checkout
  app.post('/api/arcpay/create-payment', authenticateTelegram, async (req: any, res) => {
    try {
      // Get user ID from the authenticated user object
      // authenticateTelegram sets req.user as { telegramUser: {...}, user: {...} }
      const userId = req.user?.user?.id;
      const userEmail = req.user?.user?.email;

      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = req.body.tonAmount ?? req.body.pdzAmount;

      if (!userId) {
        console.error('❌ ArcPay: No user ID found in authenticated request:', {
          hasUser: !!req.user,
          userKeys: req.user ? Object.keys(req.user) : null,
          hasUserObject: !!req.user?.user
        });
        return res.status(401).json({ error: 'Unauthorized - user not found' });
      }

      // Validate amount - differentiate between empty/invalid vs too small
      console.log(`💳 Payment request - amount: ${tonAmount}, type: ${typeof tonAmount}`);

      // Check if amount is missing or not a number
      if (tonAmount === undefined || tonAmount === null || typeof tonAmount !== 'number') {
        console.error(`❌ Invalid amount type: ${typeof tonAmount}, value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is 0 or negative
      if (isNaN(tonAmount) || tonAmount <= 0) {
        console.error(`❌ Invalid amount value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is below minimum
      if (tonAmount < 0.1) {
        console.error(`❌ Amount below minimum: ${tonAmount} < 0.1`);
        return res.status(400).json({ error: 'Minimum top-up is 0.1 TON' });
      }

      console.log(`✅ Amount validated: ${tonAmount} TON - creating ArcPay payment for user ${userId}`);

      // Create checkout
      const result = await createArcPayCheckout(tonAmount, userId, userEmail);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        paymentUrl: result.paymentUrl,
      });
    } catch (error: any) {
      console.error('❌ Error creating ArcPay payment:', error);
      res.status(500).json({ error: 'Failed to create payment request' });
    }
  });

  // ArcPay Webhook Handler
  app.post('/arcpay/webhook', async (req: any, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers['x-arcpay-signature'] || '';

      console.log('🔔 ArcPay webhook received:', {
        eventType: req.body.event,
        orderId: req.body.order_id,
      });

      // Verify webhook signature (disable for testing, enable in production)
      // const isValid = verifyArcPayWebhookSignature(rawBody, signature);
      // if (!isValid) {
      //   console.error('❌ Invalid webhook signature');
      //   return res.status(401).json({ error: 'Invalid signature' });
      // }

      // Parse webhook payload
      const webhook = parseArcPayWebhook(rawBody);
      if (!webhook) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      const { event, order_id, status, amount, metadata } = webhook;
      const userId = metadata?.userId;
      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = metadata?.tonAmount || metadata?.pdzAmount || amount;

      if (!userId) {
        console.error('❌ No userId in webhook metadata');
        return res.status(400).json({ error: 'Missing user information' });
      }

      // Handle payment success
      if (event === 'payment.success' && status === 'completed') {
        console.log(`✅ Payment successful for user ${userId}, crediting ${tonAmount} TON`);

        try {
          // Get user
          const user = await storage.getUser(userId);
          if (!user) {
            console.error(`❌ User not found: ${userId}`);
            return res.status(404).json({ error: 'User not found' });
          }

          // Credit TON to user
          const currentTon = parseFloat(user.tonBalance?.toString() || '0');
          const newTon = currentTon + tonAmount;

          // Update user's TON balance
          await db.update(users).set({
            tonBalance: newTon.toString(),
            updatedAt: new Date(),
          }).where(eq(users.id, userId));

          // Record transaction
          await db.insert(transactions).values({
            userId,
            amount: tonAmount.toString(),
            type: 'addition',
            source: 'arcpay_ton_topup',
            description: `Top-up ${tonAmount} TON via ArcPay (Order: ${order_id})`,
            metadata: {
              orderId: order_id,
              arcpayAmount: amount,
              arcpayCurrency: webhook.currency,
              transactionHash: webhook.transaction_hash,
            },
          });

          console.log(`💚 TON balance updated for user ${userId}: +${tonAmount} (Total: ${newTon})`);

          // CRITICAL: Send real-time update via WebSocket to the user's frontend
          sendRealtimeUpdate(userId, {
            type: 'balance_update',
            tonBalance: newTon.toString(),
            message: `🎉 Top-up successful! +${tonAmount} TON credited.`
          });

          // Send notification to user via Telegram
          try {
            const message = `🎉 Top-up successful!\n\n✅ You received ${tonAmount} TON\n💎 New balance: ${newTon} TON`;
            await sendUserTelegramNotification(userId, message);
          } catch (notifError) {
            console.warn('⚠️ Failed to send Telegram notification:', notifError);
          }

          return res.json({
            success: true,
            message: 'TON credited successfully',
            newBalance: newTon,
          });
        } catch (dbError) {
          console.error('❌ Error crediting TON:', dbError);
          return res.status(500).json({ error: 'Failed to credit TON' });
        }
      }

      // Handle payment failure
      if (event === 'payment.failed' && status === 'failed') {
        console.log(`❌ Payment failed for user ${userId}`);

        try {
          await sendUserTelegramNotification(
            userId,
            `❌ Payment failed for order ${order_id}. Please try again.`
          );
        } catch (notifError) {
          console.warn('⚠️ Failed to send Telegram notification:', notifError);
        }

        return res.json({
          success: true,
          message: 'Payment failure recorded',
        });
      }

      // Handle pending payments
      if (event === 'payment.pending' && status === 'pending') {
        console.log(`⏳ Payment pending for user ${userId}, order ${order_id}`);
        return res.json({
          success: true,
          message: 'Payment pending',
        });
      }

      return res.json({
        success: true,
        message: 'Webhook processed',
      });
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // ==================== FREE SPIN SYSTEM (DISABLED) ====================
  // Middleware to block all spin-related API endpoints
  app.use('/api/spin', (req, res, next) => {
    res.status(403).json({
      success: false,
      message: 'Spin feature has been disabled'
    });
  });

  // Helper function to get the next reset time (6:30 AM/PM UTC)
  const getNextResetTimeLocal = () => {
    return getNextResetTime();
  };

  // Spin reward configuration - heavily biased toward low rewards (DISABLED)
  const SPIN_REWARDS = [
    { type: 'Gems', amount: 1, rarity: 'common', weight: 400 },      // VERY HIGH CHANCE
    { type: 'Gems', amount: 20, rarity: 'common', weight: 350 },     // VERY HIGH CHANCE
    { type: 'Gems', amount: 200, rarity: 'rare', weight: 15 },       // VERY LOW CHANCE
    { type: 'Gems', amount: 800, rarity: 'rare', weight: 8 },        // VERY LOW CHANCE
    { type: 'Gems', amount: 1000, rarity: 'rare', weight: 3 },       // EXTREMELY LOW CHANCE
    { type: 'Gems', amount: 10000, rarity: 'ultra_rare', weight: 1 }, // EXTREMELY LOW CHANCE
    { type: 'TON', amount: 0.01, rarity: 'rare', weight: 5 },       // VERY LOW CHANCE
    { type: 'TON', amount: 0.10, rarity: 'ultra_rare', weight: 1 }, // EXTREMELY LOW CHANCE
  ];

  // Weighted random selection
  const selectSpinReward = () => {
    const totalWeight = SPIN_REWARDS.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;

    for (const reward of SPIN_REWARDS) {
      random -= reward.weight;
      if (random <= 0) {
        return reward;
      }
    }
    return SPIN_REWARDS[0]; // Fallback to lowest reward
  };

  // GET /api/spin/status - Returns spin availability and counters
  app.get('/api/spin/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data for user
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check if we need to reset for new day
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        // Reset daily values
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));

        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        // Create new spin data
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        });
        spinDataResult = {
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        };
      }

      // Calculate total available spins
      const freeSpinAvailable = !spinDataResult.freeSpinUsed;
      const extraSpins = spinDataResult.extraSpins || 0;
      const totalSpins = (freeSpinAvailable ? 1 : 0) + extraSpins;

      res.json({
        success: true,
        freeSpinAvailable,
        extraSpins,
        totalSpins,
        spinAdsWatched: spinDataResult.spinAdsWatched || 0,
        maxDailyAds: 50,
        adsPerSpin: 10,
        inviteSpinsEarned: spinDataResult.inviteSpinsEarned || 0,
      });
    } catch (error) {
      console.error('❌ Error getting spin status:', error);
      res.status(500).json({ error: 'Failed to get spin status' });
    }
  });

  // POST /api/spin/use - Spin the wheel
  app.post('/api/spin/use', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check daily reset
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));

        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        return res.status(400).json({ error: 'No spin data found' });
      }

      const freeSpinAvailable = !spinDataResult.freeSpinUsed;
      const extraSpins = spinDataResult.extraSpins || 0;

      // Check if user has any spins available
      if (!freeSpinAvailable && extraSpins <= 0) {
        return res.status(400).json({ error: 'No spins available' });
      }

      // Select reward
      const reward = selectSpinReward();
      let spinType = 'free';

      // Deduct spin
      if (freeSpinAvailable) {
        await db.update(spinData).set({
          freeSpinUsed: true,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        spinType = 'free';
      } else {
        await db.update(spinData).set({
          extraSpins: extraSpins - 1,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
        spinType = 'extra';
      }

      // Credit reward to user
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (reward.type === 'Gems') {
        // Atomic increment — never read-then-write to avoid clobbering concurrent updates
        await db.update(users).set({
          balance: sql`COALESCE(${users.balance}, 0) + ${reward.amount.toString()}`,
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
        await db.update(userBalances).set({
          balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.amount.toString()}`,
          updatedAt: new Date(),
        }).where(eq(userBalances.userId, userId));
      } else if (reward.type === 'TON') {
        // Atomic increment for TON balance
        await db.update(users).set({
          tonBalance: sql`COALESCE(${users.tonBalance}, 0) + ${reward.amount.toString()}`,
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      // Record spin history
      await db.insert(spinHistory).values({
        userId,
        rewardType: reward.type,
        rewardAmount: reward.amount.toString(),
        spinType,
      });

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.amount.toString(),
        type: 'addition',
        source: 'spin_reward',
        description: `Free Spin Reward: ${reward.amount} ${reward.type}`,
        metadata: { spinType, rarity: reward.rarity },
      });

      res.json({
        success: true,
        reward: {
          type: reward.type,
          amount: reward.amount,
          rarity: reward.rarity,
        },
      });
    } catch (error) {
      console.error('❌ Error using spin:', error);
      res.status(500).json({ error: 'Failed to use spin' });
    }
  });

  // POST /api/spin/adwatch - Watch ad to earn spins
  app.post('/api/spin/adwatch', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      // Check daily reset
      if (spinDataResult && spinDataResult.lastSpinDate !== today) {
        await db.update(spinData).set({
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));

        spinDataResult = {
          ...spinDataResult,
          freeSpinUsed: false,
          spinAdsWatched: 0,
          lastSpinDate: today,
        };
      }

      if (!spinDataResult) {
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        });
        spinDataResult = {
          freeSpinUsed: false,
          extraSpins: 0,
          spinAdsWatched: 0,
          inviteSpinsEarned: 0,
          lastSpinDate: today,
        };
      }

      const currentAdsWatched = spinDataResult.spinAdsWatched || 0;
      const maxAds = 50;

      // Check if max ads reached
      if (currentAdsWatched >= maxAds) {
        return res.status(400).json({
          error: 'Maximum daily ads reached',
          adsWatched: currentAdsWatched,
          maxAds,
        });
      }

      // Increment ad counter
      const newAdsWatched = currentAdsWatched + 1;
      let newExtraSpins = spinDataResult.extraSpins || 0;
      let spinEarned = false;

      // Check if 10 ads reached - grant extra spin
      if (newAdsWatched % 10 === 0) {
        newExtraSpins += 1;
        spinEarned = true;
      }

      await db.update(spinData).set({
        spinAdsWatched: newAdsWatched,
        extraSpins: newExtraSpins,
        updatedAt: new Date(),
      }).where(eq(spinData.userId, userId));

      res.json({
        success: true,
        adsWatched: newAdsWatched,
        maxAds,
        spinEarned,
        extraSpins: newExtraSpins,
        adsUntilNextSpin: 10 - (newAdsWatched % 10),
      });
    } catch (error) {
      console.error('❌ Error recording spin ad watch:', error);
      res.status(500).json({ error: 'Failed to record ad watch' });
    }
  });

  // POST /api/spin/invite - Grant spin for verified invite (called when referral is verified)
  app.post('/api/spin/invite', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // Get or create spin data
      let spinDataResult = await db.query.spinData.findFirst({
        where: eq(spinData.userId, userId),
      }) as any;

      if (!spinDataResult) {
        await db.insert(spinData).values({
          userId,
          freeSpinUsed: false,
          extraSpins: 1, // Start with the bonus spin
          spinAdsWatched: 0,
          inviteSpinsEarned: 1,
          lastSpinDate: today,
        });
      } else {
        await db.update(spinData).set({
          extraSpins: (spinDataResult.extraSpins || 0) + 1,
          inviteSpinsEarned: (spinDataResult.inviteSpinsEarned || 0) + 1,
          updatedAt: new Date(),
        }).where(eq(spinData.userId, userId));
      }

      res.json({
        success: true,
        message: 'Spin earned from verified invite!',
      });
    } catch (error) {
      console.error('❌ Error granting invite spin:', error);
      res.status(500).json({ error: 'Failed to grant invite spin' });
    }
  });

  // ==================== DAILY MISSIONS ====================

  // GET /api/missions/status - Get daily mission completion status
  app.get('/api/missions/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getResetPeriodKey();

      // Get mission completion status
      const missions = await db.query.dailyMissions.findMany({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.resetDate, today)
        ),
      });

      const shareStoryMission = missions.find(m => m.missionType === 'share_story');
      const dailyCheckinMission = missions.find(m => m.missionType === 'daily_checkin');
      const checkForUpdatesMission = missions.find(m => m.missionType === 'check_for_updates');
      const shareReferralMission = missions.find(m => m.missionType === 'share_referral');
      const checkAnnouncementMission = missions.find(m => m.missionType === 'check_announcement');
      const adsgramCheckinMission = missions.find(m => m.missionType === 'adsgram_checkin');
      const ads10Mission = missions.find(m => m.missionType === 'ads_10');
      const ads30Mission = missions.find(m => m.missionType === 'ads_30');
      const ads50Mission = missions.find(m => m.missionType === 'ads_50');

      // first_active_referral is permanent (not daily) — check all-time
      const firstActiveReferralMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'first_active_referral')
        ),
      });

      // Fetch mission reward settings
      const settingsRows = await db.select().from(adminSettings);
      const getS = (key: string, def: string) => settingsRows.find((s: any) => s.settingKey === key)?.settingValue || def;

      res.json({
        success: true,
        shareStory: {
          completed: shareStoryMission?.completed || false,
          claimed: !!shareStoryMission?.claimedAt,
        },
        dailyCheckin: {
          completed: dailyCheckinMission?.completed || false,
          claimed: !!dailyCheckinMission?.claimedAt,
        },
        checkForUpdates: {
          completed: checkForUpdatesMission?.completed || false,
          claimed: !!checkForUpdatesMission?.claimedAt,
        },
        shareReferral: {
          completed: shareReferralMission?.completed || false,
          claimed: !!shareReferralMission?.claimedAt,
          reward: 10,
        },
        checkAnnouncement: {
          completed: checkAnnouncementMission?.completed || false,
          claimed: !!checkAnnouncementMission?.claimedAt,
          reward: parseInt(getS('check_announcement_reward', '1000')),
        },
        adsgramCheckin: {
          completed: adsgramCheckinMission?.completed || false,
          claimed: !!adsgramCheckinMission?.claimedAt,
          reward: parseInt(getS('adsgram_checkin_reward', '1000')),
        },
        ads10: {
          completed: ads10Mission?.completed || false,
          claimed: !!ads10Mission?.claimedAt,
          reward: 100,
        },
        ads30: {
          completed: ads30Mission?.completed || false,
          claimed: !!ads30Mission?.claimedAt,
          reward: 100,
        },
        ads50: {
          completed: ads50Mission?.completed || false,
          claimed: !!ads50Mission?.claimedAt,
          reward: 100,
        },
        firstActiveReferral: {
          completed: firstActiveReferralMission?.completed || false,
          claimed: !!firstActiveReferralMission?.claimedAt,
          reward: parseInt(getS('first_active_referral_reward', '2500')),
        },
      });
    } catch (error) {
      console.error('❌ Error getting mission status:', error);
      res.status(500).json({ error: 'Failed to get mission status' });
    }
  });

  // POST /api/missions/share-story/claim - Claim share story reward
  app.post('/api/missions/share-story/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getResetPeriodKey();
      const reward = 100; // 100 Gold

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'share_story'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'share_story',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward to user balance — atomic increment prevents clobbering concurrent updates
      await db.update(users).set({
        balance: sql`COALESCE(${users.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await db.update(userBalances).set({
        balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(userBalances.userId, userId));

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_share_story',
        description: 'Share Story Mission Reward',
      });

      res.json({
        success: true,
        reward,
        message: `You earned ${reward} Gems!`,
      });
    } catch (error) {
      console.error('❌ Error claiming share story reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/daily-checkin/claim - Claim daily check-in reward
  // 7-day check-in streak rewards (Gems) — matches the 7-day carousel UI
  const CHECKIN_REWARDS = [78, 82, 90, 97, 117, 136, 194];
  // Daily Check-In is once per IST calendar day. Older releases stored the
  // 12-hour AM/PM reset key, so normalize both formats when reading history.
  const getCheckinDayKey = (date = new Date()): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const normalizeCheckinDayKey = (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : getCheckinDayKey(parsed);
  };
  const getLastCheckinClaim = (user: any): string | null =>
    normalizeCheckinDayKey(user.dailyCheckinLastClaimDate || user.dailyTasksDate);

  // GET /api/daily-checkin/status — streak state for the 7-day carousel
  app.get('/api/daily-checkin/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'User not authenticated' });
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const today = getCheckinDayKey();
      const lastClaimDate = getLastCheckinClaim(user);
      
      // Streak continues only if last claim was in the current or immediately previous period
      let streak = user.dailyCheckinStreak || 0;
      if (lastClaimDate !== today) {
        // Simplified streak logic for 12h periods: if not current, reset (or could check previous period)
        // For now, we'll just check if it was claimed in this period
      }
      const dayIndex = streak % CHECKIN_REWARDS.length;
      const alreadyClaimedToday = lastClaimDate === today;

      res.json({
        streak,
        dayIndex,
        reward: CHECKIN_REWARDS[dayIndex],
        alreadyClaimedToday,
        today,
      });
    } catch (error) {
      console.error('Error getting check-in status:', error);
      res.status(500).json({ error: 'Failed to get check-in status' });
    }
  });

  app.post('/api/missions/daily-checkin/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      const { doubleReward = false, proof = null } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getCheckinDayKey();

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const lastClaimDate = getLastCheckinClaim(user);

      if (lastClaimDate === today) {
        return res.status(400).json({ error: 'Already checked in for this period' });
      }

      let streak = user.dailyCheckinStreak || 0;
      // Preserve the streak only when the previous claim was yesterday.
      if (lastClaimDate && lastClaimDate !== today) {
        const todayDate = new Date(`${today}T00:00:00.000Z`);
        const previousDay = new Date(todayDate);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        const previousDayKey = previousDay.toISOString().slice(0, 10);
        if (lastClaimDate !== previousDayKey) streak = 0;
      }
      const dayIndex = streak % CHECKIN_REWARDS.length;
      let reward = CHECKIN_REWARDS[dayIndex];

      // Reward is now always 100% as requested by user
      const isFullReward = true;

      const claimDescription = `Daily Check-in Day ${dayIndex + 1} Reward (streak ${streak + 1})`;
      const claim = await db.transaction(async (tx) => {
        // The conditional update is the single source of truth for duplicate
        // protection; it also makes two simultaneous taps safe.
        const updated = await tx.update(users).set({
          dailyCheckinClaimed: true,
          dailyTasksDate: new Date(),
          dailyCheckinStreak: streak + 1,
          dailyCheckinLastClaimDate: new Date(),
          lastResetPeriod: today,
          balance: sql`COALESCE(${users.balance}, 0) + ${reward.toString()}`,
          withdrawBalance: sql`COALESCE(${users.withdrawBalance}, 0) + ${reward.toString()}`,
          totalEarned: sql`COALESCE(${users.totalEarned}, 0) + ${reward.toString()}`,
          totalEarnings: sql`COALESCE(${users.totalEarnings}, 0) + ${reward.toString()}`,
          updatedAt: new Date(),
        }).where(and(
          eq(users.id, userId),
          sql`NOT (daily_checkin_claimed = true AND daily_checkin_last_claim_date IS NOT NULL AND DATE(daily_checkin_last_claim_date AT TIME ZONE 'Asia/Kolkata') = ${today})`,
        )).returning({ balance: users.balance });
        if (updated.length === 0) return { alreadyClaimed: true as const };

        await tx.insert(dailyMissions).values({
          userId,
          missionType: 'daily_checkin',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        }).onConflictDoUpdate({
          target: [dailyMissions.userId, dailyMissions.missionType, dailyMissions.resetDate],
          set: { completed: true, claimedAt: new Date() },
        });
        await tx.insert(userBalances).values({ userId, balance: reward.toString() })
          .onConflictDoUpdate({
            target: userBalances.userId,
            set: { balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.toString()}`, updatedAt: new Date() },
          });
        const [earning] = await tx.insert(earnings).values({
          userId,
          amount: reward.toString(),
          source: 'mission_daily_checkin',
          description: claimDescription,
          currency: 'GOLD',
        }).returning({ id: earnings.id });
        await tx.insert(transactions).values({
          userId,
          amount: reward.toString(),
          type: 'addition',
          source: 'mission_daily_checkin',
          description: claimDescription,
          metadata: { earningId: earning.id },
        });
        return { alreadyClaimed: false as const, balance: updated[0].balance };
      });
      if (claim.alreadyClaimed) {
        return res.status(400).json({ error: 'Already checked in for this period' });
      }

      res.json({
        success: true,
        reward,
        newStreak: streak + 1,
        newBalance: claim.balance || '0',
        dayIndex,
        isFullReward,
        message: `You earned ${reward} Gems!`,
      });
    } catch (error) {
      console.error('❌ Error claiming daily check-in reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/check-for-updates/claim - Claim check for updates reward
  app.post('/api/missions/check-for-updates/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getResetPeriodKey();
      const reward = 100; // 100 Gold

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'check_for_updates'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'check_for_updates',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward to user balance — atomic increment prevents clobbering concurrent updates
      await db.update(users).set({
        balance: sql`COALESCE(${users.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await db.update(userBalances).set({
        balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(userBalances.userId, userId));

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_check_for_updates',
        description: 'Check for Updates Mission Reward',
      });

      res.json({
        success: true,
        reward,
        message: `You earned ${reward} Gems!`,
      });
    } catch (error) {
      console.error('❌ Error claiming check for updates reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/share-referral/claim - Claim share referral reward
  app.post('/api/missions/share-referral/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'User not authenticated' });

      const today = getResetPeriodKey();
      const reward = 100; // 100 Gold for sharing

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, 'share_referral'),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: 'share_referral',
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward
      await db.update(users).set({
        balance: sql`COALESCE(${users.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await db.update(userBalances).set({
        balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(userBalances.userId, userId));

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: 'mission_share_referral',
        description: 'Share Referral Mission Reward',
      });

      res.json({ success: true, reward, message: `You earned ${reward} Gems!` });
    } catch (error) {
      console.error('❌ Error claiming share referral reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/missions/ads-goal/claim - Claim ads goal reward (10, 30, or 50 ads)
  app.post('/api/missions/ads-goal/claim', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      const { goalType } = req.body; // 'ads_10', 'ads_30', or 'ads_50'

      if (!userId) return res.status(401).json({ error: 'User not authenticated' });
      if (!['ads_10', 'ads_30', 'ads_50'].includes(goalType)) {
        return res.status(400).json({ error: 'Invalid goal type' });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const today = getResetPeriodKey();
      const adsWatched = user.adsWatchedToday || 0;
      const requiredAds = goalType === 'ads_10' ? 10 : goalType === 'ads_30' ? 30 : 50;
      const reward = 100; // 100 Gold for every Daily Milestone

      if (adsWatched < requiredAds) {
        return res.status(400).json({ error: `You need to watch ${requiredAds} ads first. Currently: ${adsWatched}` });
      }

      // Check if already claimed
      const existingMission = await db.query.dailyMissions.findFirst({
        where: and(
          eq(dailyMissions.userId, userId),
          eq(dailyMissions.missionType, goalType),
          eq(dailyMissions.resetDate, today)
        ),
      });

      if (existingMission?.claimedAt) {
        return res.status(400).json({ error: 'Already claimed today' });
      }

      // Create or update mission record
      if (existingMission) {
        await db.update(dailyMissions).set({
          completed: true,
          claimedAt: new Date(),
        }).where(eq(dailyMissions.id, existingMission.id));
      } else {
        await db.insert(dailyMissions).values({
          userId,
          missionType: goalType,
          completed: true,
          claimedAt: new Date(),
          resetDate: today,
        });
      }

      // Add reward
      await db.update(users).set({
        balance: sql`COALESCE(${users.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await db.update(userBalances).set({
        balance: sql`COALESCE(${userBalances.balance}, 0) + ${reward.toString()}`,
        updatedAt: new Date(),
      }).where(eq(userBalances.userId, userId));

      // Record transaction
      await db.insert(transactions).values({
        userId,
        amount: reward.toString(),
        type: 'addition',
        source: `mission_${goalType}`,
        description: `Ads Goal (${requiredAds} ads) Mission Reward`,
      });

      res.json({ success: true, reward, message: `You earned ${reward} Gems!` });
    } catch (error) {
      console.error('❌ Error claiming ads goal reward:', error);
      res.status(500).json({ error: 'Failed to claim reward' });
    }
  });

  // POST /api/share/prepare-message - Prepare a share message for Telegram WebApp shareMessage()
  // Uses Bot API 8.0 savePreparedInlineMessage for native Telegram share dialog
  app.post('/api/share/prepare-message', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.telegram_id) {
        return res.status(400).json({ error: 'Telegram ID not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      if (!TELEGRAM_BOT_TOKEN) {
        return res.status(500).json({ error: 'Bot not configured' });
      }

      const { getBotUsername: getBotUsernameForMission } = await import('./telegram');
      const botUsername = await getBotUsernameForMission();
      const referralLink = `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`;

      const appUrl = process.env.RENDER_EXTERNAL_URL ||
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';

      const shareImageUrl = `${appUrl}/images/axionet-share-banner.png?v=axionet`;
      const webAppUrl = referralLink;

      console.log(`📤 Preparing share message for user ${userId}`);
      console.log(`   Image URL: ${shareImageUrl}`);
      console.log(`   WebApp URL: ${webAppUrl}`);
      console.log(`   Referral Link: ${referralLink}`);

      // Use savePreparedInlineMessage (Bot API 8.0+) to prepare the message
      // This creates a prepared message that can be shared via WebApp.shareMessage()
      // Use regular URL button to trigger /start command for reliable referral tracking
      const inlineResult = {
        type: 'photo',
        id: `share_${user.referralCode}_${Date.now()}`,
        photo_url: shareImageUrl,
        thumbnail_url: shareImageUrl,
        title: '💵 Join Axionet and earn TON!',
        description: '💵 Join Axionet and earn TON just by Mining & completing tasks!',
        caption: '💵 Join Axionet and earn TON just by Mining & completing tasks!',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💸 Start earning',
                url: referralLink
              }
            ]
          ]
        }
      };

      try {
        const prepareResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/savePreparedInlineMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: parseInt(user.telegram_id),
            result: inlineResult,
            allow_user_chats: true,
            allow_bot_chats: true,
            allow_group_chats: true,
            allow_channel_chats: true
          })
        });

        const prepareResult = await prepareResponse.json() as {
          ok?: boolean;
          result?: { id: string };
          description?: string;
          error_code?: number;
        };

        if (prepareResult.ok && prepareResult.result?.id) {
          console.log(`✅ Prepared share message with ID: ${prepareResult.result.id}`);
          return res.json({
            success: true,
            messageId: prepareResult.result.id,
            referralLink
          });
        } else {
          console.error('❌ Failed to prepare share message:', prepareResult.description);
          // Return a fallback with just the referral link for URL-based sharing
          return res.json({
            success: false,
            error: prepareResult.description || 'Failed to prepare message',
            referralLink,
            fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('💵 Join Axionet and earn TON just by Mining & completing tasks!')}`
          });
        }
      } catch (telegramError: any) {
        console.error('❌ Telegram API error:', telegramError);
        return res.json({
          success: false,
          error: telegramError.message || 'Telegram API error',
          referralLink,
          fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('💵 Join Axionet and earn TON just by Mining & completing tasks!')}`
        });
      }

    } catch (error: any) {
      console.error('❌ Error preparing share message:', error);
      res.status(500).json({ error: 'Failed to prepare share message' });
    }
  });

  // POST /api/share/invite - Legacy endpoint (kept for backward compatibility)
  app.post('/api/share/invite', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const { getBotUsername: getBotUsernameForReferral } = await import('./telegram');
      const botUsername = await getBotUsernameForReferral();
      const referralLink = `https://t.me/${botUsername}/MyWAdz?startapp=${encodeURIComponent(user.referralCode)}`;

      // Return just the referral link for the new share flow
      return res.json({
        success: true,
        message: 'Share link ready',
        referralLink
      });

    } catch (error) {
      console.error('❌ Error sending invite:', error);
      res.status(500).json({ error: 'Failed to send invite' });
    }
  });

  // ============ COUNTRY BLOCKING API ============

  // GET /api/check-country - Check if user's country is blocked (for frontend blocking)
  app.get('/api/check-country', async (req: any, res) => {
    try {
      const { getClientIP, getCountryFromIP, getBlockedCountries, isVPNOrProxy } = await import('./countryBlocking');

      // Prevent caching so blocks take effect immediately
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      // Check if user is admin - admins are never blocked
      // SECURITY: Verify Telegram initData signature before trusting admin status
      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      if (telegramData && botToken) {
        try {
          const { verifyTelegramWebAppData } = await import('./auth');
          const { isValid, user: verifiedUser } = verifyTelegramWebAppData(telegramData, botToken);

          if (isValid && verifiedUser && isAdmin(verifiedUser.id.toString())) {
            console.log(`✅ Admin user verified (${verifiedUser.id}), bypassing country check`);
            return res.json({ blocked: false, country: null, isAdmin: true });
          }
        } catch (e) {
          console.log('⚠️ Admin verification failed, continuing with country check');
        }
      }

      // In development mode, allow admin bypass via parsed (unverified) initData
      if (process.env.NODE_ENV === 'development' && telegramData) {
        try {
          const urlParams = new URLSearchParams(telegramData);
          const userString = urlParams.get('user');
          if (userString) {
            const telegramUser = JSON.parse(userString);
            if (isAdmin(telegramUser.id.toString())) {
              console.log('🔧 Dev mode: Admin bypass via parsed data');
              return res.json({ blocked: false, country: null, isAdmin: true });
            }
          }
        } catch (e) {
          // Continue with normal check
        }
      }

      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);

      if (!result.countryCode) {
        return res.json({ blocked: false, country: null });
      }

      const blockedCodes = await getBlockedCountries();
      const countryIsBlocked = blockedCodes.includes(result.countryCode.toUpperCase());

      // VPN BYPASS LOGIC: If user is from blocked country BUT using VPN/proxy/hosting, ALLOW access
      const usingVPN = isVPNOrProxy(result);
      const vpnBypass = countryIsBlocked && usingVPN;

      // Final blocked status: blocked only if country is blocked AND NOT using VPN
      const finalBlocked = countryIsBlocked && !usingVPN;

      if (vpnBypass) {
        console.log(`🔐 VPN bypass granted for ${result.countryCode} (IP: ${clientIP}, VPN: ${result.isVPN}, Hosting: ${result.isHosting})`);
      }

      res.json({
        blocked: finalBlocked,
        country: result.countryCode,
        countryName: result.countryName,
        isVPN: result.isVPN,
        isProxy: result.isProxy,
        isHosting: result.isHosting,
        vpnBypass
      });
    } catch (error) {
      console.error('❌ Error checking country:', error);
      res.json({ blocked: false, country: null });
    }
  });

  // GET /api/user-info - Get user's IP and detected country (for admin panel display)
  app.get('/api/user-info', async (req: any, res) => {
    try {
      const { getClientIP, getAllCountries, getCountryFromIP } = await import('./countryBlocking');

      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);

      let countryName = result.countryName || 'Unknown';
      let countryCode = result.countryCode || 'XX';

      // If we only got country code but no name, try to find it in our list
      if (countryCode !== 'XX' && countryName === 'Unknown') {
        const allCountries = getAllCountries();
        const found = allCountries.find(c => c.code === countryCode);
        if (found) {
          countryName = found.name;
        }
      }

      res.json({
        ip: clientIP || 'Unknown',
        country: countryName,
        countryCode: countryCode
      });
    } catch (error) {
      console.error('❌ Error fetching user info:', error);
      res.status(500).json({
        ip: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX'
      });
    }
  });

  // GET /api/countries - Get all countries (public)
  app.get('/api/countries', async (req: any, res) => {
    try {
      const { getAllCountries } = await import('./countryBlocking');
      const allCountries = getAllCountries();
      res.json({ success: true, countries: allCountries });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // GET /api/blocked - Get list of blocked country codes (public)
  app.get('/api/blocked', async (req: any, res) => {
    try {
      const { getBlockedCountries } = await import('./countryBlocking');
      const blockedCodes = await getBlockedCountries();
      res.json({ success: true, blocked: blockedCodes });
    } catch (error) {
      console.error('❌ Error fetching blocked countries:', error);
      res.status(500).json({ error: 'Failed to fetch blocked countries' });
    }
  });

  // POST /api/block-country - Block a country (requires admin)
  app.post('/api/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;

      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }

      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);

      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);

        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_blocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been blocked`
        });

        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to block country' });
    }
  });

  // POST /api/unblock-country - Unblock a country (requires admin)
  app.post('/api/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;

      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }

      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);

      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);

        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_unblocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been unblocked`
        });

        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to unblock country' });
    }
  });

  // GET /api/admin/countries - Get all countries with block status
  app.get('/api/admin/countries', authenticateAdmin, async (req: any, res) => {
    try {
      const { getAllCountries, getBlockedCountries } = await import('./countryBlocking');

      const allCountries = getAllCountries();
      const blockedCodes = await getBlockedCountries();
      const blockedSet = new Set(blockedCodes);

      const countriesWithStatus = allCountries.map(country => ({
        ...country,
        blocked: blockedSet.has(country.code)
      }));

      res.json({ success: true, countries: countriesWithStatus });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // POST /api/admin/block-country - Block a country
  app.post('/api/admin/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;

      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }

      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);

      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ error: 'Failed to block country' });
    }
  });

  // POST /api/admin/unblock-country - Unblock a country
  app.post('/api/admin/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;

      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }

      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);

      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ error: 'Failed to unblock country' });
    }
  });

  // ─── FEATURE 1: Admin Balance Adjustment ────────────────────────────────────
  app.post('/api/admin/users/:id/adjust-balance', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { action, currency, amount, reason } = req.body;

      if (!['add', 'deduct', 'set'].includes(action)) return res.status(400).json({ error: 'Invalid action. Use add|deduct|set' });
      const c = currency === 'swag' ? 'pow' : currency;
      if (!['pow', 'usd', 'ton'].includes(c)) return res.status(400).json({ error: 'Invalid currency. Use swag|usd|ton' });
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });

      const targetUser = await storage.getUser(id);
      if (!targetUser) return res.status(404).json({ error: 'User not found' });

      let fieldKey = c === 'pow' ? 'balance' : c === 'usd' ? 'usdBalance' : 'tonBalance';
      const current = parseFloat((targetUser as any)[fieldKey]?.toString() || '0');

      let newVal: number;
      if (action === 'add') newVal = current + amt;
      else if (action === 'deduct') newVal = Math.max(0, current - amt);
      else newVal = amt;

      const updateData: any = { updatedAt: new Date() };
      updateData[fieldKey] = newVal.toString();
      await db.update(users).set(updateData).where(eq(users.id, id));

      // Keep user_balances in sync for Gems adjustments using UPSERT.
      // A plain UPDATE silently hits 0 rows when the user has no user_balances record,
      // leaving user_balances stale and causing addEarning to work from a wrong base.
      if (c === 'pow') {
        await db.insert(userBalances)
          .values({ userId: id, balance: newVal.toString(), updatedAt: new Date() })
          .onConflictDoUpdate({
            target: userBalances.userId,
            set: { balance: newVal.toString(), updatedAt: new Date() },
          });
      }

      const txSource = `admin_${action}_${c}`;
      const txType = action === 'deduct' ? 'deduction' : 'addition';
      await db.insert(transactions).values({
        userId: id,
        amount: amt.toString(),
        type: txType,
        source: txSource,
        description: reason ? `Admin adjustment: ${reason}` : `Admin ${action} ${currency.toUpperCase()}`,
      });

      res.json({ success: true, previous: current, newBalance: newVal, currency, action, amount: amt });
    } catch (error) {
      console.error('❌ Error adjusting balance:', error);
      res.status(500).json({ error: 'Failed to adjust balance' });
    }
  });

  // POST /api/admin/repair/backfill-counters
  // Repairs users whose counter columns (ads_watched, total_earned, balance) have
  // drifted from the canonical earnings / user_balances tables.
  // Safe to run multiple times — uses UPDATE … FROM aggregates, never deletes data.
  app.post('/api/admin/repair/backfill-counters', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.body; // optional — omit to repair ALL users

      const whereClause = userId ? sql`WHERE u.id = ${userId}` : sql``;

      // 1. Sync users.ads_watched from the earnings table (count ad-watch rows)
      const adsResult = await db.execute(sql`
        UPDATE users u
        SET ads_watched = sub.ad_count,
            updated_at  = NOW()
        FROM (
          SELECT user_id,
                 COUNT(*) AS ad_count
          FROM   earnings
          WHERE  source IN ('ad_watch', 'mission_ad', 'adsgram', 'monetag', 'gigapub',
                            'extra_ad', 'bonus_ad', 'daily_bonus')
          GROUP  BY user_id
        ) sub
        WHERE u.id = sub.user_id
          AND (u.ads_watched IS NULL OR u.ads_watched < sub.ad_count)
          ${whereClause}
      `);

      // 2. Sync users.total_earned from the earnings table (sum of all non-withdrawal rows)
      const earnedResult = await db.execute(sql`
        UPDATE users u
        SET total_earned = sub.total,
            updated_at   = NOW()
        FROM (
          SELECT user_id,
                 COALESCE(SUM(amount::numeric), 0) AS total
          FROM   earnings
          WHERE  source <> 'withdrawal'
          GROUP  BY user_id
        ) sub
        WHERE u.id = sub.user_id
          AND (u.total_earned IS NULL
               OR ABS(u.total_earned::numeric - sub.total) > 1)
          ${whereClause}
      `);

      // 3. Sync users.balance AND user_balances.balance from whichever is larger
      //    (takes the max so we never accidentally reduce a balance)
      const balanceResult = await db.execute(sql`
        UPDATE users u
        SET balance    = GREATEST(
                           COALESCE(u.balance::numeric,  0),
                           COALESCE(ub.balance::numeric, 0)
                         )::text,
            updated_at = NOW()
        FROM user_balances ub
        WHERE ub.user_id = u.id
          AND ABS(COALESCE(u.balance::numeric, 0) - COALESCE(ub.balance::numeric, 0)) > 1
          ${whereClause}
      `);

      // 4. Mirror the reconciled users.balance back into user_balances
      await db.execute(sql`
        UPDATE user_balances ub
        SET balance    = u.balance,
            updated_at = NOW()
        FROM users u
        WHERE ub.user_id = u.id
          AND ABS(COALESCE(ub.balance::numeric, 0) - COALESCE(u.balance::numeric, 0)) > 1
          ${whereClause}
      `);

      res.json({
        success: true,
        message: userId
          ? `Counters repaired for user ${userId}`
          : 'Counter backfill complete for all users',
        rowsUpdated: {
          adsWatched: (adsResult as any).rowCount ?? 0,
          totalEarned: (earnedResult as any).rowCount ?? 0,
          balance: (balanceResult as any).rowCount ?? 0,
        },
      });
    } catch (error) {
      console.error('❌ Error in counter backfill:', error);
      res.status(500).json({ error: 'Backfill failed', detail: String(error) });
    }
  });

  // GET audit log for a user (balance transactions)
  app.get('/api/admin/users/:id/balance-log', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const logs = await db.select().from(transactions)
        .where(and(eq(transactions.userId, id), sql`source LIKE 'admin_%'`))
        .orderBy(desc(transactions.createdAt))
        .limit(50);
      res.json({ success: true, logs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch balance log' });
    }
  });

  // ─── FEATURE 2: Promo Code Toggle / Edit ─────────────────────────────────────
  // ── Delete promo code ────────────────────────────────────────────────────────
  app.delete('/api/admin/promo-codes/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      // Wrap in transaction so partial failure leaves no orphaned rows
      await db.transaction(async (tx) => {
        await tx.delete(promoCodeUsage).where(eq(promoCodeUsage.promoCodeId, id));
        await tx.delete(promoCodes).where(eq(promoCodes.id, id));
      });
      res.json({ success: true, message: 'Promo code deleted' });
    } catch (error) {
      console.error('❌ Error deleting promo code:', error);
      res.status(500).json({ error: 'Failed to delete promo code' });
    }
  });

  app.put('/api/admin/promo-codes/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { isActive, rewardAmount, usageLimit, expiresAt } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (typeof isActive === 'boolean') updateData.isActive = isActive;
      if (rewardAmount !== undefined) {
        const ra = parseFloat(rewardAmount);
        if (!isNaN(ra) && ra >= 0) updateData.rewardAmount = ra.toString();
      }
      if (usageLimit !== undefined) {
        if (usageLimit === null || usageLimit === '' || usageLimit === 0) {
          updateData.usageLimit = null; // unlimited
        } else {
          const ul = parseInt(usageLimit);
          if (!isNaN(ul) && ul > 0) updateData.usageLimit = ul;
        }
      }
      if (expiresAt !== undefined) {
        updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
      }

      if (Object.keys(updateData).length <= 1) return res.status(400).json({ error: 'Nothing to update' });

      await db.update(promoCodes).set(updateData).where(eq(promoCodes.id, id));
      const [updated] = await db.select().from(promoCodes).where(eq(promoCodes.id, id));
      res.json({ success: true, promoCode: updated });
    } catch (error) {
      console.error('❌ Error updating promo code:', error);
      res.status(500).json({ error: 'Failed to update promo code' });
    }
  });

  // Legacy daily missions removed

  // ─── FEATURE 4: Task Edit ─────────────────────────────────────────────────────
  app.put('/api/admin/tasks/:id/edit', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { title, description, totalClicksRequired, costPerClick, status } = req.body;

      const updateData: any = { updatedAt: new Date() };
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (totalClicksRequired !== undefined) {
        const n = parseInt(totalClicksRequired);
        if (!isNaN(n) && n > 0) updateData.totalClicksRequired = n;
      }
      if (costPerClick !== undefined) {
        const c = parseFloat(costPerClick);
        if (!isNaN(c) && c > 0) updateData.costPerClick = c.toString();
      }
      if (status !== undefined && ['under_review', 'running', 'paused', 'completed', 'rejected'].includes(status)) {
        updateData.status = status;
      }

      await db.update(advertiserTasks).set(updateData).where(eq(advertiserTasks.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error editing task:', error);
      res.status(500).json({ error: 'Failed to edit task' });
    }
  });

  // ─── FEATURE 6: Advanced User Search (update existing route) — see below ──────
  // (Existing GET /api/admin/users route updated via in-place edit)

  // ─── FEATURE 7: Withdrawal Analytics ─────────────────────────────────────────
  app.get('/api/admin/users/:id/analytics', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Count friends
      const allReferrals = await db.query.referrals.findMany({ where: eq(referrals.referrerId, id) });
      const activeReferralsCount = allReferrals.filter((r: any) => r.status === 'active').length;

      // Completed tasks (advertiser task clicks) + Gems earned from them
      const taskStats = await db
        .select({
          count: sql<number>`count(*)`,
          totalReward: sql<string>`COALESCE(SUM(${taskClicks.rewardAmount}), 0)`,
        })
        .from(taskClicks)
        .where(eq(taskClicks.publisherId, id));

      // Total withdrawn (only successful/paid/approved withdrawals count)
      const withdrawnStats = await db
        .select({ total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)` })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, id),
          sql`${withdrawals.status} IN ('completed', 'success', 'paid', 'Approved')`
        ));

      // Gems earned from watched ads
      const adsEarnedStats = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)` })
        .from(earnings)
        .where(and(
          eq(earnings.userId, id),
          sql`${earnings.source} IN ('ad_watch', 'mission_ad')`
        ));

      // Referral income: total commissions earned as a referrer
      const referralIncomeStats = await db
        .select({ total: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)` })
        .from(referralCommissions)
        .where(eq(referralCommissions.referrerId, id));

      // Promo codes claimed + Gems earned from promo codes (Gems/Gems reward type only)
      const promoClaimStats = await db
        .select({ count: sql<number>`count(*)` })
        .from(promoCodeUsage)
        .where(eq(promoCodeUsage.userId, id));

      const promoPowStats = await db
        .select({ total: sql<string>`COALESCE(SUM(${promoCodeUsage.rewardAmount}), 0)` })
        .from(promoCodeUsage)
        .innerJoin(promoCodes, eq(promoCodeUsage.promoCodeId, promoCodes.id))
        .where(and(
          eq(promoCodeUsage.userId, id),
          sql`UPPER(${promoCodes.rewardType}) IN ('Gems', 'Gems')`
        ));

      // Recent transactions
      const recentTx = await db.select().from(transactions)
        .where(eq(transactions.userId, id))
        .orderBy(desc(transactions.createdAt))
        .limit(5);

      const ageMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : 0;
      const ageDays = Math.floor(ageMs / 86400000);

      res.json({
        success: true,
        analytics: {
          uid: user.referralCode || user.personalCode,
          joinDate: user.createdAt,
          ageDays,
          totalFriends: allReferrals.length,
          activeFriends: activeReferralsCount,
          referralCount: allReferrals.length,
          referralIncome: referralIncomeStats[0]?.total || '0',
          adsWatched: user.adsWatched || 0,
          adsWatchedToday: user.adsWatchedToday || 0,
          tasksCompleted: taskStats[0]?.count || 0,
          powFromTasks: taskStats[0]?.totalReward || '0',
          powFromAds: adsEarnedStats[0]?.total || '0',
          totalWithdrawn: withdrawnStats[0]?.total || '0',
          promoCodesClaimed: promoClaimStats[0]?.count || 0,
          powFromPromoCodes: promoPowStats[0]?.total || '0',
          totalEarned: user.totalEarned?.toString() || '0',
          balance: user.balance?.toString() || '0',
          usdBalance: user.usdBalance?.toString() || '0',
          recentTransactions: recentTx,
          banned: user.banned || false,
        }
      });
    } catch (error) {
      console.error('❌ Error fetching user analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  // Complete deposit history for a user (TON deposits)
  app.get('/api/admin/user-deposits/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { tonDeposits } = await import('../shared/schema');
      const deposits = await db
        .select()
        .from(tonDeposits)
        .where(eq(tonDeposits.userId, id))
        .orderBy(desc(tonDeposits.createdAt));
      res.json({ success: true, deposits });
    } catch (error) {
      console.error('❌ Error fetching user deposit history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch deposit history' });
    }
  });

  // Complete ban history for a single user (used by the "Bans" tab on their
  // profile). This endpoint was previously missing entirely — the frontend
  // called it, always got a 404, and silently showed "No ban history" even
  // for users with real ban records.
  app.get('/api/admin/user-ban-history/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const logs = await db
        .select()
        .from(banLogs)
        .where(eq(banLogs.bannedUserId, id))
        .orderBy(desc(banLogs.createdAt));
      res.json({ success: true, banLogs: logs });
    } catch (error) {
      console.error('❌ Error fetching user ban history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch ban history' });
    }
  });

  // Complete task creation history for a user (tasks they created as an advertiser)
  app.get('/api/admin/user-created-tasks/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const createdTasks = await db
        .select()
        .from(advertiserTasks)
        .where(eq(advertiserTasks.advertiserId, id))
        .orderBy(desc(advertiserTasks.createdAt));
      res.json({ success: true, tasks: createdTasks });
    } catch (error) {
      console.error('❌ Error fetching user task creation history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch task creation history' });
    }
  });

  // Complete referral list for a user
  app.get('/api/admin/user-referrals/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const refereeUser = alias(users, 'refereeUser');

      const [userReferrals, commissionStats] = await Promise.all([
        db
          .select({
            id: referrals.id,
            refereeId: referrals.refereeId,
            refereeCode: refereeUser.referralCode,
            refereeName: refereeUser.firstName,
            rewardAmount: referrals.rewardAmount,
            status: referrals.status,
            createdAt: referrals.createdAt,
          })
          .from(referrals)
          .leftJoin(refereeUser, eq(referrals.refereeId, refereeUser.id))
          .where(eq(referrals.referrerId, id))
          .orderBy(desc(referrals.createdAt)),

        db
          .select({
            totalIncome: sql<string>`COALESCE(SUM(${referralCommissions.commissionAmount}), 0)`,
            totalTransactions: sql<number>`COUNT(*)`,
          })
          .from(referralCommissions)
          .where(eq(referralCommissions.referrerId, id)),
      ]);

      const totalReferralIncome = commissionStats[0]?.totalIncome || '0';
      const totalTransactions = commissionStats[0]?.totalTransactions || 0;
      const activeCount = userReferrals.filter((r: any) => r.status === 'active').length;

      res.json({
        success: true,
        referrals: userReferrals,
        summary: {
          totalIncome: totalReferralIncome,
          totalTransactions,
          totalReferrals: userReferrals.length,
          activeReferrals: activeCount,
        },
      });
    } catch (error) {
      console.error('❌ Error fetching user referrals:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
    }
  });

  // Completed tasks for a user (tasks they clicked/did as a publisher)
  app.get('/api/admin/user-tasks/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const completedTasks = await db
        .select({
          id: taskClicks.id,
          title: advertiserTasks.title,
          taskType: advertiserTasks.taskType,
          completedAt: taskClicks.clickedAt,
          reward: taskClicks.rewardAmount,
        })
        .from(taskClicks)
        .leftJoin(advertiserTasks, eq(taskClicks.taskId, advertiserTasks.id))
        .where(eq(taskClicks.publisherId, id))
        .orderBy(desc(taskClicks.clickedAt))
        .limit(200);
      res.json({ success: true, tasks: completedTasks });
    } catch (error) {
      console.error('❌ Error fetching user completed tasks:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch completed tasks' });
    }
  });

  // Ad-watching stats for a user (admin) — the frontend's Ads tab was calling
  // this endpoint, but it never existed on the backend, so the tab always
  // fell back to partial data from the users-list row.
  app.get('/api/admin/user-ads/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const targetUser = await storage.getUser(id);
      if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

      // Ads watched since the user's last completed withdrawal (mirrors the
      // same calculation used for withdrawal eligibility).
      const lastWithdrawal = await db
        .select({ createdAt: withdrawals.createdAt })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, id),
          sql`LOWER(CAST(${withdrawals.status} AS TEXT)) IN ('completed', 'approved')`
        ))
        .orderBy(desc(withdrawals.createdAt))
        .limit(1);

      let adsWatchedSinceLastWithdrawal: number;
      if (lastWithdrawal.length === 0) {
        adsWatchedSinceLastWithdrawal = (targetUser as any).adsWatched || 0;
      } else {
        const adsCountResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(earnings)
          .where(and(
            eq(earnings.userId, id),
            eq(earnings.source, 'ad_watch'),
            gte(earnings.createdAt, lastWithdrawal[0].createdAt as Date)
          ));
        adsWatchedSinceLastWithdrawal = Number(adsCountResult[0]?.count || 0);
      }

      res.json({
        success: true,
        ads: {
          adsWatched: (targetUser as any).adsWatched || 0,
          adsWatchedToday: (targetUser as any).adsWatchedToday || 0,
          dailyAdsWatched: (targetUser as any).dailyAdsWatched || 0,
          monetagAdsWatchedToday: (targetUser as any).monetagAdsWatchedToday || 0,
          gigapubAdsWatchedToday: (targetUser as any).gigapubAdsWatchedToday || 0,
          usladsAdsWatchedToday: (targetUser as any).usladsAdsWatchedToday || 0,
          adsWatchedSinceLastWithdrawal,
          lastAdWatch: (targetUser as any).lastAdWatch || null,
        },
      });
    } catch (error) {
      console.error('❌ Error fetching user ad stats:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch ad stats' });
    }
  });

  // Ambassador info for a user (admin)
  app.get('/api/admin/user-ambassador/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [ambassador] = await db
        .select({
          id: ambassadors.id,
          promoCodeName: ambassadors.promoCodeName,
          promoPrefix: ambassadors.promoPrefix,
          totalClaims: ambassadors.totalClaims,
          totalEarningsUsd: ambassadors.totalEarningsUsd,
          status: ambassadors.status,
          channelVerified: ambassadors.channelVerified,
          createdAt: ambassadors.createdAt,
          channelTitle: ambassadorApplications.channelTitle,
          channelUsername: ambassadorApplications.channelUsername,
          subscriberCount: ambassadorApplications.subscriberCount,
        })
        .from(ambassadors)
        .leftJoin(ambassadorApplications, eq(ambassadors.applicationId, ambassadorApplications.id))
        .where(eq(ambassadors.userId, id))
        .limit(1);
      res.json({ success: true, ambassador: ambassador || null });
    } catch (error) {
      console.error('❌ Error fetching user ambassador info:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch ambassador info' });
    }
  });

  // Swap/conversion history for a user
  app.get('/api/admin/user-swaps/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const swapHistory = await db
        .select()
        .from(transactions)
        .where(and(
          eq(transactions.userId, id),
          eq(transactions.source, 'convert')
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(100);
      res.json({ success: true, swaps: swapHistory });
    } catch (error) {
      console.error('❌ Error fetching user swap history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch swap history' });
    }
  });

  // Prizes settings may be stored either as JSON (e.g. '["$20","$10"]') or as
  // plain newline-separated text (e.g. "🤴🏻 $20\n💎 $10\n..."). Parse safely.
  const parsePrizesSetting = (raw: string): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [String(parsed)];
    } catch {
      return raw.split('\n').map(p => p.trim()).filter(Boolean);
    }
  };

  // ── Leaderboard: Monthly Stars Contest ───────────────────────────────────────
  app.get('/api/leaderboard/weekly', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id || null;

      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) =>
        allSettings.find(s => s.settingKey === key)?.settingValue || def;

      const contestEnabled = getSetting('monthly_contest_enabled', 'false') === 'true';
      const topN = Math.max(1, Math.min(1000, parseInt(getSetting('monthly_contest_top_users', '10')) || 10));
      const endDate = getSetting('monthly_contest_end_date', '');
      const startDate = getSetting('monthly_contest_start_date', '');
      // Weekly Ad Leaderboard prizes are fixed by rank; admins only control the contest lifecycle.
      const prizes = [
        '500,000 Gold',
        '250,000 Gold',
        '100,000 Gold',
        '50,000 Gold',
        '50,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
      ];

      if (!contestEnabled) {
        return res.json({ leaderboard: [], userRank: null, userStars: 0, contestActive: false, topN: 10, endDate: endDate || null, startDate: startDate || null, prizes });
      }

      // Get top N users by weeklyStars
      const topUsers = await db.execute(sql`
        SELECT id, username, first_name, profile_image_url, weekly_stars
        FROM users
        WHERE weekly_stars > 0 AND banned = false
        ORDER BY weekly_stars DESC, id ASC
        LIMIT ${topN}
      `);

      const leaderboard = (topUsers.rows as any[]).map((row, i) => ({
        userId: row.id,
        username: row.username,
        firstName: row.first_name,
        avatarUrl: row.profile_image_url || null,
        weeklyStars: row.weekly_stars || 0,
        rank: i + 1,
      }));

      let userRank = null;
      let userStars = 0;

      if (userId) {
        const user = await storage.getUser(userId);
        userStars = (user as any)?.weeklyStars || 0;
          const rankResult = await db.execute(sql`
            SELECT COUNT(*) + 1 AS rank
            FROM users
            WHERE weekly_stars > ${userStars} AND banned = false
          `);
          
        const rank = parseInt((rankResult.rows[0] as any)?.rank || '0');
        if (userStars > 0) {
          userRank = { rank, weeklyStars: userStars, avatarUrl: (user as any).profileImageUrl || null };
        }
      }

      res.json({ leaderboard, userRank, userStars, contestActive: true, topN: 10, endDate: endDate || null, startDate: startDate || null, prizes });
    } catch (error) {
      console.error('Error fetching monthly leaderboard:', error);
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // ── Leaderboard: Weekly Referral Contest ──────────────────────────────────────
  app.get('/api/leaderboard/referral', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id || null;

      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) =>
        allSettings.find(s => s.settingKey === key)?.settingValue || def;

      const contestEnabled = getSetting('weekly_referral_contest_enabled', 'false') === 'true';
      const topN = 10;
      const endDate = getSetting('weekly_referral_end_date', '');
      const startDate = getSetting('weekly_referral_start_date', '');
      // Referral Contest prizes are fixed by rank; admins only control lifecycle settings.
      const prizes = [
        '500,000 Gold',
        '250,000 Gold',
        '100,000 Gold',
        '50,000 Gold',
        '50,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
        '1,000 Gold',
      ];

      if (!contestEnabled) {
        return res.json({ leaderboard: [], userRank: null, contestActive: false, topN: 10, endDate: endDate || null, startDate: startDate || null, prizes });
      }

      // Count ALL referrals per user within contest period (pending + completed).
      // This ensures new invites are immediately visible on the leaderboard.
      const topReferrers = await db.execute(sql`
        SELECT u.id, u.username, u.first_name, u.profile_image_url, COUNT(r.id) AS referral_count
        FROM users u
        INNER JOIN referrals r ON r.referrer_id = u.id
        WHERE u.banned = false
          ${startDate ? sql`AND r.created_at >= ${new Date(startDate)}` : sql``}
          ${endDate ? sql`AND r.created_at <= ${new Date(endDate)}` : sql``}
        GROUP BY u.id, u.username, u.first_name, u.profile_image_url
        HAVING COUNT(r.id) > 0
        ORDER BY referral_count DESC, u.id ASC
        LIMIT ${topN}
      `);

      const leaderboard = (topReferrers.rows as any[]).map((row, i) => ({
        userId: row.id,
        username: row.username,
        firstName: row.first_name,
        avatarUrl: row.profile_image_url || null,
        referralCount: parseInt(row.referral_count) || 0,
        rank: i + 1,
      }));

      let userRank = null;

      if (userId) {
        const user = await storage.getUser(userId);
        if (user) {
          const userCountResult = await db.execute(sql`
            SELECT COUNT(r.id) AS referral_count
            FROM referrals r
            WHERE r.referrer_id = ${userId}
              ${startDate ? sql`AND r.created_at >= ${new Date(startDate)}` : sql``}
              ${endDate ? sql`AND r.created_at <= ${new Date(endDate)}` : sql``}
          `);
          const userCount = parseInt((userCountResult.rows[0] as any)?.referral_count || '0');

          if (userCount > 0) {
            const rankResult = await db.execute(sql`
              SELECT COUNT(DISTINCT sub.referrer_id) + 1 AS rank
              FROM (
                SELECT r.referrer_id, COUNT(r.id) AS rc
                FROM referrals r
                INNER JOIN users u ON u.id = r.referrer_id
                WHERE u.banned = false
                  ${startDate ? sql`AND r.created_at >= ${new Date(startDate)}` : sql``}
                  ${endDate ? sql`AND r.created_at <= ${new Date(endDate)}` : sql``}
                GROUP BY r.referrer_id
              ) sub
              WHERE sub.rc > ${userCount}
            `);
            const rank = parseInt((rankResult.rows[0] as any)?.rank || '1');
            userRank = { rank, referralCount: userCount, avatarUrl: (user as any).profileImageUrl || null };
          }
        }
      }

      res.json({ leaderboard, userRank, contestActive: true, topN: 10, endDate: endDate || null, startDate: startDate || null, prizes });
    } catch (error) {
      console.error('Error fetching referral leaderboard:', error);
      res.status(500).json({ error: 'Failed to fetch referral leaderboard' });
    }
  });

  // ── Admin: Get contest settings ───────────────────────────────────────────────
  app.get('/api/admin/contest-settings', authenticateAdmin, async (req: any, res) => {
    try {
      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, def: string) =>
        allSettings.find(s => s.settingKey === key)?.settingValue || def;

      res.json({
        weeklyReferralContestEnabled: getSetting('weekly_referral_contest_enabled', 'false') === 'true',
        weeklyReferralStartDate: getSetting('weekly_referral_start_date', ''),
        weeklyReferralEndDate: getSetting('weekly_referral_end_date', ''),
        weeklyReferralTopUsers: 10,
        monthlyContestEnabled: getSetting('monthly_contest_enabled', 'false') === 'true',
        monthlyContestStartDate: getSetting('monthly_contest_start_date', ''),
        monthlyContestEndDate: getSetting('monthly_contest_end_date', ''),
        monthlyContestPrizes: getSetting('monthly_contest_prizes', ''),
        monthlyContestTopUsers: parseInt(getSetting('monthly_contest_top_users', '10')),
        starsPerAd: parseInt(getSetting('stars_per_ad', '1')),
      });
    } catch (error) {
      console.error('Error fetching contest settings:', error);
      res.status(500).json({ message: 'Failed to fetch contest settings' });
    }
  });

  // ── Admin: Update contest settings ───────────────────────────────────────────
  app.post('/api/admin/contest-settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settings: Record<string, string> = {
        weekly_referral_contest_enabled: req.body.weeklyReferralContestEnabled ? 'true' : 'false',
        weekly_referral_start_date: req.body.weeklyReferralStartDate || '',
        weekly_referral_end_date: req.body.weeklyReferralEndDate || '',
        weekly_referral_top_users: '10',
        monthly_contest_enabled: req.body.monthlyContestEnabled ? 'true' : 'false',
        monthly_contest_start_date: req.body.monthlyContestStartDate || '',
        monthly_contest_end_date: req.body.monthlyContestEndDate || '',
        monthly_contest_prizes: req.body.monthlyContestPrizes || '',
        monthly_contest_top_users: String(Math.max(1, Math.min(1000, parseInt(req.body.monthlyContestTopUsers) || 10))),
        stars_per_ad: String(req.body.starsPerAd || 1),
      };

      for (const [key, value] of Object.entries(settings)) {
        await db.insert(adminSettings)
          .values({ settingKey: key, settingValue: value, description: 'Contest setting' })
          .onConflictDoUpdate({ target: adminSettings.settingKey, set: { settingValue: value, updatedAt: new Date() } });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating contest settings:', error);
      res.status(500).json({ message: 'Failed to update contest settings' });
    }
  });

  // ── My Referrals: list all referrals with their status ───────────────────────
  app.get('/api/referrals/my-referrals', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.json({ referrals: [] });

      const myReferrals = await db
        .select({
          id: referrals.id,
          status: referrals.status,
          createdAt: referrals.createdAt,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(referrals)
        .innerJoin(users, eq(referrals.refereeId, users.id))
        .where(eq(referrals.referrerId, userId))
        .orderBy(desc(referrals.createdAt));

      const result = myReferrals.map(r => ({
        id: r.id,
        username: r.username || null,
        displayName: r.firstName
          ? `${r.firstName}${r.lastName ? ' ' + r.lastName : ''}`.trim()
          : (r.username || 'Unknown'),
        status: r.status === 'completed' || r.status === 'active' ? 'success' : 'pending',
        createdAt: r.createdAt,
      }));

      res.json({ referrals: result });
    } catch (error) {
      console.error('❌ Error fetching my referrals:', error);
      res.status(500).json({ referrals: [] });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AMBASSADOR PROGRAM ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // Get current user's ambassador status
  app.get('/api/ambassador/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      const [application] = await db.select().from(ambassadorApplications)
        .where(eq(ambassadorApplications.userId, userId))
        .orderBy(desc(ambassadorApplications.createdAt)).limit(1);

      res.json({
        isAmbassador: !!ambassador && ambassador.status === 'active',
        ambassador: ambassador || null,
        application: application || null,
      });
    } catch (error) {
      console.error('Error fetching ambassador status:', error);
      res.status(500).json({ message: 'Failed to fetch ambassador status' });
    }
  });

  // Submit ambassador application
  app.post('/api/ambassador/apply', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { channelLink, termsAccepted } = req.body;

      if (!channelLink?.trim()) {
        return res.status(400).json({ success: false, message: 'Channel link is required' });
      }
      if (!termsAccepted) {
        return res.status(400).json({ success: false, message: 'You must accept the Terms & Conditions' });
      }

      // Check for existing active ambassador
      const [existingAmb] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (existingAmb) {
        return res.status(400).json({ success: false, message: 'You are already an ambassador' });
      }

      // Check for existing pending application
      const [existingApp] = await db.select().from(ambassadorApplications)
        .where(and(eq(ambassadorApplications.userId, userId), eq(ambassadorApplications.status, 'pending'))).limit(1);
      if (existingApp) {
        return res.status(400).json({ success: false, message: 'You already have a pending application' });
      }

      // ── Verify bot admin status FIRST (no bypass) ────────────────────────────
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const cleanLink = channelLink.trim()
        .replace('https://t.me/', '').replace('http://t.me/', '')
        .replace('t.me/', '').replace(/^@/, '').split('/')[0];

      if (!botToken) {
        return res.status(503).json({ success: false, message: 'Bot is not configured. Please contact support.' });
      }

      const { checkBotCanPostToChannel, getBotUsername } = await import('./telegram');
      const channelIdentifier = cleanLink.startsWith('-') ? cleanLink : `@${cleanLink}`;
      const permCheck = await checkBotCanPostToChannel(botToken, channelIdentifier);
      const botName = await getBotUsername();

      if (!permCheck.chatId) {
        return res.status(400).json({
          success: false,
          message: `Channel not found. Make sure the username is correct and the channel is public. (tried: ${channelIdentifier})`,
        });
      }
      if (!permCheck.isAdmin) {
        return res.status(400).json({
          success: false,
          message: `@${botName} is not an administrator in this channel. Please:\n1. Open your channel settings\n2. Add @${botName} as administrator\n3. Enable "Post Messages" permission\n4. Then submit your application again.`,
        });
      }
      if (!permCheck.hasPostPermission) {
        return res.status(400).json({
          success: false,
          message: `@${botName} is an admin in your channel but "Post Messages" permission is disabled. Please enable it and try again.`,
        });
      }

      // ── Fetch additional channel metadata ────────────────────────────────────
      let channelTitle: string | null = null;
      let channelUsername: string | null = null;
      let subscriberCount: number | null = null;

      try {
        const chatResp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${channelIdentifier}`);
        if (chatResp.ok) {
          const chatData = await chatResp.json();
          if (chatData.ok && chatData.result) {
            channelTitle = chatData.result.title || null;
            channelUsername = chatData.result.username || null;
          }
        }
        const countResp = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${channelIdentifier}`);
        if (countResp.ok) {
          const countData = await countResp.json();
          if (countData.ok) subscriberCount = countData.result;
        }
      } catch (_) {}

      // ── Minimum subscriber requirement ───────────────────────────────────────
      if (subscriberCount !== null && subscriberCount < 1000) {
        return res.status(400).json({
          success: false,
          message: `Your channel needs at least 1,000 subscribers to apply. Current count: ${subscriberCount.toLocaleString()}. Please grow your channel and try again.`,
        });
      }

      // ── Duplicate channel protection ─────────────────────────────────────────
      // Reject if this channel username is already linked to another ambassador or pending application
      if (channelUsername) {
        const [existingAppByChannel] = await db
          .select({ id: ambassadorApplications.id, userId: ambassadorApplications.userId })
          .from(ambassadorApplications)
          .where(and(
            eq(ambassadorApplications.channelUsername, channelUsername),
            sql`${ambassadorApplications.status} IN ('pending', 'approved')`
          ))
          .limit(1);
        if (existingAppByChannel && existingAppByChannel.userId !== userId) {
          return res.status(400).json({
            success: false,
            message: 'This channel is already registered with another ambassador account.',
          });
        }
      }

      const [application] = await db.insert(ambassadorApplications).values({
        userId,
        channelLink: channelLink.trim(),
        channelTitle,
        channelUsername,
        subscriberCount,
        status: 'pending',
        termsAccepted: true,
      }).returning();

      // Notify admins
      try {
        const user = await storage.getUser(userId);
        const adminIds = await getAllAdminTelegramIds();
        const { sendTelegramMessage } = await import('./telegram');
        for (const adminId of adminIds) {
          await sendTelegramMessage(
            `📢 <b>New Ambassador Application</b>\n\n` +
            `👤 User: ${user?.firstName || ''} ${user?.lastName || ''} (@${user?.username || 'N/A'})\n` +
            `🆔 Telegram ID: ${user?.telegram_id || 'N/A'}\n` +
            `📣 Channel: ${channelLink.trim()}\n` +
            `📋 Title: ${channelTitle || 'N/A'}\n` +
            `👥 Subscribers: ${subscriberCount ?? 'N/A'}\n\n` +
            `Review in Admin Panel → Ambassador Applications`,
            { parse_mode: 'HTML', chat_id: adminId }
          ).catch(() => {});
        }
      } catch (_) {}

      res.json({ success: true, application });
    } catch (error) {
      console.error('Error submitting ambassador application:', error);
      res.status(500).json({ success: false, message: 'Failed to submit application' });
    }
  });

  // Get ambassador dashboard data
  app.get('/api/ambassador/dashboard', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Not an ambassador' });

      // Get recent promo history (individual earnings) with claim user info
      const historyRows = await db.select({
        id: ambassadorEarnings.id,
        promoCode: ambassadorEarnings.promoCode,
        commissionUsd: ambassadorEarnings.commissionUsd,
        createdAt: ambassadorEarnings.createdAt,
        claimUserUsername: users.username,
        claimUserFirstName: users.firstName,
      }).from(ambassadorEarnings)
        .leftJoin(users, eq(ambassadorEarnings.claimUserId, users.id))
        .where(eq(ambassadorEarnings.ambassadorId, ambassador.id))
        .orderBy(desc(ambassadorEarnings.createdAt))
        .limit(200);

      // Get all promo codes for this ambassador (by prefix) with usage counts
      const prefix2 = (ambassador.promoPrefix || ambassador.promoCodeName).toUpperCase();
      const allAmbassadorCodes = await db.select().from(promoCodes)
        .where(sql`UPPER(${promoCodes.code}) LIKE ${prefix2 + '%'}`)
        .orderBy(desc(promoCodes.createdAt))
        .limit(50);

      // Build grouped per-promo-code history
      const claimsByCode: Record<string, typeof historyRows> = {};
      for (const row of historyRows) {
        if (!claimsByCode[row.promoCode]) claimsByCode[row.promoCode] = [];
        claimsByCode[row.promoCode].push(row);
      }

      const promoCodeHistory = allAmbassadorCodes.map(pc => {
        const claims = claimsByCode[pc.code] || [];
        const totalEarnings = claims.reduce((sum, c) => sum + parseFloat(c.commissionUsd || '0'), 0);
        const isExpired = (pc.usageLimit && (pc.usageCount || 0) >= pc.usageLimit) ||
          (pc.expiresAt ? new Date(pc.expiresAt) < new Date() : false);
        const status = (!pc.isActive || isExpired) ? 'expired' : 'active';
        const claimsUsed = pc.usageCount || 0;
        const maxClaims = pc.usageLimit || null;
        const remainingClaims = maxClaims !== null ? Math.max(0, maxClaims - claimsUsed) : null;
        const totalRewardsDistributed = (parseFloat(pc.rewardAmount || '0') * claimsUsed).toString();
        return {
          promoCode: pc.code,
          totalClaims: claims.length,
          totalEarnings: totalEarnings.toFixed(4),
          createdAt: pc.createdAt,
          expiresAt: pc.expiresAt,
          rewardAmount: pc.rewardAmount,
          usageLimit: maxClaims,
          usageCount: claimsUsed,
          remainingClaims,
          totalRewardsDistributed,
          status,
          claims: claims.map(c => ({
            id: c.id,
            username: c.claimUserUsername || null,
            firstName: c.claimUserFirstName || null,
            claimedAt: c.createdAt,
            rewardGranted: pc.rewardAmount,
          })),
        };
      });

      // Keep flat history for backward compat
      const history = historyRows.slice(0, 50).map(r => ({
        id: r.id,
        promoCode: r.promoCode,
        commissionUsd: r.commissionUsd,
        createdAt: r.createdAt,
        claimUserUsername: r.claimUserUsername,
      }));

      // Get today/week/month claims from earnings table
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [todayStats] = await db.select({ count: sql<number>`count(*)`, sum: sql<string>`COALESCE(SUM(commission_usd), 0)` })
        .from(ambassadorEarnings).where(and(eq(ambassadorEarnings.ambassadorId, ambassador.id), gte(ambassadorEarnings.createdAt, todayStart)));
      const [weekStats] = await db.select({ count: sql<number>`count(*)`, sum: sql<string>`COALESCE(SUM(commission_usd), 0)` })
        .from(ambassadorEarnings).where(and(eq(ambassadorEarnings.ambassadorId, ambassador.id), gte(ambassadorEarnings.createdAt, weekStart)));
      const [monthStats] = await db.select({ count: sql<number>`count(*)`, sum: sql<string>`COALESCE(SUM(commission_usd), 0)` })
        .from(ambassadorEarnings).where(and(eq(ambassadorEarnings.ambassadorId, ambassador.id), gte(ambassadorEarnings.createdAt, monthStart)));

      // Get active promo codes for this ambassador (prefix-based: code starts with promoCodeName)
      const prefix = (ambassador.promoPrefix || ambassador.promoCodeName).toUpperCase();
      const activePromos = await db.select().from(promoCodes)
        .where(and(
          sql`UPPER(${promoCodes.code}) LIKE ${prefix + '%'}`,
          eq(promoCodes.isActive, true),
          sql`(${promoCodes.expiresAt} IS NULL OR ${promoCodes.expiresAt} > NOW())`
        )).limit(10);

      res.json({
        ambassador,
        stats: {
          todayClaims: Number(todayStats?.count || 0),
          weekClaims: Number(weekStats?.count || 0),
          monthClaims: Number(monthStats?.count || 0),
          lifetimeClaims: ambassador.totalClaims || 0,
          todayEarnings: todayStats?.sum || '0',
          weekEarnings: weekStats?.sum || '0',
          monthEarnings: monthStats?.sum || '0',
          totalEarnings: ambassador.totalEarningsUsd || '0',
        },
        promoHistory: history,
        promoCodeHistory,
        activePromos,
      });
    } catch (error) {
      console.error('Error fetching ambassador dashboard:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard' });
    }
  });

  // Update daily promo schedule
  app.post('/api/ambassador/schedule', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { dailyPromoCount, postingTimes, postingMode, requireChannelJoin } = req.body;

      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Not an ambassador' });

      const updates: any = { updatedAt: new Date() };

      if (Array.isArray(postingTimes)) {
        // Validate: strict HH:MM (00-23 hours, 00-59 minutes), max 3 entries, deduplicated + sorted
        const validTimes = [...new Set(
          postingTimes
            .filter((t: any) => {
              if (typeof t !== 'string') return false;
              const m = t.match(/^(\d{2}):(\d{2})$/);
              if (!m) return false;
              const h = parseInt(m[1], 10);
              const min = parseInt(m[2], 10);
              return h >= 0 && h <= 23 && min >= 0 && min <= 59;
            })
            .slice(0, 3)
        )].sort();
        updates.postingSchedule = JSON.stringify(validTimes);
        updates.dailyPromoCount = Math.max(1, Math.min(3, validTimes.length || 1));

        // Recalculate nextPromoAt from the new schedule so the scheduler fires
        // at the correct time immediately — without this, the old nextPromoAt
        // (set at approval, e.g. 12 h out) would be used and the schedule ignored.
        if (validTimes.length > 0) {
          const now = new Date();
          const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes();
          const timeMins = validTimes.map((t: string) => {
            const parts = t.split(':');
            return parseInt(parts[0]!, 10) * 60 + parseInt(parts[1]!, 10);
          });
          const nextMins = timeMins.find((t: number) => t > nowMins);
          const next = new Date();
          if (nextMins !== undefined) {
            next.setUTCHours(Math.floor(nextMins / 60), nextMins % 60, 0, 0);
          } else {
            // All slots already passed today — wrap to first slot tomorrow
            next.setUTCDate(next.getUTCDate() + 1);
            next.setUTCHours(Math.floor(timeMins[0]! / 60), timeMins[0]! % 60, 0, 0);
          }
          updates.nextPromoAt = next;
        }
      } else if (dailyPromoCount !== undefined) {
        const count = Math.max(1, Math.min(3, parseInt(dailyPromoCount) || 1));
        updates.dailyPromoCount = count;
      }

      // Posting mode (automatic / manual) — when switching to manual, clear nextPromoAt
      if (postingMode === 'automatic' || postingMode === 'manual') {
        updates.postingMode = postingMode;
        if (postingMode === 'manual') {
          updates.nextPromoAt = null; // stop scheduler from auto-posting
        } else if (postingMode === 'automatic' && !updates.nextPromoAt) {
          // Re-enable scheduler: set next time from schedule
          const { getNextScheduledTimeExport } = await import('./telegram');
          updates.nextPromoAt = getNextScheduledTimeExport(ambassador.postingSchedule ?? null);
        }
      }

      // Require channel join for promo code claims
      if (typeof requireChannelJoin === 'boolean') {
        updates.requireChannelJoin = requireChannelJoin;
      }

      await db.update(ambassadors).set(updates).where(eq(ambassadors.id, ambassador.id));

      const schedule = updates.postingSchedule ? JSON.parse(updates.postingSchedule) : null;
      res.json({
        success: true,
        dailyPromoCount: updates.dailyPromoCount ?? ambassador.dailyPromoCount,
        postingSchedule: schedule,
        postingMode: updates.postingMode ?? (ambassador as any).postingMode ?? 'automatic',
        requireChannelJoin: updates.requireChannelJoin ?? (ambassador as any).requireChannelJoin ?? false,
      });
    } catch (error) {
      console.error('Error updating ambassador schedule:', error);
      res.status(500).json({ message: 'Failed to update schedule' });
    }
  });

  // Verify bot is admin with Post Messages permission in ambassador's channel
  // Pre-verify a channel before the user submits an application (no ambassador record required)
  app.post('/api/ambassador/pre-verify-channel', authenticateTelegram, async (req: any, res) => {
    try {
      const { channelLink } = req.body;
      if (!channelLink?.trim()) {
        return res.status(400).json({ success: false, message: 'Channel link is required.' });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.status(500).json({ success: false, message: 'Bot not configured.' });

      const cleanLink = channelLink.trim()
        .replace('https://t.me/', '').replace('http://t.me/', '')
        .replace('t.me/', '').replace(/^@/, '').split('/')[0];
      const channelIdentifier = cleanLink.startsWith('-') ? cleanLink : `@${cleanLink}`;

      const { checkBotCanPostToChannel, getBotUsername } = await import('./telegram');
      const check = await checkBotCanPostToChannel(botToken, channelIdentifier);
      const botName = await getBotUsername();

      if (!check.chatId) {
        return res.json({ success: false, verified: false, message: `Channel not found. Make sure the username is correct and the channel is public. (tried: ${channelIdentifier})` });
      }
      if (!check.isAdmin) {
        return res.json({ success: false, verified: false, message: `@${botName} is not an administrator in this channel. Please add it as administrator with "Post Messages" permission, then verify again.` });
      }
      if (!check.hasPostPermission) {
        return res.json({ success: false, verified: false, message: `@${botName} is an admin but "Post Messages" permission is disabled. Please enable it and verify again.` });
      }

      res.json({ success: true, verified: true, message: `✅ Channel verified! @${botName} can post to this channel.` });
    } catch (error) {
      console.error('Error pre-verifying channel:', error);
      res.status(500).json({ success: false, message: 'Failed to verify channel.' });
    }
  });

  app.post('/api/ambassador/verify-channel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Not an ambassador' });

      // Accept optional channelUsername override, fall back to application
      const [application] = await db.select().from(ambassadorApplications)
        .where(eq(ambassadorApplications.id, ambassador.applicationId || '')).limit(1);
      const rawChannel = req.body.channelUsername || application?.channelUsername || '';
      if (!rawChannel) {
        return res.status(400).json({ success: false, message: 'No channel found for this ambassador.' });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.status(500).json({ success: false, message: 'Bot not configured.' });

      // Normalize to @username or numeric id
      const channelIdentifier = rawChannel.startsWith('-')
        ? rawChannel
        : '@' + rawChannel.replace('https://t.me/', '').replace('http://t.me/', '').replace(/^@/, '').split('/')[0];

      const { checkBotCanPostToChannel } = await import('./telegram');
      const check = await checkBotCanPostToChannel(botToken, channelIdentifier);

      console.log(`🔍 Ambassador verify-channel [${ambassador.id}]:`, {
        channelIdentifier,
        isAdmin: check.isAdmin,
        hasPostPermission: check.hasPostPermission,
        canPost: check.canPost,
        chatId: check.chatId,
        chatType: check.chatType,
        error: check.error,
      });

      if (!check.chatId) {
        return res.json({ success: false, verified: false, message: 'Could not find this channel. Make sure the username is correct and the channel is public.' });
      }

      if (!check.isAdmin) {
        return res.json({
          success: false, verified: false,
          message: `The bot is not an administrator in your channel. Please add @${await (await import('./telegram')).getBotUsername()} as administrator with Post Messages permission.`,
        });
      }

      if (!check.hasPostPermission) {
        return res.json({
          success: false, verified: false,
          message: `⚠️ The bot is an administrator but does not have permission to post messages. Please enable "Post Messages" for @${await (await import('./telegram')).getBotUsername()} and verify again.`,
        });
      }

      // All good — save verified channel ID (numeric, stable across username changes)
      await db.update(ambassadors).set({
        channelVerified: true,
        channelId: check.chatId,
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, ambassador.id));

      console.log(`✅ Ambassador channel verified [${ambassador.id}]: chatId=${check.chatId}`);
      res.json({ success: true, verified: true, message: '✅ Channel verified! The bot can now post to your channel.' });
    } catch (error) {
      console.error('Error verifying channel:', error);
      res.status(500).json({ success: false, message: 'Failed to verify channel.' });
    }
  });

  // Post Now — immediately generate and post a promo (manual mode: 24 h rate limit)
  app.post('/api/ambassador/post-now', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Not an ambassador' });
      if (ambassador.status !== 'active') return res.status(403).json({ message: 'Ambassador account is not active' });

      // Cooldown rate limit for manual mode — uses ambassador_posting_cooldown setting
      const mode = (ambassador as any).postingMode ?? 'automatic';
      if (mode === 'manual') {
        const [cooldownSetting] = await db.select({ v: adminSettings.settingValue })
          .from(adminSettings).where(eq(adminSettings.settingKey, 'ambassador_posting_cooldown')).limit(1);
        const cooldownHours = parseInt(cooldownSetting?.v || '24');
        const cooldownMs = cooldownHours * 60 * 60 * 1000;
        const lastAt: Date | null = (ambassador as any).manualPostLastAt;
        if (lastAt) {
          const msSinceLast = Date.now() - new Date(lastAt).getTime();
          if (msSinceLast < cooldownMs) {
            const msRemaining = cooldownMs - msSinceLast;
            const hLeft = Math.floor(msRemaining / 3600000);
            const mLeft = Math.floor((msRemaining % 3600000) / 60000);
            return res.status(429).json({
              success: false,
              message: `Manual post limit: 1 post per ${cooldownHours} hours. Next post available in ${hLeft}h ${mLeft}m.`,
              nextAvailableAt: new Date(new Date(lastAt).getTime() + cooldownMs).toISOString(),
            });
          }
        }
      }

      const { sendAmbassadorPromo } = await import('./telegram');
      const code = await sendAmbassadorPromo(ambassador.id);
      if (!code) {
        return res.status(500).json({
          success: false,
          message: `The bot failed to post to your channel. Check that @${await (await import('./telegram')).getBotUsername()} is still an administrator with Post Messages permission enabled.`,
        });
      }

      // Record manual post timestamp
      if (mode === 'manual') {
        await db.update(ambassadors)
          .set({ manualPostLastAt: new Date(), updatedAt: new Date() } as any)
          .where(eq(ambassadors.id, ambassador.id));
      }

      res.json({ success: true, code, message: `✅ Promo posted to your channel! Code: ${code}` });
    } catch (error) {
      console.error('Error posting promo now:', error);
      res.status(500).json({ success: false, message: 'Failed to post promo' });
    }
  });

  // Request custom promo code name
  app.post('/api/ambassador/request-promo-name', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promoCodeName } = req.body;

      if (!promoCodeName?.trim()) {
        return res.status(400).json({ success: false, message: 'Promo code name is required' });
      }
      const cleanName = promoCodeName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanName.length < 3 || cleanName.length > 20) {
        return res.status(400).json({ success: false, message: 'Promo code name must be 3-20 alphanumeric characters' });
      }

      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.userId, userId)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Not an ambassador' });

      // Check if name is taken
      const [existing] = await db.select().from(ambassadors)
        .where(sql`UPPER(${ambassadors.promoCodeName}) = ${cleanName}`).limit(1);
      if (existing && existing.id !== ambassador.id) {
        return res.status(400).json({ success: false, message: 'This promo code name is already taken' });
      }

      await db.update(ambassadors).set({
        customPromoRequest: cleanName,
        customPromoRequestStatus: 'pending',
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, ambassador.id));

      // Notify admins
      try {
        const user = await storage.getUser(userId);
        const adminIds = await getAllAdminTelegramIds();
        const { sendTelegramMessage } = await import('./telegram');
        for (const adminId of adminIds) {
          await sendTelegramMessage(
            `🎯 <b>Custom Promo Name Request</b>\n\n` +
            `👤 Ambassador: @${user?.username || user?.firstName || 'N/A'}\n` +
            `📛 Requested Name: <b>${cleanName}</b>\n\n` +
            `Review in Admin Panel → Ambassadors`,
            { parse_mode: 'HTML', chat_id: adminId }
          ).catch(() => {});
        }
      } catch (_) {}

      res.json({ success: true, message: 'Request submitted for admin review' });
    } catch (error) {
      console.error('Error requesting promo name:', error);
      res.status(500).json({ message: 'Failed to submit request' });
    }
  });

  // ── Admin: Ambassador Applications ─────────────────────────────────────────
  app.get('/api/admin/ambassadors/applications', authenticateAdmin, async (req: any, res) => {
    try {
      const applications = await db
        .select({
          id: ambassadorApplications.id,
          userId: ambassadorApplications.userId,
          channelLink: ambassadorApplications.channelLink,
          channelTitle: ambassadorApplications.channelTitle,
          channelUsername: ambassadorApplications.channelUsername,
          subscriberCount: ambassadorApplications.subscriberCount,
          status: ambassadorApplications.status,
          rejectionReason: ambassadorApplications.rejectionReason,
          reviewedAt: ambassadorApplications.reviewedAt,
          createdAt: ambassadorApplications.createdAt,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          telegramId: users.telegram_id,
        })
        .from(ambassadorApplications)
        .innerJoin(users, eq(ambassadorApplications.userId, users.id))
        .orderBy(desc(ambassadorApplications.createdAt));

      res.json({ applications });
    } catch (error) {
      console.error('Error fetching ambassador applications:', error);
      res.status(500).json({ message: 'Failed to fetch applications' });
    }
  });

  // Admin: Approve ambassador application
  app.post('/api/admin/ambassadors/applications/:id/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [application] = await db.select().from(ambassadorApplications)
        .where(eq(ambassadorApplications.id, id)).limit(1);
      if (!application) return res.status(404).json({ message: 'Application not found' });
      if (application.status !== 'pending') {
        return res.status(400).json({ message: 'Application is not pending' });
      }

      // Check if user is already ambassador
      const [existingAmb] = await db.select().from(ambassadors)
        .where(eq(ambassadors.userId, application.userId)).limit(1);
      if (existingAmb) {
        // Just update application status
        await db.update(ambassadorApplications).set({ status: 'approved', reviewedAt: new Date() })
          .where(eq(ambassadorApplications.id, id));
        return res.json({ success: true, message: 'Application approved (already ambassador)' });
      }

      // ── Mandatory channel verification FIRST — never create records before this passes ──
      const approveBot = process.env.TELEGRAM_BOT_TOKEN;
      if (!approveBot) {
        return res.status(503).json({ message: 'Bot token not configured. Cannot verify channel.' });
      }
      const { checkBotCanPostToChannel: checkApprove } = await import('./telegram');
      const rawLink = application.channelUsername || application.channelLink || '';
      const approveChannelId = rawLink.startsWith('-')
        ? rawLink
        : '@' + rawLink
            .replace('https://t.me/', '').replace('http://t.me/', '')
            .replace('t.me/', '').replace(/^@/, '').split('/')[0];

      const approveCheck = await checkApprove(approveBot, approveChannelId);
      if (!approveCheck.chatId) {
        return res.status(400).json({ message: `Channel not found (tried "${approveChannelId}"). Cannot approve until channel is accessible.` });
      }
      if (!approveCheck.canPost) {
        const reason = !approveCheck.isAdmin
          ? `The bot is not an administrator in this channel.`
          : `The bot lacks "Post Messages" permission.`;
        return res.status(400).json({ message: `Cannot approve: ${reason} Ask the user to fix this and re-apply.` });
      }
      console.log(`✅ Channel verified for incoming approval — chatId=${approveCheck.chatId} channel="${approveChannelId}"`);

      // ── Channel verified — now safe to write to DB ────────────────────────────
      const user = await storage.getUser(application.userId);
      const baseName = (user?.username || user?.firstName || 'GemsZ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      let promoCodeName = baseName;
      let suffix = 1;
      while (true) {
        const [taken] = await db.select({ id: ambassadors.id }).from(ambassadors)
          .where(sql`UPPER(${ambassadors.promoCodeName}) = ${promoCodeName}`).limit(1);
        if (!taken) break;
        promoCodeName = `${baseName}${suffix++}`;
      }

      // Create ambassador record with channel already verified
      const firstPromoAt = new Date(Date.now() + 60 * 1000);
      const [ambassador] = await db.insert(ambassadors).values({
        userId: application.userId,
        applicationId: id,
        promoCodeName,
        promoPrefix: promoCodeName,
        status: 'active',
        dailyPromoCount: 1,
        nextPromoAt: firstPromoAt,
        channelVerified: true,
        channelId: approveCheck.chatId,
      }).returning();

      // Update application status
      await db.update(ambassadorApplications).set({ status: 'approved', reviewedAt: new Date() })
        .where(eq(ambassadorApplications.id, id));

      console.log(`✅ Ambassador ${ambassador.id} created with verified channel: ${approveCheck.chatId}`);

      // Notify user
      try {
        if (user?.telegram_id) {
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `<b>Congratulations! You're now a Paid Adz Ambassador!</b>\n\n` +
            `Your promo code prefix: <b>${promoCodeName}</b>\n\n` +
            `Your first promo post will go out shortly. After that, a new post will be published automatically every <b>12 hours</b> (2 posts per day).\n\n` +
            `Every time someone claims your code, they receive <b>2,000 Gems</b> and you earn <b>$0.0001</b>!\n\n` +
            `Open the app to view your Ambassador Dashboard.`,
            { parse_mode: 'HTML', chat_id: user.telegram_id }
          );
        }
      } catch (_) {}

      // Fire first promo post immediately (async — don't block the response)
      setTimeout(async () => {
        try {
          const { sendAmbassadorPromo } = await import('./telegram');
          await sendAmbassadorPromo(ambassador.id);
        } catch (err) {
          console.error('First promo post error for new ambassador:', err);
        }
      }, 5_000);

      res.json({ success: true, ambassador });
    } catch (error) {
      console.error('Error approving ambassador application:', error);
      res.status(500).json({ message: 'Failed to approve application' });
    }
  });

  // Admin: Reject ambassador application
  app.post('/api/admin/ambassadors/applications/:id/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const [application] = await db.select().from(ambassadorApplications)
        .where(eq(ambassadorApplications.id, id)).limit(1);
      if (!application) return res.status(404).json({ message: 'Application not found' });

      await db.update(ambassadorApplications).set({
        status: 'rejected',
        rejectionReason: reason || null,
        reviewedAt: new Date(),
      }).where(eq(ambassadorApplications.id, id));

      // Notify user
      try {
        const user = await storage.getUser(application.userId);
        if (user?.telegram_id) {
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `📋 <b>Ambassador Application Update</b>\n\n` +
            `Unfortunately, your application was not approved at this time.\n` +
            `${reason ? `Reason: ${reason}\n` : ''}` +
            `\nYou can reapply in the future.`,
            { parse_mode: 'HTML', chat_id: user.telegram_id }
          );
        }
      } catch (_) {}

      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting ambassador application:', error);
      res.status(500).json({ message: 'Failed to reject application' });
    }
  });

  // Admin: Get all ambassadors
  app.get('/api/admin/ambassadors', authenticateAdmin, async (req: any, res) => {
    try {
      const allAmbassadors = await db
        .select({
          id: ambassadors.id,
          userId: ambassadors.userId,
          promoCodeName: ambassadors.promoCodeName,
          customPromoRequest: ambassadors.customPromoRequest,
          customPromoRequestStatus: ambassadors.customPromoRequestStatus,
          dailyPromoCount: ambassadors.dailyPromoCount,
          totalClaims: ambassadors.totalClaims,
          totalEarningsUsd: ambassadors.totalEarningsUsd,
          status: ambassadors.status,
          channelId: ambassadors.channelId,
          channelVerified: ambassadors.channelVerified,
          lastPromoSentAt: ambassadors.lastPromoSentAt,
          createdAt: ambassadors.createdAt,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          telegramId: users.telegram_id,
        })
        .from(ambassadors)
        .innerJoin(users, eq(ambassadors.userId, users.id))
        .orderBy(desc(ambassadors.createdAt));

      res.json({ ambassadors: allAmbassadors });
    } catch (error) {
      console.error('Error fetching ambassadors:', error);
      res.status(500).json({ message: 'Failed to fetch ambassadors' });
    }
  });

  // Admin: Approve custom promo name request
  app.post('/api/admin/ambassadors/:id/approve-promo-name', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.id, id)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Ambassador not found' });
      if (!ambassador.customPromoRequest) return res.status(400).json({ message: 'No pending request' });

      const newName = ambassador.customPromoRequest;
      // Check uniqueness
      const [taken] = await db.select({ id: ambassadors.id }).from(ambassadors)
        .where(and(sql`UPPER(${ambassadors.promoCodeName}) = ${newName}`, sql`${ambassadors.id} != ${id}`)).limit(1);
      if (taken) return res.status(400).json({ message: 'Name already taken' });

      await db.update(ambassadors).set({
        promoCodeName: newName,
        promoPrefix: newName,   // keep promoPrefix in sync so COALESCE picks the new name
        customPromoRequest: null,
        customPromoRequestStatus: 'approved',
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, id));

      // Notify user
      try {
        const user = await storage.getUser(ambassador.userId);
        if (user?.telegram_id) {
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `✅ <b>Custom Promo Name Approved!</b>\n\nYour new promo code name is: <b>${newName}</b>`,
            { parse_mode: 'HTML', chat_id: user.telegram_id }
          );
        }
      } catch (_) {}

      res.json({ success: true });
    } catch (error) {
      console.error('Error approving promo name:', error);
      res.status(500).json({ message: 'Failed to approve' });
    }
  });

  // Admin: Reject custom promo name request
  app.post('/api/admin/ambassadors/:id/reject-promo-name', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.id, id)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Ambassador not found' });

      await db.update(ambassadors).set({
        customPromoRequest: null,
        customPromoRequestStatus: 'rejected',
        updatedAt: new Date(),
      }).where(eq(ambassadors.id, id));

      // Notify user
      try {
        const user = await storage.getUser(ambassador.userId);
        if (user?.telegram_id) {
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `❌ <b>Custom Promo Name Rejected</b>\n\nYour request was not approved. Your current promo code name remains: <b>${ambassador.promoCodeName}</b>`,
            { parse_mode: 'HTML', chat_id: user.telegram_id }
          );
        }
      } catch (_) {}

      res.json({ success: true });
    } catch (error) {
      console.error('Error rejecting promo name:', error);
      res.status(500).json({ message: 'Failed to reject' });
    }
  });

  // Admin: Post promo NOW to an ambassador's channel (manual trigger)
  app.post('/api/admin/ambassadors/:id/post-now', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [ambassador] = await db.select().from(ambassadors).where(eq(ambassadors.id, id)).limit(1);
      if (!ambassador) return res.status(404).json({ message: 'Ambassador not found' });
      if (ambassador.status !== 'active') return res.status(400).json({ success: false, message: 'Ambassador is not active' });
      if (!ambassador.channelId) return res.status(400).json({ success: false, message: 'No verified channel — ambassador must verify their channel first' });

      const { sendAmbassadorPromo } = await import('./telegram');
      const code = await sendAmbassadorPromo(ambassador.id);
      if (!code) {
        return res.status(500).json({
          success: false,
          message: 'Failed to post to the ambassador\'s channel. The bot may lack Post Messages permission, or the stored channel ID is stale. Check server logs for the exact Telegram API error.',
        });
      }

      res.json({ success: true, code, message: `✅ Promo posted to channel! Code: ${code}` });
    } catch (error) {
      console.error('Admin post-now error:', error);
      res.status(500).json({ success: false, message: 'Internal error posting promo' });
    }
  });

  // Admin: Bulk re-verify all active ambassador channels via bot API
  app.post('/api/admin/ambassadors/reverify-all', authenticateAdmin, async (req: any, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.status(500).json({ success: false, message: 'Bot token not configured.' });

      const { checkBotCanPostToChannel } = await import('./telegram');
      const allAmbs = await db.select().from(ambassadors).where(eq(ambassadors.status, 'active'));

      const results: { id: string; channelId: string | null; verified: boolean; error?: string }[] = [];

      for (const amb of allAmbs) {
        if (!amb.channelId) {
          results.push({ id: amb.id, channelId: null, verified: false, error: 'No channel ID stored' });
          continue;
        }
        try {
          const check = await checkBotCanPostToChannel(botToken, amb.channelId);
          const verified = check.canPost === true;
          await db.update(ambassadors).set({ channelVerified: verified, updatedAt: new Date() })
            .where(eq(ambassadors.id, amb.id));
          results.push({ id: amb.id, channelId: amb.channelId, verified, error: check.error });
        } catch (err: any) {
          results.push({ id: amb.id, channelId: amb.channelId, verified: false, error: err?.message });
        }
      }

      const verifiedCount = results.filter(r => r.verified).length;
      res.json({ success: true, total: allAmbs.length, verified: verifiedCount, results });
    } catch (error) {
      console.error('Bulk reverify error:', error);
      res.status(500).json({ success: false, message: 'Internal error during bulk reverification.' });
    }
  });

  // Admin: Suspend/Unsuspend ambassador
  app.post('/api/admin/ambassadors/:id/suspend', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { suspend } = req.body;
      const newStatus = suspend ? 'suspended' : 'active';
      await db.update(ambassadors).set({ status: newStatus, updatedAt: new Date() })
        .where(eq(ambassadors.id, id));
      res.json({ success: true, status: newStatus });
    } catch (error) {
      console.error('Error suspending ambassador:', error);
      res.status(500).json({ message: 'Failed to update ambassador status' });
    }
  });

  // Admin: Permanently delete an ambassador
  // Removes the ambassador profile and settings while leaving the user's normal account intact.
  // After deletion the user can submit a brand-new application.
  app.delete('/api/admin/ambassadors/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;

      const [amb] = await db.select().from(ambassadors).where(eq(ambassadors.id, id)).limit(1);
      if (!amb) return res.status(404).json({ success: false, message: 'Ambassador not found' });

      // Delete ambassador earnings first (FK dependency)
      await db.delete(ambassadorEarnings).where(eq(ambassadorEarnings.ambassadorId, id));

      // Delete ambassador record
      await db.delete(ambassadors).where(eq(ambassadors.id, id));

      // Reset linked application so the user can re-apply with a clean slate
      if (amb.applicationId) {
        await db.update(ambassadorApplications)
          .set({ status: 'rejected', rejectionReason: 'Profile deleted by admin', reviewedAt: new Date() })
          .where(eq(ambassadorApplications.id, amb.applicationId));
      }
      // Also clear any other non-pending applications for this user so status page is clean
      await db.update(ambassadorApplications)
        .set({ status: 'rejected', rejectionReason: 'Profile deleted by admin', reviewedAt: new Date() })
        .where(and(eq(ambassadorApplications.userId, amb.userId), sql`${ambassadorApplications.status} != 'pending'`));

      console.log(`🗑️ Ambassador ${id} (userId: ${amb.userId}) permanently deleted by admin`);
      res.json({ success: true, message: 'Ambassador deleted. The user can re-apply.' });
    } catch (error) {
      console.error('Error deleting ambassador:', error);
      res.status(500).json({ success: false, message: 'Failed to delete ambassador' });
    }
  });

  // Admin: Get ambassador program settings
  app.get('/api/admin/ambassadors/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const defaults: Record<string, string> = {
        ambassador_program_enabled:    'true',
        ambassador_commission_usd:     '0.0001',
        ambassador_promo_reward:       '10000',
        ambassador_max_claims:         '100',
        ambassador_posting_cooldown:   '24',
        ambassador_auto_posting:       'true',
        ambassador_daily_limit:        '2',
        ambassador_promo_expiry_hours: '24',
      };
      const rows = await db.select({ k: adminSettings.settingKey, v: adminSettings.settingValue })
        .from(adminSettings)
        .where(sql`${adminSettings.settingKey} IN (${sql.join(Object.keys(defaults).map(k => sql`${k}`), sql`, `)})`);
      const settings: Record<string, string> = { ...defaults };
      for (const row of rows) settings[row.k] = row.v;
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  // Admin: Update ambassador program settings
  app.post('/api/admin/ambassadors/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const {
        ambassadorProgramEnabled,
        ambassadorCommissionUsd,
        ambassadorPromoReward,
        ambassadorMaxClaims,
        ambassadorPostingCooldown,
        ambassadorAutoPosting,
        ambassadorDailyLimit,
        ambassadorPromoExpiryHours,
      } = req.body;

      const updates: Record<string, string> = {};
      if (ambassadorProgramEnabled  !== undefined) updates['ambassador_program_enabled']    = ambassadorProgramEnabled  ? 'true' : 'false';
      if (ambassadorCommissionUsd   !== undefined) updates['ambassador_commission_usd']     = String(parseFloat(ambassadorCommissionUsd)   || 0.0001);
      if (ambassadorPromoReward     !== undefined) updates['ambassador_promo_reward']        = String(parseInt(ambassadorPromoReward)       || 10000);
      if (ambassadorMaxClaims       !== undefined) updates['ambassador_max_claims']          = String(parseInt(ambassadorMaxClaims)         || 100);
      if (ambassadorPostingCooldown !== undefined) updates['ambassador_posting_cooldown']   = String(parseInt(ambassadorPostingCooldown)   || 24);
      if (ambassadorAutoPosting     !== undefined) updates['ambassador_auto_posting']        = ambassadorAutoPosting     ? 'true' : 'false';
      if (ambassadorDailyLimit      !== undefined) updates['ambassador_daily_limit']         = String(parseInt(ambassadorDailyLimit)        || 2);
      if (ambassadorPromoExpiryHours !== undefined) updates['ambassador_promo_expiry_hours'] = String(parseInt(ambassadorPromoExpiryHours) || 24);

      for (const [key, value] of Object.entries(updates)) {
        await db.insert(adminSettings)
          .values({ settingKey: key, settingValue: value, description: 'Ambassador setting' })
          .onConflictDoUpdate({ target: adminSettings.settingKey, set: { settingValue: value, updatedAt: new Date() } });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update settings' });
    }
  });

  // Public ambassador directory — shows all active ambassadors
  app.get('/api/ambassadors/directory', async (req: any, res) => {
    try {
      const programEnabled = await storage.getAppSetting('ambassador_program_enabled', 'true');
      if (programEnabled === 'false') {
        return res.json({ success: true, ambassadors: [] });
      }

      const activeAmbassadors = await db
        .select({
          id: ambassadors.id,
          promoCodeName: ambassadors.promoCodeName,
          channelId: ambassadors.channelId,
          channelTitle: ambassadorApplications.channelTitle,
          channelUsername: ambassadorApplications.channelUsername,
          subscriberCount: ambassadorApplications.subscriberCount,
          totalClaims: ambassadors.totalClaims,
          createdAt: ambassadors.createdAt,
        })
        .from(ambassadors)
        .leftJoin(ambassadorApplications, eq(ambassadors.applicationId, ambassadorApplications.id))
        .where(eq(ambassadors.status, 'active'))
        .orderBy(desc(ambassadors.totalClaims));

      res.json({
        success: true,
        ambassadors: activeAmbassadors.map(a => ({
          ...a,
          channelLink: a.channelUsername ? `https://t.me/${a.channelUsername}` : null,
        }))
      });
    } catch (error) {
      console.error('Error fetching ambassador directory:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch ambassadors' });
    }
  });

  // Admin: View ambassador earning stats with full claim history
  app.get('/api/admin/ambassadors/:id/stats', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const claimUser = alias(users, 'claimUser');

      const [history, totals] = await Promise.all([
        db
          .select({
            id: ambassadorEarnings.id,
            promoCode: ambassadorEarnings.promoCode,
            commissionUsd: ambassadorEarnings.commissionUsd,
            claimUserId: ambassadorEarnings.claimUserId,
            claimedAt: ambassadorEarnings.createdAt,
            // User who claimed
            claimUserName: claimUser.firstName,
            claimUserUsername: claimUser.username,
            claimUserCode: claimUser.referralCode,
            // Reward the user received
            userRewardAmount: promoCodeUsage.rewardAmount,
          })
          .from(ambassadorEarnings)
          .leftJoin(claimUser, eq(ambassadorEarnings.claimUserId, claimUser.id))
          .leftJoin(
            promoCodeUsage,
            and(
              eq(promoCodeUsage.promoCodeId, ambassadorEarnings.promoCodeId),
              eq(promoCodeUsage.userId, ambassadorEarnings.claimUserId),
            ),
          )
          .where(eq(ambassadorEarnings.ambassadorId, id))
          .orderBy(desc(ambassadorEarnings.createdAt))
          .limit(200),

        db
          .select({
            totalClaims: sql<number>`count(*)`,
            totalEarningsUsd: sql<string>`COALESCE(SUM(${ambassadorEarnings.commissionUsd}), 0)`,
            totalRewardGiven: sql<string>`COALESCE(SUM(${promoCodeUsage.rewardAmount}), 0)`,
          })
          .from(ambassadorEarnings)
          .leftJoin(
            promoCodeUsage,
            and(
              eq(promoCodeUsage.promoCodeId, ambassadorEarnings.promoCodeId),
              eq(promoCodeUsage.userId, ambassadorEarnings.claimUserId),
            ),
          )
          .where(eq(ambassadorEarnings.ambassadorId, id)),
      ]);

      res.json({ history, totals: totals[0] });
    } catch (error) {
      console.error('❌ Error fetching ambassador stats:', error);
      res.status(500).json({ message: 'Failed to fetch stats' });
    }
  });

  // Helper: generate + send daily promo code for an ambassador
  async function generateAmbassadorPromoCode(ambassadorId: string, promoCodeName: string): Promise<void> {
    try {
      // Load all ambassador settings dynamically from DB
      const settingKeys = ['ambassador_promo_reward', 'ambassador_max_claims', 'ambassador_promo_expiry_hours', 'ambassador_commission_usd'];
      const settingRows = await db.select({ k: adminSettings.settingKey, v: adminSettings.settingValue })
        .from(adminSettings)
        .where(sql`${adminSettings.settingKey} IN (${sql.join(settingKeys.map(k => sql`${k}`), sql`, `)})`);
      const getSetting = (key: string, def: string) => settingRows.find(r => r.k === key)?.v ?? def;

      const rewardAmount = getSetting('ambassador_promo_reward', '10000');
      const maxClaims = parseInt(getSetting('ambassador_max_claims', '100'));
      const expiryHours = parseInt(getSetting('ambassador_promo_expiry_hours', '24'));
      const commissionUsd = getSetting('ambassador_commission_usd', '0.0001');

      const codeUpper = promoCodeName.toUpperCase();
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

      // Upsert the promo code for today
      const existing = await db.select().from(promoCodes)
        .where(eq(promoCodes.code, codeUpper)).limit(1);

      if (existing.length > 0) {
        await db.update(promoCodes).set({
          usageCount: 0,
          usageLimit: maxClaims,
          perUserLimit: 1,
          isActive: true,
          expiresAt,
          rewardAmount,
          rewardType: 'Gems',
          updatedAt: new Date(),
        }).where(eq(promoCodes.code, codeUpper));
      } else {
        await db.insert(promoCodes).values({
          code: codeUpper,
          rewardAmount,
          rewardType: 'Gems',
          usageLimit: maxClaims,
          perUserLimit: 1,
          isActive: true,
          expiresAt,
        });
      }

      // Update last promo sent time
      await db.update(ambassadors).set({ lastPromoSentAt: new Date(), updatedAt: new Date() })
        .where(eq(ambassadors.id, ambassadorId));

      // Send promo to ambassador via Telegram
      const [ambassador] = await db.select({ userId: ambassadors.userId })
        .from(ambassadors).where(eq(ambassadors.id, ambassadorId)).limit(1);
      if (ambassador) {
        const user = await storage.getUser(ambassador.userId);
        if (user?.telegram_id) {
          const rewardPow = parseInt(rewardAmount).toLocaleString('en-US');
          const usdValue = (parseInt(rewardAmount) / 100000).toFixed(2);
          const { sendTelegramMessage } = await import('./telegram');
          await sendTelegramMessage(
            `🎯 <b>Your Daily Promo Code is Ready!</b>\n\n` +
            `📛 Code: <code>${codeUpper}</code>\n` +
            `🎁 Reward: <b>${rewardPow} Gems | $${usdValue}</b>\n` +
            `👥 Max Claims: <b>${maxClaims}</b>\n` +
            `⏰ Valid for ${expiryHours} hours\n\n` +
            `Share this code with your followers!\n` +
            `You earn <b>$${commissionUsd}</b> for every successful claim.\n\n` +
            `Post it in your channel now! 🚀`,
            { parse_mode: 'HTML', chat_id: user.telegram_id }
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Failed to generate promo for ambassador ${ambassadorId}:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANTI-FRAUD REFERRAL NETWORK — Admin API
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const {
      buildReferralTree,
      detectFraudClusters,
      analyzeNetwork,
      banUserFully,
      markUnderReview,
      banWithScope,
      freezeUserRewards,
      unfreezeUserRewards,
      removeReferralEarnings,
      restoreAccount,
      getReviewQueue,
      getModerationLogs,
    } = await import('./referralNetwork');

    // GET /api/admin/fraud/referral-tree/:userId
    app.get('/api/admin/fraud/referral-tree/:userId', authenticateAdmin, async (req: any, res) => {
      try {
        const { userId } = req.params;
        const tree = await buildReferralTree(userId);
        if (!tree) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, tree });
      } catch (err: any) {
        console.error('referral-tree error:', err);
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // GET /api/admin/fraud/clusters/:userId
    app.get('/api/admin/fraud/clusters/:userId', authenticateAdmin, async (req: any, res) => {
      try {
        const { userId } = req.params;
        const clusters = await detectFraudClusters(userId);
        res.json({ success: true, clusters });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // GET /api/admin/fraud/network/:userId  — full analysis (tree + clusters)
    app.get('/api/admin/fraud/network/:userId', authenticateAdmin, async (req: any, res) => {
      try {
        const { userId } = req.params;
        const analysis = await analyzeNetwork(userId);
        res.json({ success: true, ...analysis });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // GET /api/admin/fraud/review-queue
    app.get('/api/admin/fraud/review-queue', authenticateAdmin, async (req: any, res) => {
      try {
        const queue = await getReviewQueue();
        res.json({ success: true, queue });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // GET /api/admin/fraud/moderation-logs
    app.get('/api/admin/fraud/moderation-logs', authenticateAdmin, async (req: any, res) => {
      try {
        const limit = parseInt(String(req.query.limit ?? '100'));
        const targetUserId = req.query.userId as string | undefined;
        const logs = await getModerationLogs(limit, targetUserId);
        res.json({ success: true, logs });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    // POST /api/admin/fraud/action
    // body: { userId, action, scope?, reason }
    // action: ban_user | ban_direct | ban_network | freeze | unfreeze | remove_earnings | restore | mark_review
    app.post('/api/admin/fraud/action', authenticateAdmin, async (req: any, res) => {
      try {
        const admin = req.user;
        const adminId = admin?.telegram_id || admin?.id || 'unknown';
        const adminName = admin?.username || admin?.firstName || 'Admin';
        const { userId, action, scope, reason } = req.body;

        if (!userId || !action || !reason) {
          return res.status(400).json({ success: false, message: 'userId, action, and reason are required' });
        }

        let result: any;

        switch (action) {
          case 'ban_user':
            result = await banUserFully(userId, reason, adminId, adminName);
            break;
          case 'ban_direct':
            result = await banWithScope(userId, 'direct', reason, adminId, adminName);
            break;
          case 'ban_network':
            result = await banWithScope(userId, 'network', reason, adminId, adminName);
            break;
          case 'freeze':
            result = await freezeUserRewards(userId, reason, adminId, adminName);
            break;
          case 'unfreeze':
            result = await unfreezeUserRewards(userId, reason, adminId, adminName);
            break;
          case 'remove_earnings':
            result = await removeReferralEarnings(userId, reason, adminId, adminName);
            break;
          case 'restore':
            result = await restoreAccount(userId, reason, adminId, adminName);
            break;
          case 'mark_review':
            result = await markUnderReview(userId, reason, adminId, adminName);
            break;
          default:
            return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
        }

        res.json(result);
      } catch (err: any) {
        console.error('fraud/action error:', err);
        res.status(500).json({ success: false, message: err.message });
      }
    });
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // END ANTI-FRAUD REFERRAL NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Admin: Reset weekly stars ─────────────────────────────────────────────────
  app.post('/api/admin/reset-stars', authenticateAdmin, async (req: any, res) => {
    try {
      const fixedRewards = [
        [500000, 250000, 100000, 50000, 50000, 1000, 1000, 1000, 1000, 1000],
      ];
      const winners = await db.execute(sql`
        SELECT id FROM users
        WHERE weekly_stars > 0 AND banned = false
        ORDER BY weekly_stars DESC, id ASC
        LIMIT 10
      `);
      for (const [index, row] of (winners.rows as any[]).entries()) {
        const gold = fixedRewards[index] || 0;
        await db.execute(sql`
          UPDATE users
          SET balance = COALESCE(balance, 0) + ${gold},
              updated_at = NOW()
          WHERE id = ${row.id}
        `);
      }
      await db.execute(sql`UPDATE users SET weekly_stars = 0, updated_at = NOW()`);
      res.json({ success: true, message: 'Leaderboard rewards distributed and weekly stars reset to 0' });
    } catch (error) {
      console.error('Error resetting stars:', error);
      res.status(500).json({ message: 'Failed to reset stars' });
    }
  });

  // ── Twice-daily ad counter reset scheduler ───────────────────────────────────
  // Resets ads_watched_today, monetag_ads_watched_today, gigapub_ads_watched_today
  // for ALL users at 12:00 AM IST (18:30 UTC) and 12:00 PM IST (06:30 UTC).
  // Per-request reset logic above handles edge cases; this is the authoritative bulk reset.
  (function scheduleAdReset() {
    function nextResetTime(): Date {
      const now = new Date();
      // Candidate times today (UTC)
      const candidates = [
        new Date(now.getFullYear(), now.getMonth(), now.getDate()), // placeholder, set below
        new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      ];
      candidates[0].setUTCHours(6, 30, 0, 0);
      candidates[1].setUTCHours(18, 30, 0, 0);
      const future = candidates.filter(d => d.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime());
      if (future.length > 0) return future[0];
      // Both already passed today — schedule for 06:30 UTC tomorrow
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(6, 30, 0, 0);
      return tomorrow;
    }

    async function runReset() {
      try {
        await db.execute(sql`
          UPDATE users SET
            ads_watched_today         = 0,
            monetag_ads_watched_today = 0,
            gigapub_ads_watched_today = 0,
            uslads_ads_watched_today  = 0,
            updated_at                = NOW()
        `);
        console.log(`✅ [Ad Reset] Twice-daily ad counters reset at ${new Date().toISOString()} (12AM/12PM IST)`);
      } catch (err) {
        console.error('❌ [Ad Reset] Failed to reset ad counters:', err);
      }
      // Schedule the next one
      const next = nextResetTime();
      const delay = next.getTime() - Date.now();
      console.log(`⏰ [Ad Reset] Next reset scheduled at ${next.toISOString()} (in ${Math.round(delay / 60000)}m)`);
      setTimeout(runReset, delay);
    }

    const first = nextResetTime();
    const delay = first.getTime() - Date.now();
    console.log(`⏰ [Ad Reset] Twice-daily reset scheduler started. First reset at ${first.toISOString()} (in ${Math.round(delay / 60000)}m)`);
    setTimeout(runReset, delay);
  })();

  return httpServer;
}
