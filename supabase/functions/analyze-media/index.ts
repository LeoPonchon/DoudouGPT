type AttachmentInput = {
  id: string;
  name?: string;
  mimeType?: string;
  dataUrl: string;
  size?: number;
};

type AttachmentAnalysis = {
  id: string;
  summary: string;
  labels: string[];
  text: string;
  objects: string[];
};

type ImaggaError = Error & {
  status?: number;
  isImaggaAuth?: boolean;
  isImaggaRateLimited?: boolean;
};

const IMAGGA_API_KEY = Deno.env.get('IMAGGA_API_KEY') ?? '';
const IMAGGA_API_SECRET = Deno.env.get('IMAGGA_API_SECRET') ?? '';
const IMAGGA_TAGS_ENDPOINT = 'https://api.imagga.com/v2/tags';
const IMAGGA_TEXT_ENDPOINT = 'https://api.imagga.com/v2/text';
const MAX_TAGS = 5;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...init.headers,
    },
    ...init,
  });
}

function createImaggaError(message: string, status?: number): ImaggaError {
  const error = new Error(message) as ImaggaError;

  if (typeof status === 'number') {
    error.status = status;
    error.isImaggaAuth = status === 401 || status === 403;
    error.isImaggaRateLimited = status === 429;
  }

  return error;
}

function isImaggaAuthError(error: unknown): error is ImaggaError {
  return Boolean(error && typeof error === 'object' && (error as ImaggaError).isImaggaAuth);
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);

  if (!match) {
    throw new Error('Invalid data URL.');
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function buildBasicAuthHeader() {
  return `Basic ${btoa(`${IMAGGA_API_KEY}:${IMAGGA_API_SECRET}`)}`;
}

async function requestImagga(endpoint: string, formData: FormData) {
  if (!IMAGGA_API_KEY || !IMAGGA_API_SECRET) {
    throw createImaggaError(
      'IMAGGA_API_KEY and IMAGGA_API_SECRET are not configured. Add them as Supabase Edge Function secrets.',
    );
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(),
    },
    body: formData,
  });

  const raw = await response.text();
  let data: any = null;

  if (raw.trim().length > 0) {
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = null;
    }
  }

  const statusText = typeof data?.status?.text === 'string' ? data.status.text.trim() : '';

  if (!response.ok || data?.status?.type === 'error') {
    const detail = statusText || raw.trim();
    const message = detail.length > 0
      ? `Imagga returned ${response.status}. ${detail}`
      : `Imagga returned ${response.status}.`;

    throw createImaggaError(message, response.status);
  }

  if (!data) {
    throw createImaggaError(
      `Imagga returned ${response.status} without a valid JSON body.`,
      response.status,
    );
  }

  return data;
}

function extractTagLabels(data: any) {
  const items = Array.isArray(data?.result?.tags) ? data.result.tags : [];

  return items
    .map((item: any) =>
      normalizeText(
        item?.tag?.en ??
          item?.name?.en ??
          item?.tag?.name ??
          item?.name ??
          item?.description,
      )
    )
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function extractOcrText(data: any) {
  const items = Array.isArray(data?.result?.text) ? data.result.text : [];
  const joinedText = items
    .map((item: any) => normalizeText(item?.data ?? item?.text ?? item?.value))
    .filter(Boolean)
    .join(' ');

  return normalizeText(joinedText);
}

function buildSummary(attachment: AttachmentInput, labels: string[], text: string): AttachmentAnalysis {
  const details: string[] = [];

  if (labels.length > 0) {
    details.push(`Tags: ${labels.join(', ')}`);
  }

  if (text.length > 0) {
    details.push(`Texte: ${text}`);
  }

  if (details.length === 0) {
    details.push('Aucun detail visuel fort detecte.');
  }

  return {
    id: attachment.id,
    summary: `${attachment.name || 'image'}: ${details.join('. ')}`,
    labels,
    text,
    objects: labels,
  };
}

async function analyzeAttachment(attachment: AttachmentInput) {
  const parsed = parseDataUrl(attachment.dataUrl);
  const tagsFormData = new FormData();
  tagsFormData.append('image_base64', parsed.base64);
  tagsFormData.append('language', 'en');

  const textFormData = new FormData();
  textFormData.append('image_base64', parsed.base64);

  const [tagsResult, textResult] = await Promise.allSettled([
    requestImagga(IMAGGA_TAGS_ENDPOINT, tagsFormData),
    requestImagga(IMAGGA_TEXT_ENDPOINT, textFormData),
  ]);

  if (tagsResult.status === 'rejected' && isImaggaAuthError(tagsResult.reason)) {
    throw tagsResult.reason;
  }

  if (textResult.status === 'rejected' && isImaggaAuthError(textResult.reason)) {
    throw textResult.reason;
  }

  const labels = tagsResult.status === 'fulfilled' ? extractTagLabels(tagsResult.value) : [];
  const text = textResult.status === 'fulfilled' ? extractOcrText(textResult.value) : '';

  return buildSummary(attachment, labels, text);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!IMAGGA_API_KEY || !IMAGGA_API_SECRET) {
    return jsonResponse(
      {
        error:
          'IMAGGA_API_KEY and IMAGGA_API_SECRET are not configured. Add them as Supabase Edge Function secrets.',
      },
      { status: 500 },
    );
  }

  let payload: { attachments?: AttachmentInput[] };

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments
        .map((attachment) => ({
          id: typeof attachment?.id === 'string' ? attachment.id : '',
          name: typeof attachment?.name === 'string' ? attachment.name : '',
          mimeType: typeof attachment?.mimeType === 'string' ? attachment.mimeType : '',
          dataUrl: typeof attachment?.dataUrl === 'string' ? attachment.dataUrl : '',
          size: Number(attachment?.size) || 0,
        }))
        .filter((attachment) => attachment.id && attachment.dataUrl)
    : [];

  if (attachments.length === 0) {
    return jsonResponse({ results: [] });
  }

  try {
    const results: AttachmentAnalysis[] = [];

    for (const attachment of attachments) {
      try {
        results.push(await analyzeAttachment(attachment));
      } catch (error) {
        if (isImaggaAuthError(error)) {
          throw error;
        }

        results.push(buildSummary(attachment, [], ''));
      }
    }

    return jsonResponse({ results });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Imagga analysis failed.',
      },
      { status: 500 },
    );
  }
});
