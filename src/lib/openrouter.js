import { DOUDOU_SYSTEM_PROMPT } from './doudouPrompt';
import { analyzeAttachmentsWithVision } from './mediaVision';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free';
const DEFAULT_APP_TITLE = 'DoudouGPT';
const DEFAULT_SITE_URL = 'http://localhost:3000';
const DEFAULT_FALLBACK_MODEL = DEFAULT_MODEL;

const SYSTEM_MESSAGE = {
  role: 'system',
  content: DOUDOU_SYSTEM_PROMPT,
};

function getEnvValue(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function getSiteUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return DEFAULT_SITE_URL;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object' && 'text' in part) {
          return String(part.text ?? '');
        }

        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

function normalizeAssistantText(content) {
  return content
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/([,;:!?]+)(?=\S)/g, '$1 ')
    .replace(/\.{1,3}(?=\S)/g, (match) => `${match} `)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseOpenRouterError(details) {
  if (typeof details !== 'string' || details.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(details);
  } catch (_error) {
    return null;
  }
}

function createOpenRouterError(response, details) {
  const parsedDetails = parseOpenRouterError(details);
  const providerError = parsedDetails?.error ?? null;
  const providerMessage =
    typeof providerError?.message === 'string' ? providerError.message.trim() : '';
  const providerCode = Number(providerError?.code);
  const providerName =
    typeof providerError?.metadata?.provider_name === 'string'
      ? providerError.metadata.provider_name.trim()
      : '';
  const isRateLimited = response.status === 429 || providerCode === 429;

  let message = `OpenRouter a repondu avec le statut ${response.status}.`;

  if (isRateLimited) {
    message = providerName
      ? `${providerName} est temporairement sature. Reessaie dans quelques instants.`
      : "Le modele free d'OpenRouter est temporairement sature. Reessaie dans quelques instants.";
  } else if (providerMessage) {
    message = providerMessage;
  }

  const error = new Error(message);

  error.status = response.status;
  error.code = Number.isFinite(providerCode) ? providerCode : response.status;
  error.providerName = providerName;
  error.providerMessage = providerMessage;
  error.isRateLimited = isRateLimited;

  return error;
}

function getMessageAttachments(message) {
  const attachments = message?.metadata?.attachments;

  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((attachment) => ({
      id: typeof attachment?.id === 'string' ? attachment.id : '',
      name: typeof attachment?.name === 'string' ? attachment.name : '',
      mimeType: typeof attachment?.mimeType === 'string' ? attachment.mimeType : '',
      dataUrl: typeof attachment?.dataUrl === 'string' ? attachment.dataUrl : '',
      size: Number(attachment?.size) || 0,
    }))
    .filter((attachment) => attachment.id && attachment.dataUrl);
}

function getConversationAttachments(messages) {
  return (Array.isArray(messages) ? messages : []).flatMap((message) => getMessageAttachments(message));
}

function hasVisibleText(message) {
  const text = normalizeTextContent(message?.content);

  if (!text) {
    return false;
  }

  return message?.metadata?.hasText !== false;
}

function getAttachmentLabel(attachment, index) {
  const baseName = attachment.name || `media ${index + 1}`;

  if (attachment.mimeType === 'image/gif') {
    return `GIF: ${baseName}`;
  }

  return `Image: ${baseName}`;
}

function buildAttachmentTextBlock(message) {
  const attachments = getMessageAttachments(message);

  if (attachments.length === 0) {
    return '';
  }

  const lines = [];

  attachments.forEach((attachment, index) => {
    lines.push(`- ${getAttachmentLabel(attachment, index)}`);
  });

  return lines.join('\n');
}

function buildAttachmentAnalysisBlock(message, attachmentAnalysisById) {
  const attachments = getMessageAttachments(message);

  if (attachments.length === 0) {
    return '';
  }

  const lines = [];

  attachments.forEach((attachment, index) => {
    const analysis = attachmentAnalysisById?.get(attachment.id);
    const summary =
      typeof analysis?.summary === 'string' && analysis.summary.trim().length > 0
        ? analysis.summary.trim()
        : getAttachmentLabel(attachment, index);

    lines.push(`- ${summary}`);

    if (typeof analysis?.text === 'string' && analysis.text.trim().length > 0) {
      lines.push(`  Texte: ${analysis.text.trim()}`);
    }
  });

  return lines.join('\n');
}

function buildModelMessage(message, { useImageAttachments, attachmentAnalysisById }) {
  const attachments = getMessageAttachments(message);
  const text = hasVisibleText(message) ? normalizeTextContent(message.content) : '';

  if (useImageAttachments && attachments.length > 0) {
    const parts = [];
    const textPart = text || 'Media joint.';

    if (textPart) {
      parts.push({
        type: 'text',
        text: textPart,
      });
    }

    attachments.forEach((attachment) => {
      parts.push({
        type: 'image_url',
        image_url: {
          url: attachment.dataUrl,
        },
      });
    });

    return {
      role: message.role,
      content: parts,
    };
  }

  if (attachments.length > 0) {
    const analysisBlock = buildAttachmentAnalysisBlock(message, attachmentAnalysisById);
    const attachmentBlock = analysisBlock || buildAttachmentTextBlock(message);
    const segments = [];

    if (text) {
      segments.push(text);
    }

    if (attachmentBlock) {
      segments.push('Pieces jointes :');
      segments.push(attachmentBlock);
    }

    return {
      role: message.role,
      content: segments.join('\n\n').trim() || 'Media joint.',
    };
  }

  return {
    role: message.role,
    content: text,
  };
}

function buildModelMessages(messages, options) {
  return (Array.isArray(messages) ? messages : []).map((message) =>
    buildModelMessage(message, options),
  );
}

function isVisionFallbackError(error) {
  if (!error || error.isRateLimited) {
    return false;
  }

  const status = Number(error.status);

  if ([400, 404, 415, 422].includes(status)) {
    return true;
  }

  const message = `${error.message || ''} ${error.providerMessage || ''}`.toLowerCase();

  return (
    message.includes('image') ||
    message.includes('vision') ||
    message.includes('multimodal') ||
    message.includes('attachment') ||
    message.includes('unsupported')
  );
}

function getRateLimitFriendlyError() {
  return new Error(
    "Le modele free d'OpenRouter est temporairement sature. Reessaie dans quelques instants.",
  );
}

async function requestOpenRouterChat(messages, model, options = {}) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterConfig.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': openRouterConfig.siteUrl,
      'X-OpenRouter-Title': openRouterConfig.appTitle,
    },
    body: JSON.stringify({
      model,
      messages: [SYSTEM_MESSAGE, ...buildModelMessages(messages, options)],
      stream: false,
      temperature: 0.7,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw createOpenRouterError(response, details);
  }

  const data = await response.json();
  const assistantText = normalizeTextContent(data?.choices?.[0]?.message?.content);

  if (!assistantText) {
    throw new Error('DoudouGPT a retourne une reponse vide.');
  }

  return normalizeAssistantText(assistantText);
}

async function retryWithExternalVision(messages, model) {
  const attachments = getConversationAttachments(messages);
  const analyses = await analyzeAttachmentsWithVision(attachments);
  const attachmentAnalysisById = new Map(
    Array.isArray(analyses)
      ? analyses
          .filter((analysis) => typeof analysis?.id === 'string' && analysis.id.length > 0)
          .map((analysis) => [analysis.id, analysis])
      : [],
  );

  return requestOpenRouterChat(messages, model, {
    useImageAttachments: false,
    attachmentAnalysisById,
  }).catch((error) => {
    if (error?.isRateLimited) {
      throw getRateLimitFriendlyError();
    }

    throw error;
  });
}

export const openRouterConfig = {
  apiKey: getEnvValue(process.env.REACT_APP_OPENROUTER_API_KEY, ''),
  model: getEnvValue(process.env.REACT_APP_OPENROUTER_MODEL, DEFAULT_MODEL),
  fallbackModel: getEnvValue(process.env.REACT_APP_OPENROUTER_FALLBACK_MODEL, DEFAULT_FALLBACK_MODEL),
  appTitle: getEnvValue(process.env.REACT_APP_OPENROUTER_APP_TITLE, DEFAULT_APP_TITLE),
  siteUrl: getEnvValue(process.env.REACT_APP_OPENROUTER_SITE_URL, getSiteUrl()),
};

export const isOpenRouterConfigured = Boolean(openRouterConfig.apiKey);

export async function sendOpenRouterChat(messages) {
  if (!isOpenRouterConfigured) {
    throw new Error(
      "DoudouGPT n'est pas configure. Ajoute la cle du moteur dans ton .env et relance l'app.",
    );
  }

  const hasAttachments = getConversationAttachments(messages).length > 0;

  try {
    return await requestOpenRouterChat(messages, openRouterConfig.model, {
      useImageAttachments: hasAttachments,
    });
  } catch (error) {
    if (
      error?.isRateLimited &&
      openRouterConfig.fallbackModel &&
      openRouterConfig.fallbackModel !== openRouterConfig.model
    ) {
      try {
        return await requestOpenRouterChat(messages, openRouterConfig.fallbackModel, {
          useImageAttachments: hasAttachments,
        });
      } catch (fallbackError) {
        if (isVisionFallbackError(fallbackError) && hasAttachments) {
          return retryWithExternalVision(messages, openRouterConfig.fallbackModel);
        }

        if (fallbackError?.isRateLimited) {
          throw getRateLimitFriendlyError();
        }

        throw fallbackError;
      }
    }

    if (isVisionFallbackError(error) && hasAttachments) {
      return retryWithExternalVision(messages, openRouterConfig.model);
    }

    if (error?.isRateLimited) {
      throw getRateLimitFriendlyError();
    }

    throw error;
  }
}
