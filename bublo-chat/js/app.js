/**
 * ============================================================
 *  BUBLO — Agentic AI Assistant  ·  Chat Application Logic
 * ============================================================
 *
 *  Modular Vanilla JS powering the Bublo chat interface.
 *  Features:
 *    ✦  Send/receive messages with animated bubbles
 *    ✦  CSS-only typing indicator
 *    ✦  Auto-scroll to latest message
 *    ✦  Auto-resize textarea
 *    ✦  Welcome screen with suggestion chips
 *    ✦  Clear chat action
 *    ✦  Placeholder fetch() ready for n8n webhook
 *
 *  Author:  Sumit Dabas
 * ============================================================
 */

'use strict';

/* ── DOM References ───────────────────────────────────────── */
const DOM = {
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  welcomeScreen: document.getElementById('welcome-screen'),
  statusText: document.getElementById('status-text'),
  clearBtn: document.getElementById('btn-clear'),
  infoBtn: document.getElementById('btn-info'),
};

/* ── Configuration ────────────────────────────────────────── */
const CONFIG = {
  /**
   * 🔌 N8N WEBHOOK ENDPOINT
   * Replace this URL with your actual n8n webhook URL.
   * The webhook should accept POST requests with:
   *   { "message": "<user's message>" }
   * And return JSON with:
   *   { "reply": "<bot's reply>" }
   */
  webhookUrl: 'https://n8n.sumitdabas.in/webhook/58f54309-8118-4294-8f63-51cd0c9ba873/chat',

  /** Typing indicator delay range (ms) — for simulation fallback */
  typingDelayMin: 800,
  typingDelayMax: 2000,

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


/* ══════════════════════════════════════════════════════════════
   WELCOME SCREEN
   ══════════════════════════════════════════════════════════════ */

/**
 * Hides the welcome screen when the first message is sent.
 */
function hideWelcomeScreen() {
  if (DOM.welcomeScreen) {
    DOM.welcomeScreen.style.display = 'none';
  }
}

/**
 * Shows the welcome screen (used when chat is cleared).
 */
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
 *
 * @param {'user'|'bot'} sender — Who sent the message
 * @param {string} text — The message text
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
}


/* ══════════════════════════════════════════════════════════════
   TYPING INDICATOR
   ══════════════════════════════════════════════════════════════ */

/**
 * Shows a CSS-animated "typing" indicator in the chat area.
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

  /* Update status text */
  DOM.statusText.textContent = 'Thinking...';

  return indicator;
}

/**
 * Removes the typing indicator from the chat area.
 * @param {HTMLElement} indicator
 */
function removeTypingIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
  DOM.statusText.textContent = 'Online';
}


/* ══════════════════════════════════════════════════════════════
   BACKEND COMMUNICATION
   ══════════════════════════════════════════════════════════════ */

/**
 * Sends the user's message to the n8n webhook and returns the reply.
 *
 * 🔌  INTEGRATION POINT
 *     Modify the request body and response parsing to match
 *     your n8n webhook's expected format.
 *
 * @param {string} userMessage — The user's message text
 * @returns {Promise<string>} — The bot's reply text
 */
async function fetchBotReply(userMessage) {
  try {
    const response = await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage }),
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const data = await response.json();

    /*
     * 📝 RESPONSE PARSING
     * Adjust the property name below to match your webhook's
     * response structure. Common patterns:
     *   data.reply
     *   data.output
     *   data.response
     *   data.text
     */
    return data.reply || data.output || data.response || data.text || 'I received your message, but got an unexpected response format.';

  } catch (error) {
    console.error('[Bublo] Fetch error:', error);

    /*
     * Fallback: If the webhook isn't configured yet,
     * return a helpful message instead of crashing.
     */
    return `👋 Hey there! I'm Bublo, your agentic AI assistant. My backend is being configured right now — once live, I'll be able to reason through complex tasks, write code, brainstorm ideas, and much more.\n\nHang tight — exciting capabilities are on the way!`;
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
 *  3. Shows typing indicator
 *  4. Calls the webhook
 *  5. Appends bot reply
 *  6. Cleans up
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

  /* 3. Show typing indicator */
  const typingEl = showTypingIndicator();

  /* 4. Fetch reply from backend */
  const reply = await fetchBotReply(text);

  /* 5. Remove indicator, append reply */
  removeTypingIndicator(typingEl);
  appendMessage('bot', reply);

  /* 6. Re-enable */
  isSending = false;
  updateSendBtnState();
  DOM.chatInput.focus();
}


/* ══════════════════════════════════════════════════════════════
   INPUT HANDLING
   ══════════════════════════════════════════════════════════════ */

/**
 * Enables/disables the send button based on input content.
 */
function updateSendBtnState() {
  DOM.sendBtn.disabled = DOM.chatInput.value.trim().length === 0;
}

/**
 * Auto-resizes the textarea to fit its content (up to max height).
 */
function autoResizeInput() {
  DOM.chatInput.style.height = 'auto';
  DOM.chatInput.style.height =
    Math.min(DOM.chatInput.scrollHeight, CONFIG.maxInputHeight) + 'px';
}

/* ── Input event listeners ────────────────────────────────── */
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

/* Send button click */
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
  /* Remove all message elements and typing indicators */
  const messages = DOM.chatMessages.querySelectorAll('.message, .typing-indicator');
  messages.forEach((msg) => msg.remove());

  /* Show welcome screen again */
  showWelcomeScreen();
});

/**
 * Info Button — Quick info about Bublo.
 */
DOM.infoBtn.addEventListener('click', () => {
  /* If already showing info, don't add another */
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

/**
 * Focus the input on load for immediate typing.
 */
window.addEventListener('DOMContentLoaded', () => {
  DOM.chatInput.focus();
});

/**
 * Log a friendly startup message.
 */
console.log(
  '%c🤖 Bublo v1.0 — Agentic AI Assistant',
  'color: hsl(217,91%,55%); font-size: 14px; font-weight: bold;'
);
console.log(
  '%cPowered by agentic workflows · https://chat.sumitdabas.in',
  'color: #888; font-size: 11px;'
);
