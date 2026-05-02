import { ERROR_CODE } from '../shared/message_types.js';

const OPENROUTER_TTS_ENDPOINT = 'https://openrouter.ai/api/v1/tts';
const DEFAULT_TTS_MODEL = 'openai/gpt-4o-mini-tts';
const VALID_MODEL_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(?::[a-z0-9._-]+)?$/i;

const ALLOWED_VOICES = Object.freeze(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const ALLOWED_FORMATS = Object.freeze(['mp3', 'pcm']);

/**
 * Canonical adapter error shape used by background orchestration.
 */
export class OpenRouterTtsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OpenRouterTtsError';
    this.code = code;
    this.details = details;
  }
}

function toError(code, message, details) {
  return new OpenRouterTtsError(code, message, details);
}

function normalizeModel(model) {
  if (typeof model !== 'string' || model.trim().length === 0) {
    return DEFAULT_TTS_MODEL;
  }

  const candidate = model.trim();
  if (!VALID_MODEL_PATTERN.test(candidate)) {
    return DEFAULT_TTS_MODEL;
  }

  return candidate;
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw toError(ERROR_CODE.BAD_REQUEST, `${fieldName} must be a non-empty string`);
  }
}

function encodeDataUrl(bytes, mimeType) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function mapHttpError(status, bodyText = '') {
  const safeBody = bodyText.slice(0, 256);
  if (status === 401 || status === 403) {
    return toError(ERROR_CODE.AUTH_ERROR, 'OpenRouter authentication failed.', { status, body: safeBody });
  }
  if (status === 402) {
    return toError(ERROR_CODE.QUOTA_ERROR, 'OpenRouter quota exceeded.', { status, body: safeBody });
  }
  if (status === 429) {
    return toError(ERROR_CODE.RATE_LIMIT, 'OpenRouter rate limit reached.', { status, body: safeBody });
  }
  if (status === 400) {
    return toError(ERROR_CODE.BAD_REQUEST, 'OpenRouter rejected request.', { status, body: safeBody });
  }
  if (status >= 500 && status <= 599) {
    return toError(ERROR_CODE.UPSTREAM_ERROR, 'OpenRouter upstream service error.', { status, body: safeBody });
  }
  return toError(ERROR_CODE.UPSTREAM_ERROR, `Unexpected OpenRouter status: ${status}`, { status, body: safeBody });
}

function getMimeTypeFromResponse(raw, requestedFormat) {
  const headerMime = raw.headers?.get?.('content-type');
  if (typeof headerMime === 'string' && headerMime.trim().length > 0) {
    return headerMime.split(';')[0].trim().toLowerCase();
  }
  return requestedFormat === 'pcm' ? 'audio/L16' : 'audio/mpeg';
}

/**
 * Build request payload for OpenRouter TTS.
 */
export function buildTtsRequest({ text, voice, model, format = 'mp3' }) {
  assertNonEmptyString(text, 'text');
  assertNonEmptyString(voice, 'voice');

  if (!ALLOWED_VOICES.includes(voice)) {
    throw toError(ERROR_CODE.BAD_REQUEST, `voice must be one of: ${ALLOWED_VOICES.join(', ')}`);
  }
  if (!ALLOWED_FORMATS.includes(format)) {
    throw toError(ERROR_CODE.BAD_REQUEST, `format must be one of: ${ALLOWED_FORMATS.join(', ')}`);
  }

  return {
    endpoint: OPENROUTER_TTS_ENDPOINT,
    body: {
      model: normalizeModel(model),
      input: text,
      voice,
      response_format: format,
    },
  };
}

/**
 * Parse provider response into canonical adapter output shape.
 */
export async function parseTtsResponse(raw, { text = '', requestedFormat = 'mp3', modelUsed, voiceUsed } = {}) {
  try {
    if (!(raw instanceof Response)) {
      throw toError(ERROR_CODE.PARSE_ERROR, 'Expected fetch Response object.');
    }

    if (!raw.ok) {
      const bodyText = await raw.text().catch(() => '');
      throw mapHttpError(raw.status, bodyText);
    }

    const responseMimeType = getMimeTypeFromResponse(raw, requestedFormat);
    const mimeType = responseMimeType.includes('application/json')
      ? (requestedFormat === 'pcm' ? 'audio/L16' : 'audio/mpeg')
      : responseMimeType;
    let bytes = null;

    if (responseMimeType.includes('application/json')) {
      const payload = await raw.json().catch(() => null);
      const encodedAudio = payload?.audio ?? payload?.audio_base64 ?? payload?.data?.audio ?? payload?.output?.audio;
      if (typeof encodedAudio !== 'string' || encodedAudio.length === 0) {
        throw toError(ERROR_CODE.PARSE_ERROR, 'JSON response missing audio payload.');
      }
      const binary = atob(encodedAudio);
      bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } else {
      const buffer = await raw.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw toError(ERROR_CODE.PARSE_ERROR, 'Received empty audio payload.');
      }
      bytes = new Uint8Array(buffer);
    }

    if (!bytes || bytes.byteLength === 0) {
      throw toError(ERROR_CODE.PARSE_ERROR, 'Received empty decoded audio payload.');
    }

    return {
      audioDataUrl: encodeDataUrl(bytes, mimeType),
      mimeType,
      charCount: typeof text === 'string' ? text.length : 0,
      modelUsed: normalizeModel(modelUsed),
      voiceUsed: typeof voiceUsed === 'string' ? voiceUsed : '',
      debug: {
        status: raw.status,
        contentLength: raw.headers.get('content-length') || null,
      },
    };
  } catch (error) {
    if (error instanceof OpenRouterTtsError) {
      throw error;
    }
    throw toError(ERROR_CODE.PARSE_ERROR, 'Failed to parse OpenRouter response.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Estimate USD cost for this TTS request.
 */
export function estimateCost({ charCount, model }) {
  const count = Number.isFinite(charCount) ? Math.max(0, Number(charCount)) : 0;
  const normalizedModel = normalizeModel(model);
  // Baseline: $0.60 per 1M chars for gpt-4o-mini-tts family.
  const usdPerMillionChars = normalizedModel.includes('gpt-4o-mini-tts') ? 0.6 : 1.0;
  return Number(((count / 1_000_000) * usdPerMillionChars).toFixed(6));
}

/**
 * Sole network caller for OpenRouter TTS.
 */
export async function fetchTtsAudio({ apiKey, text, voice, model, format = 'mp3', signal } = {}) {
  try {
    assertNonEmptyString(apiKey, 'apiKey');
    const { endpoint, body } = buildTtsRequest({ text, voice, model, format });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    const parsed = await parseTtsResponse(response, {
      text,
      requestedFormat: format,
      modelUsed: body.model,
      voiceUsed: voice,
    });

    return {
      ...parsed,
      estimatedUsd: estimateCost({ charCount: parsed.charCount, model: parsed.modelUsed }),
    };
  } catch (error) {
    if (error instanceof OpenRouterTtsError) {
      throw error;
    }

    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
      throw toError(ERROR_CODE.NETWORK_ERROR, 'Network error while contacting OpenRouter.', {
        message: error.message,
      });
    }

    throw toError(ERROR_CODE.UPSTREAM_ERROR, 'Unexpected OpenRouter adapter error.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const OpenRouterTtsAdapter = Object.freeze({
  endpoint: OPENROUTER_TTS_ENDPOINT,
  model: DEFAULT_TTS_MODEL,
  voices: ALLOWED_VOICES,
  formats: ALLOWED_FORMATS,
  buildRequest: buildTtsRequest,
  parseResponse: parseTtsResponse,
  fetchAudio: fetchTtsAudio,
  estimateCost,
});
