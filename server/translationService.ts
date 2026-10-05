const translationCache = new Map<string, string>();

const GOOGLE_LANGUAGE_CODES = new Set([
  'en', 'hi', 'bn', 'ru', 'pt', 'es', 'tr', 'de', 'fr', 'it', 'id', 'pl', 'nl', 'zh', 'ja', 'ko', 'ar', 'fa',
]);

export function isSupportedTranslationLanguage(language: string): boolean {
  return GOOGLE_LANGUAGE_CODES.has(language);
}

export async function translateTexts(texts: string[], target: string): Promise<string[]> {
  const cleaned = texts.map((text) => text.trim());
  if (target === 'en' || !isSupportedTranslationLanguage(target)) return cleaned;

  const results = [...cleaned];
  const missing: Array<{ index: number; text: string; key: string }> = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    const key = `${target}:${cleaned[index]}`;
    const cached = translationCache.get(key);
    if (cached) results[index] = cached;
    else if (cleaned[index]) missing.push({ index, text: cleaned[index], key });
  }
  if (!missing.length) return results;

  const apiKey = process.env.GOOGLE_CLOUD_TRANSLATION_API_KEY?.trim();
  if (!apiKey) return results;

  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: missing.map((item) => item.text), source: 'en', target, format: 'text' }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Google Translation API returned ${response.status}`);

  const payload = await response.json() as { data?: { translations?: Array<{ translatedText?: string }> } };
  const translated = payload.data?.translations || [];
  missing.forEach((item, position) => {
    const value = translated[position]?.translatedText?.trim();
    if (value) {
      translationCache.set(item.key, value);
      results[item.index] = value;
    }
  });
  return results;
}
