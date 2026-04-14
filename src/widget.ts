(function() {
  'use strict';

  // Escape HTML to prevent XSS
  function escapeHtml(str: string): string {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  // Validate color hex
  function isValidColor(c: string): boolean { return /^#[0-9A-Fa-f]{6}$/.test(c); }
  function isValidPosition(p: string): boolean { return /^(top|bottom)-(left|right)$/.test(p); }
  function isSafeUrl(url: string): boolean { return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://')); }

  // Detect API URL from script source
  function getApiUrl(): string {
    const script = document.currentScript as HTMLScriptElement;
    if (script?.src) {
      try {
        const url = new URL(script.src);
        return `${url.protocol}//${url.host}`;
      } catch (e) {}
    }
    return 'https://api.ghostchat.dev';
  }

  // Get WebSocket URL from API URL
  function getWsUrl(apiUrl: string): string {
    return apiUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';
  }

  const API_URL = getApiUrl();
  const WS_URL = getWsUrl(API_URL);

  // Simple notification sound (short ding)
  function playNotificationSound() {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // Hz
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // Audio not supported or blocked
    }
  }

  // Simple WebSocket client for real-time updates
  class WidgetWebSocket {
    private ws: WebSocket | null = null;
    private channel: string;
    private siteId: string;
    private onMessageCallback?: (message: any) => void;
    private onTypingCallback?: (typing: boolean) => void;
    private onConnectCallback?: () => void;
    private onTranslationCallback?: (event: { messageId: string; translatedContent: string }) => void;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isDisconnecting = false;

    constructor(channel: string, siteId: string) {
      this.channel = channel;
      this.siteId = siteId;
    }

    connect() {
      this.isDisconnecting = false;
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      try {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
          this.ws.close();
        }

        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              type: 'subscribe',
              channel: this.channel,
              siteId: this.siteId,
              isVisitor: true,
              sessionSecret: getSessionSecret() || undefined,
            }));
            if (this.onConnectCallback) this.onConnectCallback();
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'new_message' && data.message && this.onMessageCallback) {
              // Only show messages from OWNER (not our own VISITOR messages)
              if (data.message.sender === 'OWNER') {
                this.onMessageCallback(data.message);
              }
            } else if (data.type === 'typing' && this.onTypingCallback) {
              this.onTypingCallback(data.typing);
            } else if (data.type === 'translation_update' && this.onTranslationCallback) {
              this.onTranslationCallback({ messageId: data.messageId, translatedContent: data.translatedContent });
            }
          } catch (e) {
            // Ignore parse errors
          }
        };

        this.ws.onerror = () => {
          // Silently handle errors
        };

        this.ws.onclose = () => {
          if (!this.isDisconnecting) {
            this.reconnect();
          }
        };
      } catch (e) {
        if (!this.isDisconnecting) {
          this.reconnect();
        }
      }
    }

    private reconnect() {
      if (this.isDisconnecting) return;
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectTimeout = setTimeout(() => {
          if (!this.isDisconnecting) {
            this.connect();
          }
        }, delay);
      }
    }

    onMessage(callback: (message: any) => void) {
      this.onMessageCallback = callback;
    }

    onTyping(callback: (typing: boolean) => void) {
      this.onTypingCallback = callback;
    }

    onConnect(callback: () => void) {
      this.onConnectCallback = callback;
    }

    onTranslation(callback: (event: { messageId: string; translatedContent: string }) => void) {
      this.onTranslationCallback = callback;
    }

    updateChannel(channel: string) {
      this.channel = channel;
      // Re-subscribe if already connected
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'subscribe',
          channel: this.channel,
          siteId: this.siteId,
          isVisitor: true,
          sessionSecret: getSessionSecret() || undefined,
        }));
      }
    }

    send(data: any) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
      }
    }

    disconnect() {
      this.isDisconnecting = true;
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.ws) {
        if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
        this.ws = null;
      }
    }
  }

  // Generate UUID
  function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Safe localStorage wrapper — falls back to in-memory store when blocked
  const memStore: Record<string, string> = {};
  function storageGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return memStore[key] || null; }
  }
  function storageSet(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    memStore[key] = value;
  }
  // Get or create session ID
  function getSessionId(): string {
    const key = 'ghostchat_session_id';
    let sessionId = storageGet(key);
    if (!sessionId) {
      sessionId = generateUUID();
      storageSet(key, sessionId);
    }
    return sessionId;
  }

  // Get/set session secret for IDOR protection
  function getSessionSecret(): string | null {
    return storageGet('ghostchat_session_secret');
  }
  function setSessionSecret(secret: string) {
    storageSet('ghostchat_session_secret', secret);
  }

  // Get saved email
  function getSavedEmail(): string | null {
    return storageGet('ghostchat_email');
  }

  // Save email
  function saveEmail(email: string) {
    storageSet('ghostchat_email', email);
  }

  // Get saved name
  function getSavedName(): string | null {
    return storageGet('ghostchat_name');
  }

  // Save name
  function saveName(name: string) {
    storageSet('ghostchat_name', name);
  }

  // Get site ID from script tag
  function getSiteId(): string | null {
    let script = document.currentScript as HTMLScriptElement;
    if (script?.getAttribute('data-site')) return script.getAttribute('data-site');
    const scripts = document.querySelectorAll('script[data-site]');
    if (scripts.length > 0) {
      return (scripts[scripts.length - 1] as HTMLScriptElement).getAttribute('data-site');
    }
    return null;
  }

  // Fetch session config
  async function fetchSessionConfig(siteId: string, sessionId: string): Promise<any> {
    try {
      const response = await fetch(`${API_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, sessionId, pageUrl: window.location.href, referrer: document.referrer || undefined }),
      });
      if (!response.ok) return null;
      return response.json();
    } catch (e) {
          return null;
        }
  }

  // Fetch widget config only (no DB session created)
  async function fetchWidgetConfig(siteId: string): Promise<any> {
    try {
      const response = await fetch(`${API_URL}/session/config?siteId=${encodeURIComponent(siteId)}`);
      if (!response.ok) return null;
      return response.json();
    } catch (e) {
      return null;
    }
  }

  // Load messages
  async function loadMessages(sessionId: string, siteId: string): Promise<any[]> {
    try {
      let url = `${API_URL}/messages/visitor/${sessionId}?siteId=${encodeURIComponent(siteId)}`;
      const secret = getSessionSecret();
      if (secret) url += `&sessionSecret=${encodeURIComponent(secret)}`;
      const response = await fetch(url);
      if (!response.ok) return [];
      return response.json();
    } catch (e) {
      return [];
    }
  }

  // Send message (with optional image)
  async function sendMessage(dbSessionId: string, content: string, imageUrl?: string): Promise<any> {
    const payload: any = { sessionId: dbSessionId, content, pageUrl: window.location.href };
    if (imageUrl) payload.imageUrl = imageUrl;
    const secret = getSessionSecret();
    if (secret) payload.sessionSecret = secret;
    const response = await fetch(`${API_URL}/messages/visitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('Failed to send');
    return response.json();
  }

  // Upload image for visitor
  async function uploadVisitorImage(dbSessionId: string, file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', dbSessionId);
    const secret = getSessionSecret();
    if (secret) formData.append('sessionSecret', secret);
    const response = await fetch(`${API_URL}/attachments/visitor`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    const data = await response.json();
    return data.url;
  }

  // Save visitor info (name and/or email) to session
  async function saveVisitorInfo(dbSessionId: string, email?: string, name?: string): Promise<boolean> {
    if (!email && !name) return false;
    try {
      const payload: any = { sessionId: dbSessionId };
      if (email) payload.email = email;
      if (name) payload.name = name;
      const secret = getSessionSecret();
      if (secret) payload.sessionSecret = secret;
      const response = await fetch(`${API_URL}/session/email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  // Format time
  function formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Initialize widget
  async function init() {
    if (document.getElementById('ghostchat-root')) return; // Already initialized
    const siteId = getSiteId();
    if (!siteId) return;

    const sessionId = getSessionId();
    const configData = await fetchWidgetConfig(siteId);
    if (!configData) return;

    const { widgetSettings, ownerAvailable, hideBranding, nextAvailable } = configData;

    // UI strings (English-only — re-add i18n if paying users request it)
    const strings: Record<string, string> = { chatWithUs: 'Chat with us', sendMessage: 'Send a message...', sendMessageAway: 'Add your email to send a message', emptyTitle: 'Hey! Drop us a message.', emptySubtitle: "We'll get back to you fast.", awayEmptySubtitle: 'We\'ll reply as soon as we\'re back.', loading: 'Loading...', online: 'Online', leaveMessage: nextAvailable ? `Back ${nextAvailable}` : 'Away — leave a message', yourEmail: 'Your email (optional)', yourEmailRequired: 'Your email (required)', yourName: 'Your name (optional)', save: 'Save', editInfo: 'Edit your info', noResponsePrompt: "Want to make sure we don't miss you? Leave your email as a backup.", addLaterHint: 'Add your name or email anytime via the ••• menu' };
    const t = (key: string): string => strings[key];
    let dbSessionId: string | null = null;
    let sessionCreating: Promise<string | null> | null = null;

    // Lazy, idempotent session creation — only called when chat opens or message sent
    async function ensureSession(): Promise<string | null> {
      if (dbSessionId) return dbSessionId;
      if (sessionCreating) return sessionCreating;
      sessionCreating = (async () => {
        try {
          const data = await fetchSessionConfig(siteId, sessionId);
          if (!data) return null;
          dbSessionId = data.id;
          // Store session secret for IDOR protection
          if (data.sessionSecret) setSessionSecret(data.sessionSecret);
          // Update WebSocket channel to the real session
          ws.updateChannel(`session:${dbSessionId}`);
          // Sync saved email/name to server
          const savedEmail = getSavedEmail();
          const savedName = getSavedName();
          if ((savedEmail || savedName) && dbSessionId) saveVisitorInfo(dbSessionId, savedEmail || undefined, savedName || undefined);
          // Sync visitorEmail from server
          if (data.visitorEmail && !getSavedEmail()) {
            saveEmail(data.visitorEmail);
            hasEmail = true;
          }
          // Sync visitorName from server
          if (data.visitorName && !getSavedName()) {
            saveName(data.visitorName);
            hasName = true;
          }
          return dbSessionId;
        } catch (e) {
          return null;
        } finally {
          sessionCreating = null;
        }
      })();
      return sessionCreating;
    }
    const color = isValidColor(widgetSettings?.color) ? widgetSettings.color : '#2563eb';
    const position = isValidPosition(widgetSettings?.position) ? widgetSettings.position : 'bottom-right';
    const iconKey = widgetSettings?.icon || 'chat';
    const awayMessage = widgetSettings?.awayMessage || "We're currently away but will get back to you soon.";
    const quickLinks: { label: string; url: string }[] = Array.isArray(widgetSettings?.quickLinks) ? widgetSettings.quickLinks : [];
    const siteName = widgetSettings?.siteName || 'Chat';
    const showBranding = !hideBranding;
    const GP = "M12 2C7.58 2 4 5.58 4 10V20L5.5 18.5L7 20L8.5 18.5L10 20L11.5 18.5L13 20L14.5 18.5L16 20L17.5 18.5L19 20L20 10C20 5.58 16.42 2 12 2Z";

    // Embed mode: render inline inside a user-provided container
    const embedContainer = document.getElementById('ghostchat-embed');
    const embedMode = !!embedContainer;

    // Bubble icon SVG map
    const ICON_SVGS: Record<string, string> = {
      'chat': '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"/></svg>',
      'message-circle': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
      'headset': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>',
      'help-circle': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      'ghost': `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${GP}"/><circle cx="9" cy="10" r="1.4" fill="${color}"/><circle cx="15" cy="10" r="1.4" fill="${color}"/></svg>`,
    };
    const bubbleIconSvg = ICON_SVGS[iconKey] || ICON_SVGS['chat'];

    // Header icon SVG map (white on colored background, 16x16 for header context)
    const HEADER_ICON_SVGS: Record<string, string> = {
      'chat': '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"/></svg>',
      'message-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
      'headset': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>',
      'help-circle': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      'ghost': `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="${GP}"/><circle cx="9" cy="10" r="1.2" fill="#0f172a"/><circle cx="15" cy="10" r="1.2" fill="#0f172a"/></svg>`,
    };
    const headerIconSvg = HEADER_ICON_SVGS[iconKey] || HEADER_ICON_SVGS['chat'];
    
    let isOpen = false;
    // Check for email/name from localStorage (server syncs after ensureSession)
    let hasEmail = !!getSavedEmail();
    let hasName = !!getSavedName();
    let messages: any[] = [];
    let showEmailInHelper = false; // "Get back by email" or no-response
    let emailDismissed = false; // Visitor dismissed email prompt for this session
    let lastVisitorMessageAt: number | null = null;
    let hasSentMessage = false;
    let imageUploadCount = 0;
    const MAX_IMAGE_UPLOADS = 5;
    const NO_RESPONSE_MS = 2 * 60 * 1000;
    
    // Setup WebSocket for real-time updates (lazy — only connects when chat opens)
    // Channel starts empty; updated to real session after ensureSession()
    const ws = new WidgetWebSocket('', siteId);
    let wsConnected = false;
    let wsIdleTimeout: ReturnType<typeof setTimeout> | null = null;
    const WS_IDLE_MS = 2 * 60 * 1000; // Disconnect after 2 min idle (chat closed)

    let typingTimeout: ReturnType<typeof setTimeout> | null = null;

    ws.onMessage((message) => {
      const exists = messages.some(m => m.id === message.id);
      if (!exists) {
        messages.push(message);
        if (message.sender === 'OWNER') {
          lastVisitorMessageAt = null;
          showEmailInHelper = false;
          renderHelper();
        }
        renderMessages();
        playNotificationSound();
        hideTypingIndicator();
        if (!isOpen) {
          const indicator = document.getElementById('ghostchat-unread');
          if (indicator) indicator.style.display = 'flex';
        }
      }
    });

    ws.onTranslation((event) => {
      const msg = messages.find(m => m.id === event.messageId);
      if (msg) {
        msg.translatedContent = event.translatedContent;
        renderMessages();
      }
    });

    ws.onTyping((typing) => {
      if (typingTimeout) { clearTimeout(typingTimeout); typingTimeout = null; }
      if (typing) {
        showTypingIndicator();
        typingTimeout = setTimeout(hideTypingIndicator, 4000);
      } else {
        hideTypingIndicator();
      }
    });

    // Re-send visitor context on reconnect
    ws.onConnect(() => {
      if (currentContext) sendContext();
    });

    function connectWs() {
      if (!wsConnected) {
        ws.connect();
        wsConnected = true;
      }
      // Clear any pending idle disconnect
      if (wsIdleTimeout) { clearTimeout(wsIdleTimeout); wsIdleTimeout = null; }
    }

    function scheduleWsDisconnect() {
      // After chat closes, keep WS alive briefly for incoming replies, then disconnect
      if (wsIdleTimeout) clearTimeout(wsIdleTimeout);
      wsIdleTimeout = setTimeout(() => {
        ws.disconnect();
        wsConnected = false;
      }, WS_IDLE_MS);
    }

    // No-response timer: show email fallback in helper after 2 min
    const noResponseCheck = () => {
      if (messages.length === 0 || !lastVisitorMessageAt) return;
      const last = messages[messages.length - 1];
      if (last.sender !== 'VISITOR') return;
      if (Date.now() - lastVisitorMessageAt >= NO_RESPONSE_MS) {
        showEmailInHelper = true;
        renderHelper();
        updateUI();
      }
    };
    const noResponseInterval = setInterval(noResponseCheck, 30000);

    // Reconnect WS when tab becomes visible again (if chat is open)
    // Note: we do NOT disconnect on hidden — owner replies must arrive while user is on another tab
    const handleVisibilityChange = () => {
      if (!document.hidden && isOpen) {
        connectWs();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on page unload
    const escapeHandler = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen && !embedMode) close(); };
    const menuDismissHandler = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('#ghostchat-form-actions')) menuDropdown.style.display = 'none'; };
    const cleanup = () => {
      ws.disconnect();
      wsConnected = false;
      if (typingTimeout) clearTimeout(typingTimeout);
      if (wsIdleTimeout) clearTimeout(wsIdleTimeout);
      if (visitorTypingTimeout) clearTimeout(visitorTypingTimeout);
      if (contextThrottleTimer) clearTimeout(contextThrottleTimer);
      clearInterval(noResponseInterval);
      clearImagePreview();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('keydown', escapeHandler);
      document.removeEventListener('click', menuDismissHandler as EventListener);
      window.removeEventListener('popstate', onUrlChange);
      window.removeEventListener('hashchange', onUrlChange);
      history.pushState = origPushState;
      history.replaceState = origReplaceState;
    };
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
    
    // Create bubble — chat icon (skip in embed mode)
    let bubble: HTMLDivElement | null = null;
    if (!embedMode) {
      bubble = document.createElement('div');
      bubble.id = 'ghostchat-bubble';
      bubble.setAttribute('role', 'button');
      bubble.setAttribute('tabindex', '0');
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.innerHTML = `
        ${bubbleIconSvg}
        <div id="ghostchat-unread" style="display:none;position:absolute;top:-2px;right:-2px;width:16px;height:16px;background:#ef4444;border-radius:50%;font-size:10px;font-weight:700;color:white;align-items:center;justify-content:center;border:2px solid ${color};">!</div>
      `;
      bubble.style.cssText = `
        position: fixed;
        ${position.includes('left') ? 'left: 20px;' : 'right: 20px;'}
        ${position.includes('top') ? 'top: 20px;' : 'bottom: 20px;'}
        width: 52px; height: 52px;
        background: ${color}; color: white;
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        z-index: 9998;
        transition: transform 0.15s, box-shadow 0.15s;
        border: 1px solid rgba(255,255,255,0.08);
      `;
      bubble.onmouseenter = () => { bubble!.style.transform = 'scale(1.08)'; bubble!.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)'; };
      bubble.onmouseleave = () => { bubble!.style.transform = 'scale(1)'; bubble!.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'; };
      bubble.onfocus = () => { bubble!.style.outline = `3px solid ${color}`; bubble!.style.outlineOffset = '3px'; };
      bubble.onblur = () => { bubble!.style.outline = 'none'; };

      // Hide bubble on scroll (mobile only) — reappears when scrolling stops
      if ('ontouchstart' in window) {
        let scrollTimer: ReturnType<typeof setTimeout> | null = null;
        window.addEventListener('scroll', () => {
          if (isOpen || !bubble) return;
          bubble.style.opacity = '0';
          bubble.style.pointerEvents = 'none';
          if (scrollTimer) clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            if (bubble) { bubble.style.opacity = '1'; bubble.style.pointerEvents = 'auto'; }
          }, 600);
        }, { passive: true });
        bubble.style.transition = 'transform 0.15s, box-shadow 0.15s, opacity 0.3s';
      }

      // One-time subtle pulse — ghost "materializing" on page load
      const pulseStyle = document.createElement('style');
      pulseStyle.textContent = '@keyframes gcPulse{0%{transform:scale(1);box-shadow:0 2px 8px rgba(0,0,0,0.3)}50%{transform:scale(1.12);box-shadow:0 0 20px rgba(255,255,255,0.1),0 4px 16px rgba(0,0,0,0.4)}100%{transform:scale(1);box-shadow:0 2px 8px rgba(0,0,0,0.3)}}';
      document.head.appendChild(pulseStyle);
      bubble.style.animation = 'gcPulse 1.5s ease-in-out 3s 2';

      // One-time tooltip — fades in after 5s, auto-dismisses after 4s, once per session
      if (!storageGet('ghostchat_tooltip_shown')) {
        setTimeout(() => {
          if (isOpen) return; // Don't show if chat is already open
          const tooltip = document.createElement('div');
          tooltip.id = 'ghostchat-tooltip';
          const isLeft = position.includes('left');
          const isTop = position.includes('top');
          tooltip.textContent = t('chatWithUs');
          tooltip.style.cssText = `
            position:fixed;
            ${isLeft ? 'left:80px;' : 'right:80px;'}
            ${isTop ? 'top:28px;' : 'bottom:28px;'}
            background:#1e293b;color:#e2e8f0;
            font-size:13px;font-family:system-ui,sans-serif;font-weight:500;
            padding:8px 14px;border-radius:8px;
            box-shadow:0 2px 12px rgba(0,0,0,0.3);
            border:1px solid rgba(255,255,255,0.08);
            z-index:9998;
            opacity:0;transition:opacity 0.4s ease;
            pointer-events:none;
            white-space:nowrap;
          `;
          document.body.appendChild(tooltip);
          requestAnimationFrame(() => { tooltip.style.opacity = '1'; });
          storageSet('ghostchat_tooltip_shown', '1');
          setTimeout(() => {
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.remove(), 400);
          }, 4000);
        }, 5000);
      }
    }

    // Create window — dark, minimal
    const chatWindow = document.createElement('div');
    chatWindow.id = 'ghostchat-window';
    chatWindow.setAttribute('role', 'dialog');
    chatWindow.setAttribute('aria-label', 'Chat with us');
    chatWindow.innerHTML = `
      <div id="ghostchat-header" style="background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:12px 12px 0 0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:28px;height:28px;background:${color};border-radius:8px;display:flex;align-items:center;justify-content:center;">
              ${headerIconSvg}
            </div>
            <div>
              <div style="font-weight:600;font-size:14px;color:#f1f5f9;letter-spacing:-0.01em;">${escapeHtml(siteName)}</div>
              <div style="font-size:11px;color:#64748b;display:flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:50%;background:${ownerAvailable ? '#22c55e' : '#f59e0b'};display:inline-block;flex-shrink:0;"></span>${ownerAvailable ? t('online') : t('leaveMessage')}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:2px;">
            <div id="ghostchat-form-actions" style="position:relative;">
              <button type="button" id="ghostchat-menu-btn" style="background:transparent;border:none;color:#64748b;cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;width:28px;height:28px;transition:color 0.15s;" title="More options" aria-label="More options" onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='#64748b'"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg></button>
              <div id="ghostchat-menu-dropdown" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:4px;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10;">
                <button type="button" id="ghostchat-menu-email" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border:none;background:transparent;color:#e2e8f0;font-size:13px;cursor:pointer;border-radius:6px;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='transparent'">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>
                  <span id="ghostchat-menu-email-label">${t('editInfo')}</span>
                </button>
              </div>
            </div>
            <button id="ghostchat-close" aria-label="Close chat" style="background:transparent;border:none;color:#64748b;cursor:pointer;padding:4px;border-radius:6px;${embedMode ? 'display:none;' : 'display:flex;'}align-items:center;justify-content:center;width:28px;height:28px;transition:color 0.15s;" onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='#64748b'"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
          </div>
        </div>
      </div>
      <div id="ghostchat-away-banner" style="display:none;background:#1e293b;padding:8px 12px;font-size:12px;color:#94a3b8;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#f59e0b;">●</span> <span id="ghostchat-away-text"></span></div>
      <div id="ghostchat-messages" role="log" aria-live="polite" style="${embedMode ? 'flex:1;min-height:0;' : 'height:280px;'}overflow-y:auto;padding:16px;background:#111827;"></div>
      <div id="ghostchat-helper" style="display:none;padding:8px 12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.06);"></div>
      <div id="ghostchat-info-section" style="display:none;padding:8px 12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.06);">
        <form id="ghostchat-info-form" style="display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;justify-content:flex-end;">
            <button type="button" id="ghostchat-dismiss-info" style="background:none;border:none;color:#475569;cursor:pointer;font-size:18px;padding:0;line-height:1;" title="Dismiss">&times;</button>
          </div>
          <input id="ghostchat-name" type="text" placeholder="${t('yourName')}" autocomplete="name"
            style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;transition:border-color 0.15s;" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#1e293b'">
          <input id="ghostchat-email" type="email" placeholder="${t('yourEmail')}" autocomplete="email"
            style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;transition:border-color 0.15s;" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#1e293b'">
          <div style="display:flex;justify-content:flex-end;margin:0 8px;">
            <button type="submit" style="background:${color};color:white;border:none;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:500;font-size:12px;transition:opacity 0.15s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">${t('save')}</button>
          </div>
        </form>
      </div>
      <div id="ghostchat-image-preview" style="display:none;padding:8px 12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.06);"></div>
      <form id="ghostchat-form" style="display:block;padding:12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.06);">
        <input type="file" id="ghostchat-file-input" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" id="ghostchat-attach" title="Attach image" aria-label="Attach file" style="background:transparent;border:none;color:#64748b;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:color 0.15s;flex-shrink:0;" onmouseover="this.style.color='#e2e8f0'" onmouseout="this.style.color='#64748b'">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <textarea id="ghostchat-input" placeholder="${t('sendMessage')}" rows="1" maxlength="5000"
            style="flex:1;padding:10px 14px;border:1px solid #1e293b;border-radius:10px;font-size:14px;outline:none;background:#1e293b;color:#f1f5f9;transition:border-color 0.15s;resize:none;overflow-y:hidden;height:auto;min-height:0;max-height:72px;line-height:1.4;font-family:inherit;box-sizing:border-box;" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#1e293b'"></textarea>
          <button type="submit" id="ghostchat-send" aria-label="Send message" style="background:${color};color:white;border:none;padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:500;font-size:14px;display:flex;align-items:center;justify-content:center;transition:opacity 0.15s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </div>
      </form>
      ${showBranding ? `
      <div style="text-align:center;padding:6px;background:#0b1120;border-top:1px solid rgba(255,255,255,0.04);border-radius:0 0 12px 12px;">
        <a href="https://ghostchat.dev" target="_blank" rel="noopener" style="color:#475569;text-decoration:none;font-size:10px;letter-spacing:0.02em;transition:color 0.15s;" onmouseover="this.style.color='#94a3b8'" onmouseout="this.style.color='#475569'">
          ⚡ <span style="font-weight:500;">GhostChat</span>
        </a>
      </div>
      ` : ''}
    `;
    if (embedMode) {
      chatWindow.style.cssText = `
        position: relative;
        width: 100%; height: 100%;
        background: #111827;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        display: flex; flex-direction: column;
        border: 1px solid rgba(255,255,255,0.06);
        font-family: system-ui, sans-serif;
        overflow: hidden;
      `;
      embedContainer!.appendChild(chatWindow);
    } else {
      chatWindow.style.cssText = `
        position: fixed;
        ${position.includes('left') ? 'left: 20px;' : 'right: 20px;'}
        ${position.includes('top') ? 'top: 84px;' : 'bottom: 84px;'}
        width: 350px; max-width: calc(100vw - 40px);
        background: #111827;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        z-index: 9999;
        display: none;
        max-height: calc(100vh - 120px);
        border: 1px solid rgba(255,255,255,0.06);
        font-family: system-ui, sans-serif;
      `;
      document.body.appendChild(bubble!);
      document.body.appendChild(chatWindow);
    }
    
    const messagesDiv = document.getElementById('ghostchat-messages')!;
    const helperDiv = document.getElementById('ghostchat-helper')!;
    const infoSection = document.getElementById('ghostchat-info-section')!;
    const infoForm = document.getElementById('ghostchat-info-form')!;
    const nameInput = document.getElementById('ghostchat-name') as HTMLInputElement;
    const emailInput = document.getElementById('ghostchat-email') as HTMLInputElement;
    const messageForm = document.getElementById('ghostchat-form')!;
    const messageInput = document.getElementById('ghostchat-input') as HTMLTextAreaElement;
    const closeBtn = document.getElementById('ghostchat-close')!;
    const menuBtn = document.getElementById('ghostchat-menu-btn')!;
    const menuDropdown = document.getElementById('ghostchat-menu-dropdown')!;
    const menuEmailBtn = document.getElementById('ghostchat-menu-email')!;
    const menuEmailLabel = document.getElementById('ghostchat-menu-email-label')!;
    const fileInput = document.getElementById('ghostchat-file-input') as HTMLInputElement;
    const attachBtn = document.getElementById('ghostchat-attach')!;
    const imagePreviewDiv = document.getElementById('ghostchat-image-preview')!;
    let pendingImageFile: File | null = null;

    // Typing indicator
    function showTypingIndicator() {
      let el = document.getElementById('ghostchat-typing');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ghostchat-typing';
        el.style.cssText = 'padding:4px 0 8px;display:flex;align-items:center;gap:6px;';
        el.innerHTML = `
          <div style="background:#1e293b;border-radius:12px;padding:8px 14px;display:flex;align-items:center;gap:4px;">
            <span style="width:6px;height:6px;border-radius:50%;background:#64748b;animation:gcDot 1.2s infinite;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:#64748b;animation:gcDot 1.2s infinite 0.2s;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:#64748b;animation:gcDot 1.2s infinite 0.4s;"></span>
          </div>`;
        // Add animation keyframes once
        if (!document.getElementById('ghostchat-typing-style')) {
          const style = document.createElement('style');
          style.id = 'ghostchat-typing-style';
          style.textContent = '@keyframes gcDot{0%,60%,100%{opacity:.3;transform:scale(1)}30%{opacity:1;transform:scale(1.2)}}';
          document.head.appendChild(style);
        }
      }
      const container = messagesDiv;
      if (container && !container.contains(el)) {
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
      }
    }

    function hideTypingIndicator() {
      const el = document.getElementById('ghostchat-typing');
      if (el) el.remove();
    }

    // Dismiss email prompt for this session
    function bindDismissHelper() {
      const btn = document.getElementById('ghostchat-dismiss-helper');
      if (btn) btn.onclick = () => {
        emailDismissed = true;
        showEmailInHelper = false;
        renderHelper();
        updateUI();
      };
    }

    // Bind helper form (shared for away, 5-min, and no-response)
    function bindHelperEmailForm() {
      const helperForm = document.getElementById('ghostchat-helper-email-form');
      const helperEmailInput = document.getElementById('ghostchat-helper-email') as HTMLInputElement | null;
      const helperNameInput = document.getElementById('ghostchat-helper-name') as HTMLInputElement | null;
      if (!helperForm) return;
      helperForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = helperEmailInput?.value.trim() || '';
        const name = helperNameInput?.value.trim() || '';
        // When away, email is required
        if (!ownerAvailable && !email) return;
        if (!email && !name) return;
        const submitBtn = helperForm.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        if (submitBtn) { submitBtn.textContent = '...'; submitBtn.disabled = true; }
        const sid = await ensureSession();
        if (sid) await saveVisitorInfo(sid, email || undefined, name || undefined);
        if (email) { saveEmail(email); hasEmail = true; }
        if (name) { saveName(name); hasName = true; }
        showEmailInHelper = false;
        renderHelper();
        updateUI();
        messageInput.focus();
        if (submitBtn) { submitBtn.textContent = t('save'); submitBtn.disabled = false; }
      };
    }

    // Render helper slot: (1) 5-min / get-back-by-email, (2) away email collector, (3) quick links when online
    function renderHelper() {
      // No-response prompt: name+email collector (matches away form)
      if (ownerAvailable && showEmailInHelper && !(hasEmail || hasName) && !emailDismissed && !hasSentMessage) {
        helperDiv.style.display = 'block';
        helperDiv.innerHTML = `
          <form id="ghostchat-helper-email-form" style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <p style="margin:0;font-size:12px;color:#94a3b8;flex:1;">${t('noResponsePrompt')}</p>
              <button type="button" id="ghostchat-dismiss-helper" style="background:none;border:none;color:#475569;cursor:pointer;padding:0 0 0 8px;font-size:16px;line-height:1;" title="Dismiss">&times;</button>
            </div>
            <input id="ghostchat-helper-name" type="text" placeholder="${t('yourName')}" autocomplete="name"
              style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;box-sizing:border-box;">
            <input id="ghostchat-helper-email" type="email" placeholder="${t('yourEmail')}" autocomplete="email"
              style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;box-sizing:border-box;">
            <div style="display:flex;justify-content:flex-end;margin:0 8px;">
              <button type="submit" style="background:${color};color:white;border:none;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:500;font-size:12px;">${t('save')}</button>
            </div>
          </form>
        `;
        bindHelperEmailForm();
        bindDismissHelper();
        return;
      }
      // Away: name+email collector in helper slot — email required before sending
      if (!ownerAvailable && !hasEmail && !hasSentMessage) {
        helperDiv.style.display = 'block';
        helperDiv.innerHTML = `
          <form id="ghostchat-helper-email-form" style="display:flex;flex-direction:column;gap:6px;">
            <p style="margin:0 8px;font-size:12px;color:#94a3b8;">Leave your email so we can get back to you.</p>
            <input id="ghostchat-helper-name" type="text" placeholder="${t('yourName')}" autocomplete="name"
              style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;box-sizing:border-box;">
            <input id="ghostchat-helper-email" type="email" placeholder="${t('yourEmailRequired')}" autocomplete="email" required
              style="margin:0 8px;padding:7px 10px;border:1px solid #1e293b;border-radius:8px;font-size:12px;outline:none;background:#1e293b;color:#e2e8f0;box-sizing:border-box;">
            <div style="display:flex;justify-content:flex-end;margin:0 8px;">
              <button type="submit" style="background:${color};color:white;border:none;padding:7px 14px;border-radius:8px;cursor:pointer;font-weight:500;font-size:12px;">${t('save')}</button>
            </div>
          </form>
        `;
        bindHelperEmailForm();
        return;
      }
      // Online: quick links (slot empty if none configured)
      if (ownerAvailable && !showEmailInHelper && quickLinks.length > 0) {
        helperDiv.style.display = 'block';
        const linksHtml = quickLinks
          .filter((l: { label: string; url: string }) => l.label && l.url)
          .map((l: { label: string; url: string }) => {
            const safe = isSafeUrl(l.url);
            const label = escapeHtml(l.label);
            if (safe) return `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-right:8px;margin-bottom:6px;padding:6px 10px;background:#1e293b;border-radius:8px;color:#94a3b8;font-size:12px;text-decoration:none;transition:color 0.15s,background 0.15s;" onmouseover="this.style.color='#e2e8f0';this.style.background='#334155';" onmouseout="this.style.color='#94a3b8';this.style.background='#1e293b';">${label}</a>`;
            return `<span style="display:inline-block;margin-right:8px;margin-bottom:6px;padding:6px 10px;background:#1e293b;border-radius:8px;color:#64748b;font-size:12px;">${label}</span>`;
          })
          .join('');
        helperDiv.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;">${linksHtml}</div>`;
        return;
      }
      helperDiv.style.display = 'none';
      helperDiv.innerHTML = '';
    }

    // Render messages
    function renderMessages() {
      // Show/hide fixed away banner above messages
      const awayBannerEl = document.getElementById('ghostchat-away-banner');
      const awayTextEl = document.getElementById('ghostchat-away-text');
      if (awayBannerEl && awayTextEl) {
        if (!ownerAvailable && awayMessage) {
          awayTextEl.textContent = awayMessage;
          awayBannerEl.style.display = 'flex';
        } else {
          awayBannerEl.style.display = 'none';
        }
      }
      if (messages.length === 0) {
        const subtitle = ownerAvailable ? t('emptySubtitle') : '';
        const title = !ownerAvailable ? escapeHtml(awayMessage) : t('emptyTitle');
        messagesDiv.innerHTML = `
          <div style="text-align:center;color:#64748b;padding:36px 20px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="margin:0 auto 12px;display:block;opacity:0.5;"><path d="${GP}" fill="#475569"/><circle cx="9" cy="10" r="1.4" fill="#111827"/><circle cx="15" cy="10" r="1.4" fill="#111827"/></svg>
            <p style="margin:0;font-size:13px;line-height:1.5;">${title}${subtitle ? `<br><span style="color:#475569;font-size:12px;">${subtitle}</span>` : ''}</p>
          </div>
        `;
        return;
      }

      messagesDiv.innerHTML = messages.map(msg => {
        const imgHtml = msg.imageUrl ? `<a href="${escapeHtml(msg.imageUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;${msg.content ? 'margin-bottom:6px;' : ''}"><img src="${escapeHtml(msg.imageUrl)}" style="max-width:100%;max-height:200px;border-radius:8px;display:block;cursor:pointer;" loading="lazy" alt="Image"></a>` : '';
        const linkStyle = msg.sender === 'VISITOR' ? 'color:white;text-decoration:underline;' : 'color:#67e8f9;text-decoration:underline;';
        const textHtml = msg.content ? escapeHtml(msg.content).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" target="_blank" rel="noopener noreferrer" style="${linkStyle}word-break:break-all;">$1</a>`) : '';
        // Show translation for owner messages (translated to visitor's language)
        const translationHtml = (msg.sender === 'OWNER' && msg.translatedContent)
          ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.15);font-size:12px;opacity:0.85;">${escapeHtml(msg.translatedContent).replace(/\n/g, '<br>')}</div>`
          : '';
        const nameHtml = (msg.sender === 'OWNER' && msg.senderName)
          ? `<div style="font-size:11px;color:#64748b;margin-bottom:2px;padding:0 2px;">${escapeHtml(msg.senderName)}</div>`
          : '';
        return `
        <div style="margin-bottom:10px;display:flex;flex-direction:column;align-items:${msg.sender === 'VISITOR' ? 'flex-end' : 'flex-start'};">
          ${nameHtml}
          <div style="max-width:80%;padding:9px 13px;border-radius:12px;font-size:13px;line-height:1.45;
            ${msg.sender === 'VISITOR'
              ? `background:${color};color:white;`
              : 'background:#1e293b;color:#e2e8f0;'}">
            ${imgHtml}${textHtml}${translationHtml}
          </div>
          <div style="font-size:10px;color:#475569;margin-top:3px;padding:0 2px;">${formatTime(msg.createdAt)}</div>
        </div>
      `;
      }).join('');
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // Update UI based on email/name state
    function updateUI() {
      messageForm.style.display = 'block';
      // Away + no email = block sending until email provided
      const awayBlocked = !ownerAvailable && !hasEmail;
      const sendBtn = document.getElementById('ghostchat-send') as HTMLButtonElement | null;
      if (sendBtn) {
        sendBtn.disabled = awayBlocked;
        sendBtn.style.opacity = awayBlocked ? '0.4' : '1';
        sendBtn.style.cursor = awayBlocked ? 'not-allowed' : 'pointer';
      }
      messageInput.disabled = awayBlocked;
      messageInput.placeholder = awayBlocked ? t('sendMessageAway') : t('sendMessage');
      messageInput.style.opacity = awayBlocked ? '0.5' : '1';
      // Show info section (name + email) immediately on open when owner available and no info yet
      const hasIdentity = hasEmail || hasName;
      const showInfoSec = ownerAvailable && !hasIdentity && !showEmailInHelper && !emailDismissed && !hasSentMessage;
      infoSection.style.display = showInfoSec ? 'block' : 'none';
      renderHelper();
      renderMessages();
      // Menu: show identity summary with checkmark, or prompt to edit
      if (hasIdentity) {
        const label = getSavedName() || getSavedEmail() || '';
        const truncated = label.length > 22 ? label.slice(0, 22) + '...' : label;
        menuEmailLabel.textContent = truncated ? `✓ ${truncated} (edit)` : '✓ Info saved';
        (menuEmailBtn as HTMLButtonElement).style.color = '#94a3b8';
      } else {
        menuEmailLabel.textContent = t('editInfo');
        (menuEmailBtn as HTMLButtonElement).style.color = '#e2e8f0';
      }
    }

    // Open/close
    async function open() {
      chatWindow.style.display = embedMode ? 'flex' : 'block';
      isOpen = true;
      if (bubble) bubble.setAttribute('aria-label', 'Close chat');

      // Clear unread indicator
      const indicator = document.getElementById('ghostchat-unread');
      if (indicator) {
        indicator.style.display = 'none';
      }

      // Show loading state
      messagesDiv.innerHTML = `
        <div style="text-align:center;color:#475569;padding:40px 20px;">
          <div style="font-size:13px;">${t('loading')}</div>
        </div>
      `;

      // Create DB session on first open
      await ensureSession();
      connectWs(); // Connect WS after session exists (channel is set)

      if (dbSessionId) {
        messages = await loadMessages(sessionId, siteId);
        if (messages.length > 0) hasSentMessage = true;
        const lastVisitor = messages.filter((m: any) => m.sender === 'VISITOR').pop();
        if (lastVisitor && lastVisitor.createdAt) lastVisitorMessageAt = new Date(lastVisitor.createdAt).getTime();
        else if (messages.length === 0) lastVisitorMessageAt = null;
      }

      updateUI();
      noResponseCheck();
      if (!('ontouchstart' in window)) messageInput.focus();
    }

    function close() {
      if (embedMode) return; // Embed mode stays open
      chatWindow.style.display = 'none';
      isOpen = false;
      if (bubble) { bubble.setAttribute('aria-label', 'Open chat'); bubble.focus(); }
      scheduleWsDisconnect(); // Disconnect WS after idle period
    }

    if (bubble) {
      bubble.onclick = () => isOpen ? close() : open();
      bubble.onkeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          isOpen ? close() : open();
        }
      };
    }
    if (!embedMode) closeBtn.onclick = close;

    // Escape key closes the chat window
    document.addEventListener('keydown', escapeHandler);

    // 3-dots menu: toggle dropdown
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const visible = menuDropdown.style.display === 'block';
      menuDropdown.style.display = visible ? 'none' : 'block';
    };
    menuEmailBtn.onclick = () => {
      menuDropdown.style.display = 'none';
      emailDismissed = false;
      // Show info section directly with pre-filled values — don't call updateUI()
      // which would hide it in away mode or when hasIdentity is true
      helperDiv.style.display = 'none';
      infoSection.style.display = 'block';
      nameInput.value = getSavedName() || '';
      emailInput.value = getSavedEmail() || '';
      nameInput.focus();
    };
    document.addEventListener('click', menuDismissHandler as EventListener);

    // Header click also closes (but not if clicking menu or close button; disabled in embed mode)
    const header = document.getElementById('ghostchat-header')!;
    if (!embedMode) {
      header.onclick = (e) => {
        if ((e.target as HTMLElement).closest('#ghostchat-close')) return;
        if ((e.target as HTMLElement).closest('#ghostchat-form-actions')) return;
        close();
      };
    }
    if (embedMode) header.style.cursor = 'default';

    // Info form (name + email)
    infoForm.onsubmit = async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const name = nameInput.value.trim();
      if (!email && !name) return;

      const submitBtn = infoForm.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitBtn) { submitBtn.textContent = '...'; submitBtn.disabled = true; }

      if (dbSessionId) {
        await saveVisitorInfo(dbSessionId, email || undefined, name || undefined);
      }
      if (email) { saveEmail(email); hasEmail = true; }
      if (name) { saveName(name); hasName = true; }
      updateUI();
      messageInput.focus();

      if (submitBtn) { submitBtn.textContent = t('save'); submitBtn.disabled = false; }
    };

    // Dismiss info section — show hint then collapse
    const dismissInfoBtn = document.getElementById('ghostchat-dismiss-info');
    if (dismissInfoBtn) dismissInfoBtn.onclick = () => {
      emailDismissed = true;
      infoSection.style.display = 'none';
      // Brief hint in place of the section
      const hint = document.createElement('div');
      hint.style.cssText = 'padding:6px 12px;background:#0f172a;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#475569;text-align:center;transition:opacity 0.4s;';
      hint.textContent = t('addLaterHint');
      infoSection.parentNode?.insertBefore(hint, infoSection.nextSibling);
      setTimeout(() => { hint.style.opacity = '0'; setTimeout(() => hint.remove(), 400); }, 3000);
      updateUI();
    };

    // Enter to send, Shift+Enter for newline
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
      }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = Math.min(messageInput.scrollHeight, 72) + 'px';
      messageInput.style.overflowY = messageInput.scrollHeight > 72 ? 'auto' : 'hidden';
    });

    // Visitor typing indicator
    let visitorTypingTimeout: ReturnType<typeof setTimeout> | null = null;
    messageInput.addEventListener('input', () => {
      if (wsConnected && dbSessionId) {
        ws.send({ type: 'typing', channel: `session:${dbSessionId}`, typing: true });
        if (visitorTypingTimeout) clearTimeout(visitorTypingTimeout);
        visitorTypingTimeout = setTimeout(() => {
          if (dbSessionId) ws.send({ type: 'typing', channel: `session:${dbSessionId}`, typing: false });
        }, 2000);
      }
    });

    // Image preview helpers
    let currentBlobUrl: string | null = null;

    function showImagePreview(file: File) {
      // Revoke previous blob URL to prevent memory leak
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
      pendingImageFile = file;
      currentBlobUrl = URL.createObjectURL(file);
      imagePreviewDiv.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><img src="${currentBlobUrl}" style="max-height:48px;border-radius:6px;" alt="Preview"><span style="flex:1;font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(file.name)}</span><button type="button" id="ghostchat-remove-image" style="background:none;border:none;color:#ef4444;cursor:pointer;padding:2px;font-size:16px;line-height:1;">&times;</button></div>`;
      imagePreviewDiv.style.display = 'block';
      const removeBtn = document.getElementById('ghostchat-remove-image');
      if (removeBtn) removeBtn.onclick = clearImagePreview;
    }

    function clearImagePreview() {
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
      pendingImageFile = null;
      imagePreviewDiv.style.display = 'none';
      imagePreviewDiv.innerHTML = '';
      fileInput.value = '';
    }

    // Handle image file selection
    async function handleImageUpload(file: File) {
      if (file.size > 5 * 1024 * 1024) {
        console.error('[GhostChat] Image too large (max 5MB)');
        return;
      }
      if (imageUploadCount >= MAX_IMAGE_UPLOADS) {
        console.error('[GhostChat] Image limit reached for this conversation');
        return;
      }
      showImagePreview(file);
    }

    // Attach button → file input
    attachBtn.onclick = () => {
      if (imageUploadCount >= MAX_IMAGE_UPLOADS) return;
      fileInput.click();
    };

    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (file) handleImageUpload(file);
    };

    // Paste image from clipboard
    messageInput.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) handleImageUpload(file);
          return;
        }
      }
    });

    // Message form
    messageForm.onsubmit = async (e) => {
      e.preventDefault();
      // Block sending when away and no email provided
      if (!ownerAvailable && !hasEmail) return;
      const content = messageInput.value.trim();
      const hasImage = !!pendingImageFile;
      if (!content && !hasImage) return;

      // Stop typing indicator on send
      if (visitorTypingTimeout) { clearTimeout(visitorTypingTimeout); visitorTypingTimeout = null; }
      if (wsConnected && dbSessionId) ws.send({ type: 'typing', channel: `session:${dbSessionId}`, typing: false });

      const sendBtn = document.getElementById('ghostchat-send') as HTMLButtonElement;
      const sendSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
      sendBtn.innerHTML = '<span style="font-size:12px;">...</span>';
      sendBtn.disabled = true;
      messageInput.disabled = true;
      const imageFile = pendingImageFile;

      try {
        // Ensure session exists before sending
        const sid = await ensureSession();
        if (!sid) throw new Error('Failed to create session');

        let imageUrl: string | undefined;
        if (imageFile) {
          imageUrl = await uploadVisitorImage(sid, imageFile);
          imageUploadCount++;
        }

        const result = await sendMessage(sid, content, imageUrl);
        // Clear image preview after successful send (not before, so user sees it during upload)
        clearImagePreview();
        messages.push(result.message);
        lastVisitorMessageAt = result.message?.createdAt ? new Date(result.message.createdAt).getTime() : Date.now();
        hasSentMessage = true;
        messageInput.value = '';
        messageInput.style.height = 'auto';
        renderMessages();
        updateUI();
      } catch (e) {
        console.error('Failed to send:', e);
      }

      sendBtn.innerHTML = sendSvg;
      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    };

    // Mark hasEmail/hasName from localStorage (server sync happens in ensureSession)
    if (getSavedEmail()) hasEmail = true;
    if (getSavedName()) hasName = true;
    
    // --- Visitor Context API (Business plan) ---
    let currentContext: Record<string, any> | null = null;
    let contextThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let contextPending = false;

    function sendContext() {
      if (!currentContext) return;
      fetch(`${API_URL}/session/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, siteId, metadata: currentContext }),
      }).catch(() => {});
    }

    function setContext(data: Record<string, any>) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const merged = currentContext ? { ...currentContext, ...data } : data;
      try {
        if (JSON.stringify(merged).length > 4096) return; // 4KB max
      } catch { return; }
      currentContext = merged;

      // Throttle: send at most once per 5 seconds
      if (contextThrottleTimer) {
        contextPending = true;
        return;
      }
      sendContext();
      contextThrottleTimer = setTimeout(() => {
        contextThrottleTimer = null;
        if (contextPending) {
          contextPending = false;
          sendContext();
        }
      }, 5000);
    }

    // --- Real-time URL tracking ---
    let lastTrackedUrl = window.location.href;

    function onUrlChange() {
      const newUrl = window.location.href;
      if (newUrl !== lastTrackedUrl) {
        lastTrackedUrl = newUrl;
        setContext({ _url: newUrl });
      }
    }

    // Listen for browser back/forward navigation
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    // Monkey-patch pushState/replaceState for SPA navigation
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function(...args: any[]) {
      origPushState.apply(this, args);
      onUrlChange();
    };
    history.replaceState = function(...args: any[]) {
      origReplaceState.apply(this, args);
      onUrlChange();
    };

    // In embed mode, auto-open the chat immediately
    if (embedMode) open();

    // Expose API
    (window as any).GhostChat = { open, close, toggle: () => isOpen ? close() : open(), setContext };
  }

  // Initialize when DOM ready
  async function safeInit() {
    try { await init(); } catch (e) { console.error('[GhostChat] Widget failed to initialize:', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInit);
  } else {
    safeInit();
  }
})();

