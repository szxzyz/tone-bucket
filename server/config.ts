// Application configuration
// ALL system-related values are read from environment variables — nothing is
// hardcoded in the application code. See .env.example for the full key list.

export const config = {
  // Telegram channel settings - use numeric ID for more reliable verification
  telegram: {
    // Channel settings (environment variables required)
    channelId: process.env.TELEGRAM_CHANNEL_ID || '',
    channelUrl: process.env.TELEGRAM_CHANNEL_LINK || process.env.TELEGRAM_CHANNEL_URL || '',
    channelName: process.env.TELEGRAM_CHANNEL_NAME || '',
    // Group settings (environment variables required)
    groupId: process.env.TELEGRAM_GROUP_ID || '',
    groupUrl: process.env.TELEGRAM_GROUP_LINK || process.env.TELEGRAM_GROUP_URL || '',
    groupName: process.env.TELEGRAM_GROUP_NAME || '',
    // Development/update channel settings used by bot notifications.
    devChannelId: process.env.TELEGRAM_DEV_CHANNEL_ID || '',
    devChannelUrl: process.env.TELEGRAM_DEV_CHANNEL_URL || '',
    devChannelName: process.env.TELEGRAM_DEV_CHANNEL_NAME || '',
    payoutChannelId: process.env.TELEGRAM_PAYOUT_CHANNEL_ID || '',
    payoutChannelUrl: process.env.TELEGRAM_PAYOUT_CHANNEL_LINK || process.env.TELEGRAM_PAYOUT_CHANNEL_URL || '',
    payoutChannelName: process.env.TELEGRAM_PAYOUT_CHANNEL_NAME || '',
  },
  
  // Bot configuration
  bot: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminId: process.env.TELEGRAM_ADMIN_ID || '',
    // BOT_USERNAME (alias TELEGRAM_BOT_USERNAME is also accepted)
    username: process.env.BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || '',
    // Bot numeric id (env: TELEGRAM_BOT_ID / BOT_ID)
    botId: process.env.TELEGRAM_BOT_ID || process.env.BOT_ID || '',
    botUrl: process.env.TELEGRAM_BOT_URL || '',
    appUrl: process.env.TELEGRAM_APP_URL || '',
    webAppName: process.env.TELEGRAM_WEBAPP_NAME || '',
    updateUrl: process.env.TELEGRAM_UPDATE_URL || process.env.TELEGRAM_CHANNEL_LINK || '',
    discussUrl: process.env.TELEGRAM_DISCUSS_URL || process.env.TELEGRAM_GROUP_LINK || '',
  },



  // ─── SUPPORT ──────────────────────────────────────────────────────────
  // Support bot link used by app buttons and banned/rejected users (env: SUPPORT_BOT_LINK)
  // e.g. https://t.me/YourSupportBot
  support: {
    link: process.env.SUPPORT_BOT_LINK || '',
  },

  // Public receipt/proof destination (env: PROOF_OF_PAYMENT_URL)
  paymentProof: {
    link: process.env.PROOF_OF_PAYMENT_URL || '',
  },

  // ─── WITHDRAWALS ──────────────────────────────────────────────────────
  // Withdrawal notification group chat (env: WITHDRAWAL_GROUP_CHAT_ID)
  // Must be the numeric supergroup/chat id, e.g. -1001234567890 (starts with -)
  withdrawals: {
    groupChatId: process.env.WITHDRAWAL_GROUP_CHAT_ID || '',
    groupLink: process.env.WITHDRAWAL_GROUP_LINK || '',
  },

  // ─── AD SDK CONFIGURATION (all env-based) ─────────────────────────────
  // Every AdsGram block id, Monetag zone id, GigaPub script id and USL/Tower
  // Ads setting is injected from environment variables. Nothing is hardcoded.
  ads: {
    // AdsGram — popup ad shown once at first app open (env: ADSGRAM_POPUP_BLOCK_ID)
    popupBlockId: process.env.ADSGRAM_POPUP_BLOCK_ID || process.env.VITE_ADSGRAM_POPUP_BLOCK_ID || '',
    // AdsGram — reward ad used in the Ad Watch section (env: ADSGRAM_REWARD_BLOCK_ID)
    rewardBlockId: process.env.ADSGRAM_REWARD_BLOCK_ID || '',
    // AdsGram — hamburger menu / extra reward ad (env: ADSGRAM_HAMBURGER_BLOCK_ID)
    hamburgerBlockId: process.env.ADSGRAM_HAMBURGER_BLOCK_ID || '',
    // AdsGram — promo code claim ad (env: ADSGRAM_PROMO_BLOCK_ID)
    promoBlockId: process.env.ADSGRAM_PROMO_BLOCK_ID || '',
    // AdsGram — daily check-in ad (env: ADSGRAM_CHECKIN_BLOCK_ID)
    checkinBlockId: process.env.ADSGRAM_CHECKIN_BLOCK_ID || process.env.VITE_ADSGRAM_CHECKIN_BLOCK_ID || '',
    // AdsGram — mystery box ad (env: ADSGRAM_MYSTERY_BLOCK_ID)
    mysteryBoxBlockId: process.env.ADSGRAM_MYSTERY_BLOCK_ID || '',

    // Monetag rewarded interstitial (env: MONETAG_ZONE_ID)
    // The id is also injected into index.html at build time via VITE_MONETAG_ZONE_ID.
    monetagZoneId: process.env.VITE_MONETAG_ZONE_ID || process.env.MONETAG_ZONE_ID || '11670091',

    // GigaPub ad network script id (env: GIGAPUB_SCRIPT_ID)
    gigapubScriptId: process.env.VITE_GIGAPUB_SCRIPT_ID || process.env.GIGAPUB_SCRIPT_ID || '5883',

    // USL Ads / TowerAds SDK URL (env: USLADS_SDK_URL; default kept for convenience)
    uslAdsSdkUrl: process.env.USLADS_SDK_URL || 'https://uslads.com/sdk/tower-ads-v4.js',

    // USL Ads / TowerAds SDK credentials (env: VITE_USL_ADS_API_KEY / VITE_USL_ADS_PLACEMENT_ID)
    uslAdsApiKey: process.env.VITE_USL_ADS_API_KEY || process.env.USL_ADS_API_KEY || '',
    uslAdsPlacementId: process.env.VITE_USL_ADS_PLACEMENT_ID || process.env.USL_ADS_PLACEMENT_ID || 'plc_992db36dbed33f7c',

  },
};

// Helper function to get channel config for API responses
export function getChannelConfig() {
  return {
    channelId: config.telegram.channelId,
    channelUrl: config.telegram.channelUrl,
    channelName: config.telegram.channelName,
    groupId: config.telegram.groupId,
    groupUrl: config.telegram.groupUrl,
    groupName: config.telegram.groupName,
    devChannelId: config.telegram.devChannelId,
    devChannelUrl: config.telegram.devChannelUrl,
    devChannelName: config.telegram.devChannelName,
    payoutChannelId: config.telegram.payoutChannelId,
    payoutChannelUrl: config.telegram.payoutChannelUrl,
    payoutChannelName: config.telegram.payoutChannelName,
    botUsername: config.bot.username,
    botUrl: config.bot.botUrl,
    updateUrl: config.bot.updateUrl,
    discussUrl: config.bot.discussUrl,
    appUrl: config.bot.appUrl,
  };
}

// Full system configuration for the frontend (public, no secrets).
// Exposed via GET /api/config/app.
export function getAppConfig() {
  return {
    ...getChannelConfig(),
    supportLink: config.support.link,
    proofOfPaymentLink: config.paymentProof.link,
    withdrawalGroupChatId: config.withdrawals.groupChatId,
    withdrawalGroupLink: config.withdrawals.groupLink,
    adsgramPopupBlockId: config.ads.popupBlockId,
    adsgramRewardBlockId: config.ads.rewardBlockId,
    adsgramHamburgerBlockId: config.ads.hamburgerBlockId,
    adsgramPromoBlockId: config.ads.promoBlockId,
    adsgramCheckinBlockId: config.ads.checkinBlockId,
    adsgramMysteryBoxBlockId: config.ads.mysteryBoxBlockId,
    monetagZoneId: config.ads.monetagZoneId,
    gigapubScriptId: config.ads.gigapubScriptId,
    uslAdsSdkUrl: config.ads.uslAdsSdkUrl,
    uslAdsApiKey: config.ads.uslAdsApiKey,
    uslAdsPlacementId: config.ads.uslAdsPlacementId,
  };
}
