import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { isOpenRouterConfigured, sendOpenRouterChat } from './lib/openrouter';
import {
  DEFAULT_CHAT_TITLE,
  createChat,
  deleteChat,
  fetchChatMessages,
  fetchRecentChats,
  insertChatMessage,
  renameChatTitle,
  summarizeChatTitle,
} from './lib/chatStore';

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: "wesh reuf, balance ta question tkt, chuis chaud pour t'aider mdr.",
};

const AUTH_INITIAL_STATE = {
  email: '',
  password: '',
};

const MAX_STORED_MESSAGES = 30;
const MAX_CONTEXT_MESSAGES = 16;

function formatError(error) {
  if (!error) {
    return 'Une erreur inconnue est survenue.';
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || 'Une erreur inconnue est survenue.';
}

function formatChatTimestamp(value) {
  if (!value) {
    return "à l'instant";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "à l'instant";
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function formatMessageTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getChatAvatarLabel(title) {
  const normalized = typeof title === 'string' ? title.trim() : '';

  if (!normalized) {
    return 'D';
  }

  return normalized.slice(0, 1).toUpperCase();
}

function getUserHandle(email) {
  if (typeof email !== 'string' || !email.trim()) {
    return 'toi';
  }

  return email.split('@')[0].trim() || 'toi';
}

const MAX_ATTACHMENT_COUNT = 4;
const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_ACCEPT = 'image/*,.gif,.webp,.png,.jpg,.jpeg';

function createAttachmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Impossible de lire le fichier.'));
    };

    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function isSupportedAttachmentFile(file) {
  if (!file || typeof file.name !== 'string') {
    return false;
  }

  const fileName = file.name.toLowerCase();
  const mimeType = typeof file.type === 'string' ? file.type.toLowerCase() : '';

  return (
    mimeType.startsWith('image/') ||
    /\.(gif|png|jpe?g|webp|bmp|svg)$/i.test(fileName)
  );
}

function buildAttachmentPlaceholder(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return 'Media joint.';
  }

  if (attachments.length === 1) {
    const attachment = attachments[0];
    const name = attachment?.name || 'media';

    if (typeof attachment?.mimeType === 'string' && attachment.mimeType.toLowerCase() === 'image/gif') {
      return `GIF envoye: ${name}`;
    }

    return `Image envoyee: ${name}`;
  }

  return `${attachments.length} medias envoyes`;
}

function getMessageAttachments(message) {
  const attachments = message?.metadata?.attachments;

  return Array.isArray(attachments) ? attachments : [];
}

function shouldDisplayMessageContent(message) {
  const text = typeof message?.content === 'string' ? message.content.trim() : '';
  const attachments = getMessageAttachments(message);

  if (attachments.length === 0) {
    return text.length > 0;
  }

  if (message?.metadata?.hasText === false) {
    return false;
  }

  return text.length > 0;
}

function App() {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authValues, setAuthValues] = useState(AUTH_INITIAL_STATE);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [isChatsLoading, setIsChatsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [chatError, setChatError] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [composerValue, setComposerValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const bottomRef = useRef(null);
  const activeChatIdRef = useRef(null);
  const attachmentInputRef = useRef(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!supabase) {
      setSessionReady(true);
      return undefined;
    }

    let isActive = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isActive) {
          return;
        }

        if (error) {
          setAuthError(formatError(error));
        }

        setSession(data.session ?? null);
        setSessionReady(true);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setAuthError(formatError(error));
        setSessionReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return;
      }

      setSession(nextSession ?? null);
      setSessionReady(true);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) {
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
      setSidebarQuery('');
      setComposerValue('');
      setPendingAttachments([]);
      setIsChatsLoading(false);
      setIsMessagesLoading(false);
      setWorkspaceError('');
      setChatError('');
      return undefined;
    }

    let cancelled = false;

    const loadChats = async () => {
      setIsChatsLoading(true);
      setWorkspaceError('');

      try {
        let recentChats = await fetchRecentChats(session.user.id);

        if (cancelled) {
          return;
        }

        if (recentChats.length === 0) {
          const newChat = await createChat(session.user.id);

          if (cancelled) {
            return;
          }

          recentChats = [newChat];
        }

        setChats(recentChats);
        setActiveChatId((current) => {
          if (current && recentChats.some((chat) => chat.id === current)) {
            return current;
          }

          return recentChats[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(formatError(error));
        }
      } finally {
        if (!cancelled) {
          setIsChatsLoading(false);
        }
      }
    };

    loadChats();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !activeChatId) {
      setMessages([]);
      setComposerValue('');
      setPendingAttachments([]);
      return undefined;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setIsMessagesLoading(true);
      setChatError('');

      try {
        const chatMessages = await fetchChatMessages(activeChatId);

        if (!cancelled) {
          setMessages(chatMessages.slice(-MAX_STORED_MESSAGES));
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(formatError(error));
        }
      } finally {
        if (!cancelled) {
          setIsMessagesLoading(false);
        }
      }
    };

    loadMessages();
    setComposerValue('');
    setPendingAttachments([]);

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, activeChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, chatBusy, isMessagesLoading, activeChatId]);

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();
  const visibleChats = normalizedSidebarQuery
    ? chats.filter((chat) => {
        const haystack = `${chat.title || ''}`.toLowerCase();
        return haystack.includes(normalizedSidebarQuery);
      })
    : chats;

  const refreshChatsList = useCallback(
    async ({ preferredChatId = null } = {}) => {
      if (!session?.user?.id) {
        return [];
      }

      const recentChats = await fetchRecentChats(session.user.id);
      setChats(recentChats);

      if (preferredChatId) {
        setActiveChatId(preferredChatId);
        return recentChats;
      }

      const currentActiveId = activeChatIdRef.current;

      if (currentActiveId && recentChats.some((chat) => chat.id === currentActiveId)) {
        return recentChats;
      }

      setActiveChatId(recentChats[0]?.id ?? null);
      return recentChats;
    },
    [session?.user?.id],
  );

  useEffect(() => {
    if (!session?.user?.id || !supabase) {
      return undefined;
    }

    const channel = supabase
      .channel(`doudougpt-chats-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chats',
          filter: `user_id=eq.${session.user.id}`,
        },
        async () => {
          try {
            await refreshChatsList();
          } catch (error) {
            setWorkspaceError(formatError(error));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, refreshChatsList]);

  const updateAuthField = (field) => (event) => {
    const { value } = event.target;
    setAuthValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    const email = authValues.email.trim();
    const password = authValues.password.trim();

    if (!email || !password) {
      setAuthError('Renseigne ton email et ton mot de passe.');
      return;
    }

    if (password.length < 6) {
      setAuthError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) {
          throw error;
        }

        setAuthValues(AUTH_INITIAL_STATE);

        if (data.session) {
          setAuthMessage("Compte créé, tu es déjà connecté.");
        } else {
          setAuthMessage(
            "Compte créé. Si la confirmation email est activée, vérifie ta boîte de réception.",
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        setAuthValues(AUTH_INITIAL_STATE);
      }
    } catch (error) {
      setAuthError(formatError(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateNewChat = async () => {
    if (!session?.user?.id || chatBusy || isCreatingChat || isMessagesLoading) {
      return;
    }

    setIsCreatingChat(true);
    setWorkspaceError('');
    setChatError('');
    setSidebarQuery('');
    setComposerValue('');
    setPendingAttachments([]);

    try {
      const newChat = await createChat(session.user.id);
      setChats((current) => [newChat, ...current.filter((chat) => chat.id !== newChat.id)]);
      setActiveChatId(newChat.id);
      setMessages([]);
    } catch (error) {
      setWorkspaceError(formatError(error));
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleRenameChat = async (chat) => {
    if (!session?.user?.id || chatBusy || isMessagesLoading || isCreatingChat) {
      return;
    }

    const nextTitleRaw = window.prompt('Nouveau nom du chat', chat.title || DEFAULT_CHAT_TITLE);

    if (nextTitleRaw === null) {
      return;
    }

    const nextTitle = nextTitleRaw.trim();

    if (!nextTitle) {
      setWorkspaceError('Le titre du chat ne peut pas etre vide.');
      return;
    }

    setWorkspaceError('');
    setChatError('');

    try {
      await renameChatTitle({
        chatId: chat.id,
        userId: session.user.id,
        title: nextTitle,
      });

      await refreshChatsList();
    } catch (error) {
      setWorkspaceError(formatError(error));
    }
  };

  const handleDeleteChat = async (chat) => {
    if (!session?.user?.id || chatBusy || isMessagesLoading || isCreatingChat) {
      return;
    }

    const shouldDelete = window.confirm(
      `Supprimer "${chat.title || DEFAULT_CHAT_TITLE}" ? Les messages partiront avec.`,
    );

    if (!shouldDelete) {
      return;
    }

    const isActiveChat = activeChatIdRef.current === chat.id;

    setWorkspaceError('');
    setChatError('');

    if (isActiveChat) {
      setMessages([]);
      setComposerValue('');
      setPendingAttachments([]);
    }

    try {
      await deleteChat({
        chatId: chat.id,
        userId: session.user.id,
      });

      const recentChats = await refreshChatsList();

      if (recentChats.length === 0) {
        const replacementChat = await createChat(session.user.id);
        await refreshChatsList({ preferredChatId: replacementChat.id });
        setMessages([]);
      }
    } catch (error) {
      setWorkspaceError(formatError(error));
    }
  };

  const handleSelectChat = (chatId) => {
    if (chatBusy || isMessagesLoading || chatId === activeChatIdRef.current) {
      return;
    }

    setWorkspaceError('');
    setChatError('');
    setComposerValue('');
    setPendingAttachments([]);
    setActiveChatId(chatId);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
      setSidebarQuery('');
      setComposerValue('');
      setPendingAttachments([]);
      setWorkspaceError('');
      setChatError('');
    }
  };

  const handleAttachmentChange = async (event) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0 || chatBusy || isMessagesLoading) {
      return;
    }

    const validFiles = files.filter(isSupportedAttachmentFile);

    if (validFiles.length === 0) {
      setChatError('Choisis une image, un GIF ou un sticker.');
      return;
    }

    if (pendingAttachments.length + validFiles.length > MAX_ATTACHMENT_COUNT) {
      setChatError(`Tu peux envoyer au maximum ${MAX_ATTACHMENT_COUNT} medias par message.`);
      return;
    }

    const tooLargeFile = validFiles.find((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);

    if (tooLargeFile) {
      setChatError(
        `Le fichier ${tooLargeFile.name} est trop lourd. Limite: ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)}.`,
      );
      return;
    }

    try {
      const attachments = await Promise.all(
        validFiles.map(async (file) => ({
          id: createAttachmentId(),
          name: file.name,
          mimeType: file.type || 'image/*',
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );

      setPendingAttachments((current) => [...current, ...attachments]);
      setChatError('');
    } catch (error) {
      setChatError(formatError(error));
    }
  };

  const handleRemovePendingAttachment = (attachmentId) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleSendMessage = async () => {
    if (!isOpenRouterConfigured) {
      setChatError(
        "DoudouGPT doit être configuré côté front. Vérifie la clé du moteur dans ton .env.",
      );
      return;
    }

    if (!session?.user?.id) {
      setChatError("Tu dois être connecté pour parler avec DoudouGPT.");
      return;
    }

    const text = composerValue.trim();
    const attachments = pendingAttachments;
    const hasAttachments = attachments.length > 0;

    if ((!text && !hasAttachments) || chatBusy) {
      return;
    }

    if (isMessagesLoading) {
      setChatError('Attend que le fil se charge avant d`\'™envoyer un message.');
      return;
    }

    setChatBusy(true);
    setChatError('');
    setWorkspaceError('');

    try {
      let chatId = activeChatIdRef.current;

      if (!chatId) {
        const newChat = await createChat(session.user.id);
        setChats((current) => [newChat, ...current.filter((chat) => chat.id !== newChat.id)]);
        setActiveChatId(newChat.id);
        chatId = newChat.id;
      }

      const userMessageContent = text || buildAttachmentPlaceholder(attachments);
      const draftUserMessage = {
        role: 'user',
        content: userMessageContent,
        metadata: {
          attachments,
          hasText: Boolean(text),
        },
      };

      const userMessage = await insertChatMessage({
        chatId,
        userId: session.user.id,
        role: 'user',
        content: userMessageContent,
        metadata: draftUserMessage.metadata,
      });

      setComposerValue('');
      setPendingAttachments([]);
      setMessages((current) => [...current, userMessage].slice(-MAX_STORED_MESSAGES));

      const conversationForModel = [
        ...messages,
        draftUserMessage,
      ].slice(-MAX_CONTEXT_MESSAGES);

      const currentChat = chats.find((chat) => chat.id === chatId);
      if (text && (!currentChat || currentChat.title === DEFAULT_CHAT_TITLE)) {
        const nextTitle = summarizeChatTitle(text);

        if (nextTitle !== DEFAULT_CHAT_TITLE) {
          try {
            await renameChatTitle({
              chatId,
              userId: session.user.id,
              title: nextTitle,
            });
          } catch (_renameError) {
            // Le titre reste optionnel. On ne bloque pas l'envoi si la mise à jour échoue.
          }
        }
      }

      const assistantText = await sendOpenRouterChat(conversationForModel);

      const assistantMessage = await insertChatMessage({
        chatId,
        userId: session.user.id,
        role: 'assistant',
        content: assistantText,
      });

      setMessages((current) => [...current, assistantMessage].slice(-MAX_STORED_MESSAGES));
      try {
        await refreshChatsList({ preferredChatId: chatId });
      } catch (_refreshError) {
        // La conversation est bien enregistrée même si la sidebar ne se rafraîchit pas tout de suite.
      }
    } catch (error) {
      setChatError(formatError(error));
    } finally {
      setChatBusy(false);
    }
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  if (!isSupabaseConfigured || !isOpenRouterConfigured) {
    return (
      <div className="app-root">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="orb orb-three" />

        <main className="app-shell">
          <section className="panel panel--auth panel--notice">
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">
                D
              </div>
              <div>
                <p className="eyebrow">DoudouGPT</p>
                <h1>Configuration requise</h1>
              </div>
            </div>

            <p className="lede">
              Renseigne <code>REACT_APP_SUPABASE_URL</code>,{' '}
              <code>REACT_APP_SUPABASE_PUBLISHABLE_KEY</code> et la clé du
              moteur DoudouGPT dans ton fichier <code>.env</code>, puis
              relance l`\'™application.
            </p>

            <div className="notice-card">
              <p className="notice-title">Ce que DoudouGPT attend</p>
              <ul className="notice-list">
                <li>Une URL Supabase valide.</li>
                <li>La clé publishable du projet.</li>
                <li>La clé front du moteur DoudouGPT.</li>
                <li>Un moteur DoudouGPT accessible en direct depuis le navigateur.</li>
              </ul>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="app-root app-root--auth">
        <div className="auth-bg auth-bg--one" />
        <div className="auth-bg auth-bg--two" />
        <div className="auth-bg auth-bg--three" />

        <main className="auth-shell auth-shell--loading">
          <header className="auth-topbar">
            <div className="auth-brand">
              <div className="auth-brand-mark" aria-hidden="true">
                D
              </div>
              <span>DoudouGPT</span>
            </div>
          </header>

          <section className="auth-card auth-card--loading">
            <p className="eyebrow eyebrow--auth">DoudouGPT</p>
            <h1>Connexion sécurisée en cours</h1>
            <p className="auth-lede">On vérifie ta session Supabase avant d&apos;ouvrir le chat.</p>
            <div className="loading-row" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    const isSignup = authMode === 'signup';
    const authTitle = isSignup ? "Crée ton compte" : "Ha, te revoilà !";
    const authSubtitle = isSignup
      ? "On t'embarque direct dans l'espace DoudouGPT. C'est central, rapide, et tout part dans Supabase."
      : "Nous sommes si heureux de te revoir ! Reprends ton fil et ton chat en deux secondes.";
    const authAction = isSignup ? "Créer mon compte" : "Connexion";
    const authSwitchLabel = isSignup ? "Tu as déjà un compte ?" : "Besoin d'un compte ?";
    const authSwitchAction = isSignup ? "Se connecter" : "S'inscrire";
    const authAsideTitle = isSignup ? "Lance ton espace" : "Tu repars d'où tu veux";
    const authAsideText = isSignup
      ? "Les messages, les chats récents et le suivi des conversations restent synchronisés par Supabase. Aucun stockage local, tout est centralisé."
      : "Tu retrouves tes chats récents, tu crées un nouveau salon quand tu veux, et DoudouGPT reste au centre du délire.";

    return (
      <div className="app-root app-root--auth">
        <div className="auth-bg auth-bg--one" />
        <div className="auth-bg auth-bg--two" />
        <div className="auth-bg auth-bg--three" />

        <main className="auth-shell">
          <header className="auth-topbar">
            <div className="auth-brand">
              <div className="auth-brand-mark" aria-hidden="true">
                D
              </div>
              <span>DoudouGPT</span>
            </div>
          </header>

          <section className="auth-card">
            <div className="auth-card__form">
              <p className="eyebrow eyebrow--auth">DoudouGPT</p>
              <h1>{authTitle}</h1>
              <p className="auth-lede">{authSubtitle}</p>

              <form className="auth-form auth-form--discord" onSubmit={handleAuthSubmit}>
                <label className="field field--discord">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={authValues.email}
                    onChange={updateAuthField('email')}
                    placeholder="toi@exemple.com"
                  />
                </label>

                <label className="field field--discord">
                  <span>Mot de passe</span>
                  <input
                    type="password"
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    value={authValues.password}
                    onChange={updateAuthField('password')}
                    placeholder="Au moins 6 caractères"
                  />
                </label>

                {authError ? (
                  <div className="status status--error auth-status" role="alert">
                    {authError}
                  </div>
                ) : null}

                {authMessage ? (
                  <div className="status status--success auth-status" role="status">
                    {authMessage}
                  </div>
                ) : null}

                <div className="auth-form__links">
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() =>
                      setAuthMessage(
                        "Le reset de mot de passe n'est pas encore branché, mais on peut le faire si tu veux.",
                      )
                    }
                  >
                    Mot de passe oublié ?
                  </button>
                </div>

                <button className="button button--primary auth-submit" type="submit" disabled={authBusy}>
                  {authBusy ? 'Traitement...' : authAction}
                </button>
              </form>

              <div className="auth-switch-row">
                <p>{authSwitchLabel}</p>
                <button
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode((current) => (current === 'login' ? 'signup' : 'login'));
                    setAuthError('');
                    setAuthMessage('');
                  }}
                >
                  {authSwitchAction}
                </button>
              </div>
            </div>

            <aside className="auth-card__aside" aria-label="Présentation DoudouGPT">
              <div className="auth-art">
                <div className="auth-art__halo auth-art__halo--one" />
                <div className="auth-art__halo auth-art__halo--two" />
                <div className="auth-art__panel">
                  <div className="auth-art__badge">
                    <span>D</span>
                  </div>
                  <div className="auth-art__copy">
                    <strong>{authAsideTitle}</strong>
                    <p>{authAsideText}</p>
                  </div>
                </div>
              </div>

              <div className="auth-points">
                <div className="auth-point">
                  <span className="auth-point__label">Supabase</span>
                  <span className="auth-point__text">Connexion et chats par compte</span>
                </div>
                <div className="auth-point">
                  <span className="auth-point__label">DoudouGPT</span>
                  <span className="auth-point__text">Une interface de chat sombre, fluide et immersive</span>
                </div>
                <div className="auth-point">
                  <span className="auth-point__label">Sauvegarde cloud</span>
                  <span className="auth-point__text">Supabase garde vos chats synchronisés et accessibles partout</span>
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-root app-root--discord">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="orb orb-three" />

      <main className="discord-shell">
        <nav className="discord-rail" aria-label="Raccourcis">
          <button
            type="button"
            className={`discord-rail-item discord-rail-item--brand ${activeChatId ? '' : 'discord-rail-item--active'}`}
            onClick={handleCreateNewChat}
            disabled={isCreatingChat || chatBusy || isMessagesLoading}
            aria-label="Nouveau chat"
          >
            D
          </button>

          <button
            type="button"
            className="discord-rail-item discord-rail-item--new"
            onClick={handleCreateNewChat}
            disabled={isCreatingChat || chatBusy || isMessagesLoading}
            aria-label="Créer un chat"
          >
            +
          </button>

          <span className="discord-rail-divider" aria-hidden="true" />

          {chats.slice(0, 6).map((chat) => {
            const isActive = chat.id === activeChatId;

            return (
              <button
                key={chat.id}
                type="button"
                className={`discord-rail-item ${isActive ? 'discord-rail-item--active' : ''}`}
                onClick={() => handleSelectChat(chat.id)}
                disabled={chatBusy || isMessagesLoading}
                aria-label={`Ouvrir ${chat.title || DEFAULT_CHAT_TITLE}`}
              >
                {getChatAvatarLabel(chat.title)}
              </button>
            );
          })}
        </nav>

        <aside className="discord-sidebar" aria-label="Chats récents">
          <div className="discord-sidebar__search">
            <label className="discord-search">
              <span className="sr-only">Rechercher ou lancer une conversation</span>
              <input
                type="search"
                value={sidebarQuery}
                onChange={(event) => setSidebarQuery(event.target.value)}
                placeholder="Rechercher ou lancer une conversation"
              />
            </label>
          </div>

          <div className="discord-sidebar__heading">
            <div>
              <p className="eyebrow eyebrow--discord">Messages privés</p>
              <h2>Chats récents</h2>
            </div>

            <button
              className="icon-button"
              type="button"
              onClick={handleCreateNewChat}
              disabled={chatBusy || isCreatingChat || isChatsLoading || isMessagesLoading}
              aria-label="Créer un nouveau chat"
            >
              +
            </button>
          </div>

          {workspaceError ? (
            <div className="status status--error discord-sidebar-error" role="alert">
              {workspaceError}
            </div>
          ) : null}

          <div className="discord-thread-list" role="list">
            {isChatsLoading ? (
              <div className="discord-thread-empty">
                <p>chargement des chats récents...</p>
              </div>
            ) : visibleChats.length === 0 ? (
              <div className="discord-thread-empty">
                <p>aucun résultat.</p>
                <p>essaie un autre mot-clé ou crée un nouveau chat.</p>
              </div>
            ) : (
              visibleChats.map((chat) => {
                const isActive = chat.id === activeChatId;
                const avatarLabel = getChatAvatarLabel(chat.title);

                return (
                  <div
                    key={chat.id}
                    className={`discord-thread ${isActive ? 'discord-thread--active' : ''}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="discord-thread__select"
                      onClick={() => handleSelectChat(chat.id)}
                      disabled={chatBusy || isMessagesLoading}
                    >
                      <span className="discord-thread__avatar" aria-hidden="true">
                        {avatarLabel}
                      </span>

                      <span className="discord-thread__copy">
                        <span className="discord-thread__title">
                          {chat.title || DEFAULT_CHAT_TITLE}
                        </span>
                        <span className="discord-thread__meta">
                          mis à jour le {formatChatTimestamp(chat.updated_at)}
                        </span>
                      </span>
                    </button>

                    <div className="discord-thread__actions" aria-label="Actions du chat">
                      <button
                        type="button"
                        className="icon-button icon-button--small"
                        onClick={() => handleRenameChat(chat)}
                        disabled={chatBusy || isMessagesLoading || isCreatingChat}
                        aria-label={`Renommer ${chat.title || DEFAULT_CHAT_TITLE}`}
                      >
                        ✎
                      </button>

                      <button
                        type="button"
                        className="icon-button icon-button--small icon-button--danger"
                        onClick={() => handleDeleteChat(chat)}
                        disabled={chatBusy || isMessagesLoading || isCreatingChat}
                        aria-label={`Supprimer ${chat.title || DEFAULT_CHAT_TITLE}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="discord-sidebar__footer">
            <div className="discord-user">
              <div className="discord-user__avatar" aria-hidden="true">
                {getUserHandle(session.user.email).slice(0, 1).toUpperCase()}
              </div>

              <div className="discord-user__copy">
                <strong>{getUserHandle(session.user.email)}</strong>
                <span>Connecté via Supabase</span>
              </div>
            </div>

            <button className="button button--ghost discord-user__logout" type="button" onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        </aside>

        <section className="discord-main">
          <header className="discord-topbar">
            <div className="discord-topbar__title">
              <p className="eyebrow eyebrow--discord">Messages privés</p>
              <h1>{activeChat ? activeChat.title || DEFAULT_CHAT_TITLE : 'Nouveau chat'}</h1>
              <p className="discord-topbar__sub">
                {activeChat ? (
                  <>
                    Tu es connecté en tant que <strong>{session.user.email}</strong>.
                  </>
                ) : (
                  <>Crée un nouveau chat et balance ton premier message à DoudouGPT.</>
                )}
              </p>
            </div>

            <div className="discord-topbar__status">
              <div className="status status--neutral discord-status">
                <span className="status-dot" />
                <span>DoudouGPT</span>
              </div>
            </div>
          </header>

          <section className="discord-messages" aria-live="polite" aria-label="Conversation">
            {isMessagesLoading ? (
              <div className="discord-message discord-message--system">
                <div className="discord-message__avatar" aria-hidden="true">
                  D
                </div>
                <div className="discord-message__body">
                  <div className="discord-message__meta">
                    <span className="discord-message__author">DoudouGPT</span>
                    <span className="discord-message__time">chargement...</span>
                  </div>
                  <p>on récupère le fil, tkt.</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="discord-message discord-message--assistant">
                <div className="discord-message__avatar" aria-hidden="true">
                  D
                </div>
                <div className="discord-message__body">
                  <div className="discord-message__meta">
                    <span className="discord-message__author">DoudouGPT</span>
                    <span className="discord-message__time">maintenant</span>
                  </div>
                  <p>{WELCOME_MESSAGE.content}</p>
                </div>
              </div>
            ) : (
              messages.map((message, index) => {
                const isUserMessage = message.role === 'user';
                const isAssistantMessage = message.role === 'assistant';
                const isSystemMessage = message.role === 'system';
                const attachments = getMessageAttachments(message);
                const authorLabel = isUserMessage
                  ? getUserHandle(session.user.email)
                  : isAssistantMessage
                    ? 'DoudouGPT'
                    : 'Système';
                const avatarLabel = isUserMessage
                  ? getUserHandle(session.user.email).slice(0, 1).toUpperCase()
                  : isAssistantMessage
                    ? 'D'
                    : 'S';

                return (
                  <div
                    key={`${message.role}-${index}`}
                    className={`discord-message ${isUserMessage ? 'discord-message--user' : ''} ${isAssistantMessage ? 'discord-message--assistant' : ''} ${isSystemMessage ? 'discord-message--system' : ''}`}
                  >
                    <div className="discord-message__avatar" aria-hidden="true">
                      {avatarLabel}
                    </div>

                    <div className="discord-message__body">
                      <div className="discord-message__meta">
                        <span className="discord-message__author">{authorLabel}</span>
                        <span className="discord-message__time">
                          {formatMessageTimestamp(message.created_at) || 'à l’instant'}
                        </span>
                      </div>
                      {shouldDisplayMessageContent(message) ? <p>{message.content}</p> : null}

                      {attachments.length > 0 ? (
                        <div className="discord-message__attachments" role="list" aria-label="Medias joints">
                          {attachments.map((attachment, attachmentIndex) => (
                            <figure className="discord-message-attachment" key={attachment.id} role="listitem">
                              <img
                                className="discord-message-attachment__media"
                                src={attachment.dataUrl}
                                alt={attachment.name || `Media ${attachmentIndex + 1}`}
                              />
                              <figcaption className="discord-message-attachment__caption">
                                {attachment.name || `Media ${attachmentIndex + 1}`}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}

            <div ref={bottomRef} />
          </section>

          {chatBusy ? (
            <div className="discord-typing" aria-live="polite">
              <div className="discord-message__avatar" aria-hidden="true">
                D
              </div>

              <div className="discord-typing__copy">
                <strong>DoudouGPT</strong> est en train d&apos;écrire
                <span className="typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          ) : null}

          <footer className="discord-composer">
            {pendingAttachments.length > 0 ? (
              <div className="composer-attachments" role="list" aria-label="Pieces jointes">
                {pendingAttachments.map((attachment) => (
                  <div className="composer-attachment" key={attachment.id} role="listitem">
                    <button
                      type="button"
                      className="composer-attachment__remove"
                      onClick={() => handleRemovePendingAttachment(attachment.id)}
                      aria-label={`Retirer ${attachment.name}`}
                    >
                      x
                    </button>

                    <img
                      className="composer-attachment__media"
                      src={attachment.dataUrl}
                      alt={attachment.name || 'Media joint'}
                    />

                    <div className="composer-attachment__meta">
                      <strong>{attachment.name || 'Media joint'}</strong>
                      <span>{formatBytes(attachment.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="composer-shell">
              <button
                type="button"
                className="composer-rail composer-rail--left composer-upload-button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={chatBusy || isMessagesLoading}
                aria-label="Ajouter une image, un GIF ou un sticker"
              >
                +
              </button>

              <input
                ref={attachmentInputRef}
                className="composer-file-input"
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                onChange={handleAttachmentChange}
                tabIndex={-1}
              />

              <label className="composer-field">
                <span className="sr-only">Votre message</span>
                <textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Envoyer un message à DoudouGPT"
                  rows={1}
                />
              </label>

              <div className="composer-rail composer-rail--right" aria-hidden="true">
              </div>

              <button
                className="composer-send"
                type="button"
                onClick={handleSendMessage}
                disabled={
                  chatBusy ||
                  isMessagesLoading ||
                  (composerValue.trim().length === 0 && pendingAttachments.length === 0)
                }
                aria-label="Envoyer le message"
              >
                ↗
              </button>
            </div>

            <div className="composer-footer">
              <p>Shift + Entrée pour aller à la ligne. Clique sur + pour ajouter une image, un GIF ou un sticker.</p>
              {chatError ? (
                <p className="composer-error" role="status">
                  {chatError}
                </p>
              ) : (
                <p>
                  Tout est stocke dans Supabase par compte. Rien n&apos;est garde en local.
                </p>
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;
