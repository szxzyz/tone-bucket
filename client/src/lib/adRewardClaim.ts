import { apiRequest } from "@/lib/queryClient";

// The backend waits up to 8 seconds for the provider callback. A few short
// retries cover delivery jitter, but do not leave the Watch button spinning
// for half a minute when Monetag does not send a postback.
const POSTBACK_RETRY_COUNT = 4;
const POSTBACK_RETRY_DELAY_MS = 1_000;

/**
 * Retry only the retryable S2S-pending response. The ad session remains
 * pending server-side, so a later provider callback can confirm the same claim.
 */
export async function postWithAdVerification<T = any>(path: string, payload: unknown): Promise<T> {
  for (let attempt = 0; attempt < POSTBACK_RETRY_COUNT; attempt += 1) {
    const response = await apiRequest("POST", path, payload);
    const data = await response.json().catch(() => ({}));

    if (response.status === 202 && data?.pending === true && data?.errorType === "provider_verification_pending") {
      if (attempt + 1 < POSTBACK_RETRY_COUNT) {
        await new Promise((resolve) => window.setTimeout(resolve, POSTBACK_RETRY_DELAY_MS));
        continue;
      }
      throw new Error("Ad confirmation is taking longer than usual. Please try again shortly.");
    }

    if (!response.ok || data?.success === false) {
      const error: any = new Error(data?.message || data?.error || "Failed to claim ad reward");
      error.errorType = data?.errorType;
      error.channelLink = data?.channelLink;
      error.channelName = data?.channelName;
      throw error;
    }
    return data as T;
  }

  throw new Error("Ad confirmation is taking longer than usual. Please try again shortly.");
}

/** Record completion reported by a GigaPub, USL/TowerAds, or promo AdsGram SDK. */
export async function confirmProviderCompletion(sessionId: string, provider: "gigapub" | "uslads" | "adsgram"): Promise<void> {
  const response = await apiRequest("POST", "/api/ads/provider-complete", { sessionId, provider });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success !== true) {
    throw new Error(data?.message || "Ad completion could not be verified");
  }
}

/** Best-effort cleanup for an ad SDK failure before any provider completion. */
export async function cancelRegisteredAdSession(sessionId: string): Promise<void> {
  try {
    await apiRequest("POST", "/api/ads/cancel-session", { sessionId });
  } catch {
    // A stale pending session expires automatically; never mask the SDK error.
  }
}
