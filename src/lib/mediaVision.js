import { supabase } from './supabaseClient';

const ANALYZE_MEDIA_FUNCTION_NAME = 'analyze-media';

function normalizeAttachment(attachment) {
  return {
    id: typeof attachment?.id === 'string' ? attachment.id : '',
    name: typeof attachment?.name === 'string' ? attachment.name : '',
    mimeType: typeof attachment?.mimeType === 'string' ? attachment.mimeType : '',
    dataUrl: typeof attachment?.dataUrl === 'string' ? attachment.dataUrl : '',
    size: Number(attachment?.size) || 0,
  };
}

function normalizeAnalysisItem(item) {
  return {
    id: typeof item?.id === 'string' ? item.id : '',
    summary: typeof item?.summary === 'string' ? item.summary.trim() : '',
    labels: Array.isArray(item?.labels) ? item.labels.filter((label) => typeof label === 'string') : [],
    text: typeof item?.text === 'string' ? item.text.trim() : '',
  };
}

export async function analyzeAttachmentsWithVision(attachments) {
  const normalizedAttachments = Array.isArray(attachments)
    ? attachments.map(normalizeAttachment).filter((attachment) => attachment.id && attachment.dataUrl)
    : [];

  if (normalizedAttachments.length === 0) {
    return [];
  }

  if (!supabase?.functions?.invoke) {
    throw new Error(
      "L'analyse externe des images n'est pas disponible. Configure le fallback Imagga cote Supabase.",
    );
  }

  const { data, error } = await supabase.functions.invoke(ANALYZE_MEDIA_FUNCTION_NAME, {
    body: {
      attachments: normalizedAttachments,
    },
  });

  if (error) {
    throw new Error(
      error.message ||
        "L'analyse externe des images a echoue. Verifie les secrets Imagga de la fonction Supabase analyze-media.",
    );
  }

  const resultList = Array.isArray(data?.results) ? data.results.map(normalizeAnalysisItem) : [];
  const resultsById = new Map(
    resultList
      .filter((item) => item.id)
      .map((item) => [item.id, item]),
  );

  return normalizedAttachments.map((attachment) => {
    const result = resultsById.get(attachment.id);

    if (result) {
      return result;
    }

    return {
      id: attachment.id,
      summary: `Image importee: ${attachment.name || 'sans nom'}.`,
      labels: [],
      text: '',
    };
  });
}
