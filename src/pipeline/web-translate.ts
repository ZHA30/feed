const GOOGLE_TRANSLATE_HTML_URL = "https://translate-pa.googleapis.com/v1/translateHtml";
const GOOGLE_TRANSLATE_HTML_API_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const GOOGLE_TRANSLATE_HTML_CLIENT = "wt_lib";
const MICROSOFT_AUTH_URL = "https://edge.microsoft.com/translate/auth";
const MICROSOFT_TRANSLATE_URL = "https://api-edge.cognitive.microsofttranslator.com/translate";

export async function translateTextWithWebFallback(text: string, targetLanguage: string): Promise<string> {
  const errors: string[] = [];

  for (const provider of [googleTranslate, microsoftTranslate]) {
    try {
      const translated = await provider(text, "auto", targetLanguage);
      if (translated.trim()) {
        return translated.trim();
      }
      errors.push("empty translation");
    }
    catch (error) {
      errors.push(error instanceof Error ? error.message : "unknown error");
    }
  }

  throw new Error(`web translation fallback failed: ${errors.join("; ")}`);
}

async function googleTranslate(sourceText: string, fromLanguage: string, toLanguage: string): Promise<string> {
  const response = await fetch(GOOGLE_TRANSLATE_HTML_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOGLE_TRANSLATE_HTML_API_KEY,
    },
    body: JSON.stringify([
      [[sourceText], normalizeGoogleLanguage(fromLanguage), normalizeGoogleLanguage(toLanguage)],
      GOOGLE_TRANSLATE_HTML_CLIENT,
    ]),
  });

  if (!response.ok) {
    throw new Error(`Google web translation failed with status ${response.status}`);
  }

  const body = await response.json() as unknown;
  if (!Array.isArray(body) || !Array.isArray(body[0]) || typeof body[0][0] !== "string") {
    throw new Error("Google web translation response is invalid");
  }

  return body[0][0];
}

async function microsoftTranslate(sourceText: string, fromLanguage: string, toLanguage: string): Promise<string> {
  const tokenResponse = await fetch(MICROSOFT_AUTH_URL);
  if (!tokenResponse.ok) {
    throw new Error(`Microsoft web translation token failed with status ${tokenResponse.status}`);
  }

  const token = await tokenResponse.text();
  const url = new URL(MICROSOFT_TRANSLATE_URL);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("to", normalizeMicrosoftLanguage(toLanguage));
  url.searchParams.set("includeSentenceLength", "true");
  url.searchParams.set("textType", "html");
  const normalizedFromLanguage = normalizeMicrosoftLanguage(fromLanguage);
  if (normalizedFromLanguage !== "auto") {
    url.searchParams.set("from", normalizedFromLanguage);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "ocp-apim-subscription-key": token,
    },
    body: JSON.stringify([{ Text: sourceText }]),
  });

  if (!response.ok) {
    throw new Error(`Microsoft web translation failed with status ${response.status}`);
  }

  const body = await response.json() as unknown;
  const translated = Array.isArray(body) && isRecord(body[0])
    && Array.isArray(body[0].translations) && isRecord(body[0].translations[0])
    && typeof body[0].translations[0].text === "string"
    ? body[0].translations[0].text
    : null;
  if (translated === null) {
    throw new Error("Microsoft web translation response is invalid");
  }

  return translated;
}

function normalizeGoogleLanguage(language: string): string {
  if (language === "auto") {
    return "auto";
  }
  if (language === "zh-Hans") {
    return "zh-CN";
  }
  if (language === "zh-Hant") {
    return "zh-TW";
  }
  return language;
}

function normalizeMicrosoftLanguage(language: string): string {
  if (language === "auto") {
    return "auto";
  }
  if (language === "zh-CN" || language === "zh-SG") {
    return "zh-Hans";
  }
  if (language === "zh-TW" || language === "zh-HK" || language === "zh-MO") {
    return "zh-Hant";
  }
  return language;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}
