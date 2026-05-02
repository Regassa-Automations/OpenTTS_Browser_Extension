const OPENROUTER_TTS_ENDPOINT = 'https://openrouter.ai/api/v1/tts';
const OPENROUTER_TTS_MODEL = 'openai/gpt-4o-mini-tts';

const ALLOWED_VOICES = Object.freeze([
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
]);

const ALLOWED_FORMATS = Object.freeze(['mp3', 'pcm']);

export class OpenRouterTtsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OpenRouterTtsError';
    this.code = code;
    this.details = details;
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OpenRouterTtsError('invalid_input', `${fieldName} must be a non-empty string`);
  }
}

export function buildOpenRouterTtsRequest({ text, voice, format = 'mp3' }) {
  assertNonEmptyString(text, 'text');
  assertNonEmptyString(voice, 'voice');

  if (!ALLOWED_VOICES.includes(voice)) {
    throw new OpenRouterTtsError(
      'invalid_voice',
      `voice must be one of: ${ALLOWED_VOICES.join(', ')}`,
      { allowedVoices: ALLOWED_VOICES }
    );
  }

  if (!ALLOWED_FORMATS.includes(format)) {
    throw new OpenRouterTtsError(
      'invalid_format',
      `format must be one of: ${ALLOWED_FORMATS.join(', ')}`,
      { allowedFormats: ALLOWED_FORMATS }
    );
  }

  return {
    endpoint: OPENROUTER_TTS_ENDPOINT,
    body: {
      model: OPENROUTER_TTS_MODEL,
      input: text,
      voice,
      response_format: format,
    },
  };
}

function getMimeType(response, requestedFormat) {
  const headerMime = response.headers.get('content-type');
  if (headerMime) {
    return headerMime.split(';')[0].trim().toLowerCase();
  }

  return requestedFormat === 'pcm' ? 'audio/L16' : 'audio/mpeg';
}

function mapHttpError(status, bodyText) {
  if (status === 401) {
    return new OpenRouterTtsError('auth_error', 'OpenRouter authentication failed (401). Check API key.', { status, bodyText });
  }
  if (status === 402 || status === 429) {
    return new OpenRouterTtsError('quota_error', 'OpenRouter quota/rate limit error.', { status, bodyText });
  }
  return new OpenRouterTtsError('http_error', `OpenRouter TTS request failed with status ${status}.`, { status, bodyText });
}

export async function parseOpenRouterTtsResponse(response, { text, format = 'mp3', asDataUrl = false } = {}) {
  if (!(response instanceof Response)) {
    throw new OpenRouterTtsError('malformed_response', 'response must be a fetch Response object');
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw mapHttpError(response.status, bodyText);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new OpenRouterTtsError('malformed_response', 'OpenRouter returned empty audio payload');
  }

  const mimeType = getMimeType(response, format);
  const charCount = typeof text === 'string' ? text.length : null;

  if (asDataUrl) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    const audioDataUrl = `data:${mimeType};base64,${btoa(binary)}`;
    return { audioDataUrl, mimeType, charCount };
  }

  return { audioBytes: new Uint8Array(buffer), mimeType, charCount };
}

export async function synthesizeWithOpenRouter({ apiKey, text, voice, format = 'mp3', signal, asDataUrl = false }) {
  assertNonEmptyString(apiKey, 'apiKey');

  const { endpoint, body } = buildOpenRouterTtsRequest({ text, voice, format });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  return parseOpenRouterTtsResponse(response, { text, format, asDataUrl });
}

export const OpenRouterTtsAdapter = Object.freeze({
  endpoint: OPENROUTER_TTS_ENDPOINT,
  model: OPENROUTER_TTS_MODEL,
  voices: ALLOWED_VOICES,
  formats: ALLOWED_FORMATS,
  buildRequest: buildOpenRouterTtsRequest,
  parseResponse: parseOpenRouterTtsResponse,
  synthesize: synthesizeWithOpenRouter,
});
