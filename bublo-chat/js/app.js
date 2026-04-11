/**
 * ============================================================
 *  BUBLO — Agentic AI Assistant  ·  Chat Application Logic
 * ============================================================
 *
 *  Modular Vanilla JS powering the Bublo chat interface.
 *  Features:
 *    ✦  Send/receive messages with animated bubbles
 *    ✦  CSS-only typing indicator with elapsed timer
 *    ✦  Streaming support (SSE / ReadableStream / long-poll)
 *    ✦  20-minute master timeout with auto-retry on network drops
 *    ✦  Auto-scroll to latest message
 *    ✦  Auto-resize textarea
 *    ✦  Welcome screen with suggestion chips
 *    ✦  Clear chat action
 *    ✦  Unique Session ID generation for memory management
 *
 *  Author:  Sumit Dabas
 * ============================================================
 */

'use strict';

// Generates a secure, unique ID for the user's session
const currentSessionId = crypto.randomUUID();

/* ── DOM References ───────────────────────────────────────── */
const DOM = {
  chatMessages:  document.getElementById('chat-messages'),
  chatInput:     document.getElementById('chat-input'),
  sendBtn:       document.getElementById('send-btn'),
  welcomeScreen: document.getElementById('welcome-screen'),
  statusText:    document.getElementById('status-text'),
  clearBtn:      document.getElementById('btn-clear'),
  infoBtn:       document.getElementById('btn-info'),
};

/* ── Configuration ────────────────────────────────────────── */
const CONFIG = {
  /**
   * 🔌 N8N WEBHOOK ENDPOINT
   */
  webhookUrl: 'https://n8n.sumitdabas.in/webhook/58f54309-8118-4294-8f63-51cd0c9ba873/chat',

  /**
   * ⏱️  TIMEOUT — 20 minutes (1,200,000ms)
   * The Qwen 9B model on ARM CPU can take up to 20 minutes
   * on the very first cold-start call. Subsequent calls are
   * much faster, but we must not kill the first one.
   */
  fetchTimeoutMs: 1_200_000,

  /**
   * 🔁  RETRY — Handles proxy/Nginx dropping long connections.
   * When the reverse proxy (Nginx, Cloudflare, etc.) kills
   * the connection before Ollama finishes, the browser sees a
   * generic network error. Instead of failing immediately, we
   * retry transparently up to `maxRetries` times.
   *
   * Total maximum wait ≈ fetchTimeoutMs (master timeout spans
   * all retries). In practice the successful response arrives
   * on one of the early retries once Ollama finishes processing.
   */
  maxRetries: 5,
  retryBaseDelayMs: 3_000,     // initial delay before first retry (3s)
  retryBackoffFactor: 1.5,     // multiplier for each subsequent retry

  /** Maximum textarea height before scrolling */
  maxInputHeight: 120,
};


/* ══════════════════════════════════════════════════════════════
   UTILITY HELPERS
   ══════════════════════════════════════════════════════════════ */

/**
 * Returns the current time formatted as HH:MM AM/PM
 */
function getTimestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Smoothly scrolls the chat container to the bottom.
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    DOM.chatMessages.scrollTo({
      top: DOM.chatMessages.scrollHeight,
      behavior: 'smooth',
    });
  });
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} text — Raw user/bot text
 * @returns {string} — Safe HTML string
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Formats seconds into a human-readable elapsed string.
 * @param {number} seconds
 * @returns {string} e.g. "45s", "1m 12s", "3m 5s"
 */
function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/**
 * Pauses execution for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/* ══════════════════════════════════════════════════════════════
   WELCOME SCREEN
   ══════════════════════════════════════════════════════════════ */

function hideWelcomeScreen() {
  if (DOM.welcomeScreen) {
    DOM.welcomeScreen.style.display = 'none';
  }
}

function showWelcomeScreen() {
  if (DOM.welcomeScreen) {
    DOM.welcomeScreen.style.display = '';
  }
}


/* ══════════════════════════════════════════════════════════════
   MESSAGE RENDERING
   ══════════════════════════════════════════════════════════════ */

/**
 * Creates and appends a message bubble to the chat area.
 * @param {'user'|'bot'} sender
 * @param {string} text — The message text (HTML-escaped internally)
 * @returns {HTMLElement} — The message-bubble inner element
 */
function appendMessage(sender, text) {
  hideWelcomeScreen();

  const message = document.createElement('div');
  message.classList.add('message', sender);

  const avatarLabel = sender === 'bot' ? 'B' : '👤';
  const time = getTimestamp();

  message.innerHTML = `
    <div class="message-avatar">${avatarLabel}</div>
    <div class="message-content">
      <div class="message-bubble">${escapeHtml(text)}</div>
      <span class="message-time">${time}</span>
    </div>
  `;

  DOM.chatMessages.appendChild(message);
  scrollToBottom();

  return message.querySelector('.message-bubble');
}

/**
 * Creates an empty bot message bubble for streaming text into.
 * @returns {{ messageEl: HTMLElement, bubbleEl: HTMLElement }}
 */
function createStreamingBotMessage() {
  hideWelcomeScreen();

  const message = document.createElement('div');
  message.classList.add('message', 'bot');

  message.innerHTML = `
    <div class="message-avatar">B</div>
    <div class="message-content">
      <div class="message-bubble streaming-bubble"></div>
      <span class="message-time">${getTimestamp()}</span>
    </div>
  `;

  DOM.chatMessages.appendChild(message);
  scrollToBottom();

  return {
    messageEl: message,
    bubbleEl: message.querySelector('.message-bubble'),
  };
}


/* ══════════════════════════════════════════════════════════════
   TYPING INDICATOR (with elapsed timer)
   ══════════════════════════════════════════════════════════════ */

/** @type {number|null} — Interval ID for the elapsed timer */
let typingTimerInterval = null;

/**
 * Shows a CSS-animated "typing" indicator with a live elapsed timer.
 * @returns {HTMLElement} — The indicator element (to remove later)
 */
function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.classList.add('typing-indicator');
  indicator.id = 'typing-indicator';

  indicator.innerHTML = `
    <div class="message-avatar" style="background: linear-gradient(135deg, hsl(217,91%,55%), hsl(265,70%,58%)); color: #fff; width: 32px; height: 32px; border-radius: .5rem; display: flex; align-items: center; justify-content: center; font-size: .8125rem; font-weight: 700; flex-shrink: 0;">B</div>
    <div class="typing-bubble">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  `;

  DOM.chatMessages.appendChild(indicator);
  scrollToBottom();

  /* Start elapsed timer in the status bar */
  let elapsed = 0;
  DOM.statusText.textContent = 'Thinking...';

  typingTimerInterval = setInterval(() => {
    elapsed++;
    DOM.statusText.textContent = `Thinking... ${formatElapsed(elapsed)}`;
  }, 1000);

  return indicator;
}

/**
 * Removes the typing indicator and stops the elapsed timer.
 * @param {HTMLElement} indicator
 */
function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
  if (typingTimerInterval) {
    clearInterval(typingTimerInterval);
    typingTimerInterval = null;
  }
  DOM.statusText.textContent = 'Online';
}


/* ══════════════════════════════════════════════════════════════
   BACKEND COMMUNICATION
   ══════════════════════════════════════════════════════════════

   Strategy:
     1. Primary: Try to read the response as a ReadableStream
        (for SSE / chunked text). Render words live.
     2. Fallback: If the response is not streamed (or the
        content-type isn't text/event-stream), read the full
        JSON body and render at once.
     3. AbortController: 20-minute master timeout spanning all
        retry attempts. This ensures slow ARM inference isn't
        killed prematurely.
     4. Auto-retry: Network errors (proxy/Nginx dropping the
        connection) trigger transparent retries with exponential
        backoff. The typing indicator stays visible throughout.
   ══════════════════════════════════════════════════════════════ */

/**
 * Performs a single fetch attempt to the webhook.
 * Returns the Response on success, or throws on failure.
 *
 * @param {string} userMessage
 * @param {AbortSignal} signal
 * @returns {Promise<Response>}
 */
async function attemptFetch(userMessage, signal) {
  const response = await fetch(CONFIG.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: currentSessionId,
      message: userMessage,
    }),
    signal,
  });
  return response;
}

/**
 * Sends the user's message and handles the response.
 * Automatically retries on network errors (e.g. proxy timeout)
 * up to CONFIG.maxRetries times with exponential backoff.
 * The typing indicator stays visible across all retries.
 *
 * @param {string} userMessage — The user's message text
 */
async function fetchAndRenderReply(userMessage) {
  const typingEl = showTypingIndicator();

  /*
   * Master AbortController — spans ALL retries.
   * Total wall-clock timeout = fetchTimeoutMs (20 min default).
   * Individual attempts may fail sooner due to proxy timeouts,
   * but the overall timer keeps ticking across retries.
   */
  const masterController = new AbortController();
  const masterTimeout = setTimeout(
    () => masterController.abort(),
    CONFIG.fetchTimeoutMs,
  );

  let lastError = null;
  let delay = CONFIG.retryBaseDelayMs;

  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    /* If the master timeout has already fired, stop retrying */
    if (masterController.signal.aborted) break;

    try {
      /* Wait before retry (skip delay on the first attempt) */
      if (attempt > 0) {
        console.log(
          `[Bublo] Retry ${attempt}/${CONFIG.maxRetries} — waiting ${Math.round(delay / 1000)}s before next attempt…`,
        );
        DOM.statusText.textContent =
          `Reconnecting (attempt ${attempt + 1})…`;
        await sleep(delay);
        delay = Math.round(delay * CONFIG.retryBackoffFactor);
      }

      const response = await attemptFetch(
        userMessage,
        masterController.signal,
      );

      /* ── Real HTTP errors (4xx / 5xx) ─────────────────────── */
      if (!response.ok) {
        clearTimeout(masterTimeout);
        removeTypingIndicator(typingEl);
        const statusMsg = response.status === 404
          ? 'The webhook endpoint was not found (404). Please check the URL.'
          : response.status >= 500
            ? `Server error (${response.status}). The backend may be overloaded — try again in a moment.`
            : `Unexpected error (${response.status}).`;
        appendMessage('bot', `⚠️ ${statusMsg}`);
        return;
      }

      /* ── Determine response type ──────────────────────────── */
      const contentType = response.headers.get('content-type') || '';
      const isStream = contentType.includes('text/event-stream')
        || contentType.includes('text/plain')
        || contentType.includes('application/octet-stream');

      /*
       * ╔═════════════════════════════════════════════════════╗
       * ║  PATH A — STREAMING (SSE / chunked text)           ║
       * ╚═════════════════════════════════════════════════════╝
       */
      if (isStream && response.body) {
        clearTimeout(masterTimeout);
        removeTypingIndicator(typingEl);
        const { bubbleEl } = createStreamingBotMessage();
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });

          /*
           * SSE format: each event is "data: <text>\n\n"
           * We parse each line, strip the "data: " prefix,
           * and skip control events like [DONE].
           */
          const lines = chunk.split('\n');
          for (const line of lines) {
            let text = line;

            /* Strip SSE prefix if present */
            if (text.startsWith('data: ')) {
              text = text.slice(6);
            }

            /* Skip empty lines and control signals */
            if (!text || text === '[DONE]' || text.trim() === '') continue;

            /* Try to parse JSON tokens (common format) */
            try {
              const parsed = JSON.parse(text);
              text = parsed.token || parsed.content || parsed.text || parsed.delta?.content || text;
            } catch {
              /* Not JSON — use raw text as-is */
            }

            fullText += text;
            bubbleEl.textContent = fullText;
            scrollToBottom();
          }
        }

        /* If stream was empty, show a fallback */
        if (!fullText.trim()) {
          bubbleEl.textContent = 'Received an empty response. Please try again.';
        }
        return;
      }

      /*
       * ╔═════════════════════════════════════════════════════╗
       * ║  PATH B — STANDARD JSON (non-streamed)             ║
       * ╚═════════════════════════════════════════════════════╝
       */
      const data = await response.json();
      clearTimeout(masterTimeout);
      removeTypingIndicator(typingEl);

      const reply = data.reply
        || data.output
        || data.response
        || data.text
        || (typeof data === 'string' ? data : null)
        || 'I received your message, but got an unexpected response format.';

      appendMessage('bot', reply);
      return;  /* ← Success! Exit the retry loop. */

    } catch (error) {
      lastError = error;

      /* If the user's master timeout fired, don't retry */
      if (error.name === 'AbortError') break;

      /* Network error — log and continue to next retry */
      console.warn(
        `[Bublo] Attempt ${attempt + 1} failed:`,
        error.message,
      );
    }
  }

  /* ── All retries exhausted or master timeout fired ─────────── */
  clearTimeout(masterTimeout);
  removeTypingIndicator(typingEl);

  if (lastError?.name === 'AbortError') {
    const mins = Math.round(CONFIG.fetchTimeoutMs / 60_000);
    appendMessage('bot',
      `⏱️ The request timed out after ${mins} minutes. The server might be under heavy load — please try again.`
    );
  } else {
    console.error('[Bublo] All retries exhausted:', lastError);
    appendMessage('bot',
      `⚠️ Could not reach Bublo's backend after ${CONFIG.maxRetries + 1} attempts. Please check your internet connection and try again.`
    );
  }
}


/* ══════════════════════════════════════════════════════════════
   SEND MESSAGE FLOW
   ══════════════════════════════════════════════════════════════ */

/** Flag to prevent double-sends */
let isSending = false;

/**
 * Main send handler:
 *  1. Reads & trims input
 *  2. Appends user message
 *  3. Calls fetchAndRenderReply (handles typing + response)
 *  4. Cleans up
 */
async function handleSend() {
  const text = DOM.chatInput.value.trim();

  /* Guard: empty or already sending */
  if (!text || isSending) return;

  isSending = true;
  DOM.sendBtn.disabled = true;

  /* 1. Clear input & reset height */
  DOM.chatInput.value = '';
  DOM.chatInput.style.height = 'auto';

  /* 2. Append user message */
  appendMessage('user', text);

  /* 3. Fetch & render reply (streaming or standard) */
  await fetchAndRenderReply(text);

  /* 4. Re-enable */
  isSending = false;
  updateSendBtnState();
  DOM.chatInput.focus();
}


/* ══════════════════════════════════════════════════════════════
   INPUT HANDLING
   ══════════════════════════════════════════════════════════════ */

function updateSendBtnState() {
  DOM.sendBtn.disabled = DOM.chatInput.value.trim().length === 0;
}

function autoResizeInput() {
  DOM.chatInput.style.height = 'auto';
  DOM.chatInput.style.height =
    Math.min(DOM.chatInput.scrollHeight, CONFIG.maxInputHeight) + 'px';
}

DOM.chatInput.addEventListener('input', () => {
  updateSendBtnState();
  autoResizeInput();
});

/* Enter to send, Shift+Enter for newline */
DOM.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

DOM.sendBtn.addEventListener('click', handleSend);


/* ══════════════════════════════════════════════════════════════
   SUGGESTION CHIPS
   ══════════════════════════════════════════════════════════════ */

document.querySelectorAll('.suggestion-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const message = chip.getAttribute('data-message');
    if (message) {
      DOM.chatInput.value = message;
      updateSendBtnState();
      handleSend();
    }
  });
});


/* ══════════════════════════════════════════════════════════════
   HEADER ACTIONS
   ══════════════════════════════════════════════════════════════ */

/**
 * Clear Chat — Removes all messages and shows welcome screen.
 */
DOM.clearBtn.addEventListener('click', () => {
  const messages = DOM.chatMessages.querySelectorAll('.message, .typing-indicator');
  messages.forEach((msg) => msg.remove());
  showWelcomeScreen();
});

/**
 * Info Button — Quick info about Bublo.
 */
DOM.infoBtn.addEventListener('click', () => {
  if (document.querySelector('[data-info-message]')) return;

  hideWelcomeScreen();

  const infoMsg = document.createElement('div');
  infoMsg.classList.add('message', 'bot');
  infoMsg.setAttribute('data-info-message', 'true');

  infoMsg.innerHTML = `
    <div class="message-avatar">B</div>
    <div class="message-content">
      <div class="message-bubble">
        <strong>About Bublo 🤖</strong><br/><br/>
        I'm an <strong>Agentic AI Assistant</strong> — built to go beyond
        simple chat. I use multi-step reasoning, tool integration, and
        intelligent workflows to help you think, create, and solve
        problems.<br/><br/>
        <strong>What I can do:</strong><br/>
        • Answer complex questions with reasoning<br/>
        • Write & debug code<br/>
        • Brainstorm and plan ideas<br/>
        • Analyze information & summarize<br/><br/>
        New agentic tools & knowledge bases are being added regularly.
        This is just the beginning.<br/><br/>
        <em>v1.0 · Created by <a href="https://sumitdabas.in" target="_blank" style="color: hsl(217,91%,55%);">Sumit Dabas</a></em>
      </div>
      <span class="message-time">${getTimestamp()}</span>
    </div>
  `;

  DOM.chatMessages.appendChild(infoMsg);
  scrollToBottom();
});


/* ══════════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', () => {
  DOM.chatInput.focus();
});

console.log(
  '%c🤖 Bublo v1.2 — Agentic AI Assistant (Streaming + Auto-retry)',
  'color: hsl(217,91%,55%); font-size: 14px; font-weight: bold;'
);
console.log(
  '%cSession: ' + currentSessionId,
  'color: #888; font-size: 11px;'
);
console.log(
  '%cTimeout: ' + (CONFIG.fetchTimeoutMs / 60000) + ' min · Retries: ' + CONFIG.maxRetries + ' · Powered by agentic workflows',
  'color: #888; font-size: 11px;'
);