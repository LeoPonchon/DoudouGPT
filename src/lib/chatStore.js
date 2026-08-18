import { supabase } from './supabaseClient';

export const DEFAULT_CHAT_TITLE = 'Nouveau chat';
export const RECENT_CHATS_LIMIT = 10;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeChatRecord(record) {
  return {
    id: record.id,
    title: normalizeText(record.title) || DEFAULT_CHAT_TITLE,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function normalizeMessageRecord(record) {
  return {
    id: record.id,
    role: record.role,
    content: normalizeText(record.content),
    metadata:
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata
        : {},
    created_at: record.created_at,
  };
}

export function summarizeChatTitle(text, maxLength = 48) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return DEFAULT_CHAT_TITLE;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export async function fetchRecentChats(userId) {
  const { data, error } = await supabase
    .from('chats')
    .select('id,title,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(RECENT_CHATS_LIMIT);

  if (error) {
    throw error;
  }

  return (data ?? []).map(normalizeChatRecord);
}

export async function createChat(userId, title = DEFAULT_CHAT_TITLE) {
  const { data, error } = await supabase
    .from('chats')
    .insert({
      user_id: userId,
      title: normalizeText(title) || DEFAULT_CHAT_TITLE,
    })
    .select('id,title,created_at,updated_at')
    .single();

  if (error) {
    throw error;
  }

  return normalizeChatRecord(data);
}

export async function fetchChatMessages(chatId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id,role,content,metadata,created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(normalizeMessageRecord);
}

export async function insertChatMessage({ chatId, userId, role, content, metadata = {} }) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      chat_id: chatId,
      user_id: userId,
      role,
      content,
      metadata,
    })
    .select('id,role,content,metadata,created_at')
    .single();

  if (error) {
    throw error;
  }

  return normalizeMessageRecord(data);
}

export async function renameChatTitle({ chatId, userId, title }) {
  const nextTitle = normalizeText(title) || DEFAULT_CHAT_TITLE;

  const { data, error } = await supabase
    .from('chats')
    .update({
      title: nextTitle,
    })
    .eq('id', chatId)
    .eq('user_id', userId)
    .select('id,title,created_at,updated_at')
    .single();

  if (error) {
    throw error;
  }

  return normalizeChatRecord(data);
}

export async function deleteChat({ chatId, userId }) {
  const { error } = await supabase
    .from('chats')
    .delete()
    .eq('id', chatId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}
