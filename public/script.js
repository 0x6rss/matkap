const logArea = document.getElementById('logArea');
const messagesArea = document.getElementById('messagesArea');
const alertBox = document.getElementById('alertBox');
let latestMessages = [];

const startAttackBtn = document.getElementById('startAttackBtn');
const forwardAllBtn = document.getElementById('forwardAllBtn');
const stopBtn = document.getElementById('stopBtn');
const resumeBtn = document.getElementById('resumeBtn');
const accountRow = document.getElementById('accountRow');
const accountSelect = document.getElementById('accountSelect');
const themeToggle = document.getElementById('themeToggle');
const themeToggleIcon = themeToggle?.querySelector('.theme-toggle-icon');
const themeToggleLabel = themeToggle?.querySelector('.theme-toggle-label');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';

  if (themeColorMeta) {
    themeColorMeta.content = isLight ? '#f2f5f9' : '#070b12';
  }

  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', String(isLight));
    themeToggle.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  }

  if (themeToggleIcon) themeToggleIcon.textContent = isLight ? '☾' : '☼';
  if (themeToggleLabel) themeToggleLabel.textContent = isLight ? 'Dark' : 'Light';
}

let savedTheme = 'dark';
try {
  savedTheme = localStorage.getItem('matkap-theme') === 'light' ? 'light' : 'dark';
} catch (err) {
  /* Local storage may be unavailable in privacy-restricted contexts. */
}

applyTheme(savedTheme);

themeToggle?.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);

  try {
    localStorage.setItem('matkap-theme', nextTheme);
  } catch (err) {
    /* Keep the current session theme even when persistence is unavailable. */
  }
});

// Side rails collapse so the workspace column can use the full screen width.
function setupRail(button, stateClass, storageKey, collapseLabel, expandLabel) {
  if (!button) return;

  const apply = (collapsed) => {
    document.documentElement.classList.toggle(stateClass, collapsed);
    const label = collapsed ? expandLabel : collapseLabel;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', label);
    button.title = label;
  };

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(storageKey) === '1';
  } catch (err) {
    /* Local storage may be unavailable in privacy-restricted contexts. */
  }

  apply(collapsed);

  button.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);

    try {
      localStorage.setItem(storageKey, collapsed ? '1' : '0');
    } catch (err) {
      /* Keep the current session layout even when persistence is unavailable. */
    }
  });
}

setupRail(
  document.getElementById('railToggle'),
  'rail-collapsed',
  'matkap-rail-collapsed',
  'Collapse workspaces',
  'Expand workspaces'
);

setupRail(
  document.getElementById('dockToggle'),
  'dock-collapsed',
  'matkap-dock-collapsed',
  'Collapse hunting resources',
  'Expand hunting resources'
);

function showAlert(message, type = 'error') {
  if (!alertBox) return;
  alertBox.textContent = message;
  alertBox.className = 'alert-box ' + type;
  alertBox.style.display = 'block';
  setTimeout(() => {
    alertBox.style.display = 'none';
  }, 5000);
}

function selectedAccountIndex() {
  if (accountSelect && accountSelect.value !== '') {
    return parseInt(accountSelect.value, 10);
  }
  return null;
}

async function loadAccounts() {
  try {
    const resp = await fetch('/api/accounts');
    const data = await resp.json();
    const accounts = data.accounts || [];
    if (accounts.length > 1 && accountRow && accountSelect) {
      accountSelect.innerHTML = accounts
        .map(a => `<option value="${a.index}">${escapeHtml(a.label)}</option>`)
        .join('');
      accountRow.style.display = 'flex';
    }
  } catch (err) {
    /* ignore */
  }
}

function isAtBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 50;
}

function getLogType(log) {
  if (log.includes('[ok]') || log.includes('[result]') || log.includes('success') || log.includes('Found') || log.includes('found')) {
    return { type: 'success', icon: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>' };
  } else if (log.includes('[fail]') || log.includes('error') || log.includes('fail')) {
    return { type: 'error', icon: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>' };
  } else if (log.includes('[warn]') || log.includes('[stop]') || log.includes('warning') || log.includes('Try')) {
    return { type: 'warning', icon: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor"/></svg>' };
  }
  return { type: 'info', icon: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"/></svg>' };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateLogs() {
  const wasAtBottom = isAtBottom(logArea);
  fetch('/logs')
    .then(resp => resp.json())
    .then(data => {
      const logs = data.logs || [];
      if (logs.length === 0) {
        logArea.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H6v-2h8v2zm4-4H6v-2h12v2z"/></svg>
            <p>No operation logs yet</p>
          </div>`;
        return;
      }
      logArea.innerHTML = logs.map(log => {
        const { type, icon } = getLogType(log);
        return `
          <div class="log-entry ${type}">
            <span class="log-icon ${type}">${icon}</span>
            <span class="log-content">${escapeHtml(log)}</span>
          </div>`;
      }).join('');
      if (wasAtBottom) logArea.scrollTop = logArea.scrollHeight;
    })
    .catch(() => {});
}

function getMessageTypeInfo(msg) {
  const content = msg.content || '';
  if (content.includes('[Photo]')) {
    return { type: 'photo', label: 'Photo', icon: '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>' };
  } else if (content.includes('[Document]')) {
    return { type: 'document', label: 'Document', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' };
  } else if (content.includes('[Video]')) {
    return { type: 'video', label: 'Video', icon: '<svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>' };
  } else if (content.includes('[Audio]')) {
    return { type: 'audio', label: 'Audio', icon: '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>' };
  } else if (content.includes('[Voice]')) {
    return { type: 'voice', label: 'Voice', icon: '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>' };
  }
  return { type: 'text', label: 'Text', icon: '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>' };
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMessageLogForCopy(msg) {
  const { label } = getMessageTypeInfo(msg);
  return [
    `Message ID: ${msg.messageId || 'N/A'}`,
    `Time: ${msg.timestamp || 'N/A'}`,
    `Type: ${label}`,
    '',
    String(msg.content || '[No content]'),
  ].join('\n');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access was denied.');
}

messagesArea?.addEventListener('click', async event => {
  const button = event.target.closest('.message-copy-btn');
  if (!button || !messagesArea.contains(button)) return;
  const message = latestMessages[Number(button.dataset.messageIndex)];
  if (!message) return;
  try {
    await copyText(formatMessageLogForCopy(message));
    button.classList.add('copied');
    button.querySelector('span').textContent = 'Copied';
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove('copied');
      button.querySelector('span').textContent = 'Copy log';
    }, 1600);
  } catch (error) {
    showAlert('Could not copy this log. Allow clipboard access and try again.', 'error');
  }
});

function updateMessages() {
  const wasAtBottom = isAtBottom(messagesArea);
  fetch('/messages')
    .then(resp => resp.json())
    .then(data => {
      const messages = data.messages || [];
      latestMessages = messages;
      if (messages.length === 0) {
        messagesArea.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
            <p>No captured messages yet</p>
          </div>`;
        return;
      }
      messagesArea.innerHTML = messages.map((msg, messageIndex) => {
        const { type, label, icon } = getMessageTypeInfo(msg);
        const downloadBtn = msg.fileId ? `
          <a href="/download?fileId=${msg.fileId}" target="_blank" class="download-link">
            <svg class="download-icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Download
          </a>` : '';
        return `
          <div class="message-card">
            <div class="message-card-header">
              <div class="message-card-meta">
                <span class="message-id">ID: ${msg.messageId || 'N/A'}</span>
                <span class="message-time">${formatTime(msg.timestamp)}</span>
              </div>
              <div class="message-card-actions">
                ${downloadBtn}
                <button class="message-copy-btn" type="button" data-message-index="${messageIndex}" aria-label="Copy message log" title="Copy log">
                  <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                  <span>Copy log</span>
                </button>
              </div>
            </div>
            <div class="message-card-body">
              <div class="message-content">${escapeHtml(msg.content || JSON.stringify(msg, null, 2))}</div>
            </div>
            <div class="message-card-footer">
              <div class="message-type ${type}">${icon}<span>${label}</span></div>
            </div>
          </div>`;
      }).join('');
      if (wasAtBottom) messagesArea.scrollTop = messagesArea.scrollHeight;
    })
    .catch(() => {});
}

startAttackBtn.addEventListener('click', async () => {
  const botTokenRaw = document.getElementById('botToken').value.trim();
  const attackerChatId = document.getElementById('malChatId').value.trim();
  if (!botTokenRaw) {
    showAlert('Please enter a bot token.', 'error');
    return;
  }
  try {
    const body = { botTokenRaw, attackerChatId };
    const idx = selectedAccountIndex();
    if (idx !== null) body.accountIndex = idx;
    const resp = await fetch('/startInfiltration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) showAlert(data.error || 'Start failed', 'error');
    else updateLogs();
  } catch (err) {
    showAlert('Connection error. Please try again.', 'error');
  }
});

forwardAllBtn.addEventListener('click', async () => {
  const attackerChatId = document.getElementById('malChatId').value.trim();
  if (!attackerChatId) {
    showAlert('Please enter your chat ID.', 'error');
    return;
  }
  try {
    const resp = await fetch('/forwardAll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackerChatId }),
    });
    const data = await resp.json();
    if (!resp.ok) showAlert(data.error || 'Forward failed', 'error');
  } catch (err) {
    showAlert('Connection error. Please try again.', 'error');
  }
});

stopBtn.addEventListener('click', async () => {
  await fetch('/stop', { method: 'POST' });
});

resumeBtn.addEventListener('click', async () => {
  const attackerChatId = document.getElementById('malChatId').value.trim();
  if (!attackerChatId) {
    showAlert('Please enter your chat ID.', 'error');
    return;
  }
  try {
    const resp = await fetch('/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attackerChatId }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      showAlert(data.error || 'Resume failed', 'error');
    }
  } catch (err) {
    showAlert('Connection error. Please try again.', 'error');
  }
});

document.getElementById('clearLogsBtn').addEventListener('click', async () => {
  await fetch('/clearLogs', { method: 'POST' });
});

document.getElementById('exportMessagesBtn').addEventListener('click', async () => {
  try {
    const resp = await fetch('/messages');
    const data = await resp.json();
    const blob = new Blob([JSON.stringify(data.messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'messages.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export Messages error:', err);
  }
});

document.getElementById('clearMessagesBtn').addEventListener('click', async () => {
  try {
    await fetch('/clearMessages', { method: 'POST' });
    messagesArea.innerHTML = '';
  } catch (err) {
    console.error('Clear Messages error:', err);
  }
});

// ---- IOC Discovery ----
const iocSource = document.getElementById('iocSource');
const iocQuery = document.getElementById('iocQuery');
const iocSize = document.getElementById('iocSize');
const iocSearchBtn = document.getElementById('iocSearchBtn');
const iocResults = document.getElementById('iocResults');
const iocStatus = document.getElementById('iocStatus');

let iocSourceDefaults = {};

async function loadIocSources() {
  try {
    const resp = await fetch('/api/ioc/sources');
    const data = await resp.json();
    const sources = data.sources || [];
    if (!iocSource) return;
    iocSource.innerHTML = sources
      .map(s => `<option value="${s.id}" ${s.configured ? '' : 'data-unconfigured="1"'}>${escapeHtml(s.label)}${s.configured ? '' : ' (no key)'}</option>`)
      .join('');
    sources.forEach(s => { iocSourceDefaults[s.id] = s.defaultQuery || ''; });
    applyIocDefaultQuery();
  } catch (err) {
    /* ignore */
  }
}

function applyIocDefaultQuery() {
  if (!iocSource || !iocQuery) return;
  const def = iocSourceDefaults[iocSource.value] || '';
  iocQuery.placeholder = def;
  if (!iocQuery.value) iocQuery.value = def;
}

if (iocSource) iocSource.addEventListener('change', () => { iocQuery.value = ''; applyIocDefaultQuery(); });

window.useIoc = function (token, chatId) {
  const botTokenInput = document.getElementById('botToken');
  const chatInput = document.getElementById('malChatId');
  if (botTokenInput) botTokenInput.value = token;
  if (chatId && chatInput) chatInput.value = chatId;
  if (botTokenInput) botTokenInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showAlert('Filled bot token' + (chatId ? ' and chat id' : '') + '. Review, then click Start.', 'success');
};

window.monitorIoc = async function (token) {
  const durEl = document.getElementById('iocMonitorDur');
  const seconds = durEl ? parseInt(durEl.value, 10) || 600 : 600;
  try {
    const resp = await fetch('/api/monitor/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, seconds }),
    });
    const data = await resp.json();
    if (!resp.ok) { showAlert(data.error || 'Monitor failed', 'error'); return; }
    const mins = Math.round(data.seconds / 60);
    const label = mins >= 60 ? (mins / 60) + 'h' : mins + 'm';
    showAlert(`Monitoring @${data.botUsername || 'bot'} for ${label} — captures show in the Hunt tab (Stop there to end early).`, 'success');
    const huntBtn = document.querySelector('.tab-btn[data-tab="hunt"]');
    if (huntBtn) huntBtn.click();
  } catch (e) {
    showAlert('Connection error. Please try again.', 'error');
  }
};

function renderIoc(data) {
  if (!iocResults) return;
  const results = data.results || [];
  if (!results.length) {
    iocResults.innerHTML = `<div class="empty-state" style="height:auto;padding:24px;"><p>No tokens found (scanned ${data.scanned || 0} results)</p></div>`;
    return;
  }
  const fetchedNote = data.fetched ? ` &middot; fetched ${data.fetched} page(s)` : '';
  const summary = `<div style="margin-bottom:12px;color:#8fb3d9;font-size:0.8rem;">Found <strong style="color:#00d4aa;">${data.tokenCount}</strong> token(s) on <strong style="color:#00d4aa;">${data.withTokens}</strong> host(s) &middot; scanned ${data.scanned}${fetchedNote}.</div>`;
  iocResults.innerHTML = summary + results.map(r => {
    const target = escapeHtml(r.link || r.host || r.ip || '');
    const rows = r.pairs.map(p => {
      const safeToken = escapeHtml(p.token);
      const safeChat = escapeHtml(p.chatId || 'n/a');
      const arg = "'" + p.token + "','" + (p.chatId || '') + "'";
      const statusChip = (p.valid === true)
        ? `<span class="message-id" style="background:rgba(63,185,80,0.2);color:#5ce27a;">live${p.botUsername ? ' @' + escapeHtml(p.botUsername) : ''}</span>`
        : (p.valid === false)
          ? `<span class="message-id" style="background:rgba(244,67,54,0.2);color:#ff8a80;">dead</span>`
          : '';
      return `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);">
          <code style="color:#c8dff5;font-size:0.78rem;word-break:break-all;flex:1;min-width:200px;">${safeToken}</code>
          ${statusChip}
          <span class="message-id">chat_id: ${safeChat}</span>
          <button class="btn btn-secondary" style="padding:6px 12px;" onclick="useIoc(${arg})">Use</button>
          ${p.valid === true ? `<button class="btn btn-warning" style="padding:6px 12px;" onclick="monitorIoc('${p.token}')">Monitor</button>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="message-card">
        <div class="message-card-header">
          <div class="message-card-meta">
            <span class="message-time">${target}</span>
            ${r.date ? `<span class="message-time" style="color:#5c7a99;">${escapeHtml(String(r.date).slice(0, 10))}</span>` : ''}
          </div>
          ${r.title ? `<span class="message-time" style="color:#7a9ec4;">${escapeHtml(r.title)}</span>` : ''}
        </div>
        <div class="message-card-body">${rows}</div>
      </div>`;
  }).join('');
}

if (iocSearchBtn) {
  iocSearchBtn.addEventListener('click', async () => {
    const source = iocSource ? iocSource.value : 'fofa';
    const query = iocQuery ? iocQuery.value.trim() : '';
    const size = iocSize ? parseInt(iocSize.value, 10) || 100 : 100;
    const fetchLinksEl = document.getElementById('iocFetchLinks');
    const fetchLinks = fetchLinksEl ? fetchLinksEl.checked : false;
    const resolveEl = document.getElementById('iocResolve');
    const resolveTokens = resolveEl ? resolveEl.checked : false;

    iocSearchBtn.disabled = true;
    if (iocStatus) iocStatus.textContent = resolveTokens ? 'Searching & querying bots...' : 'Searching...';
    if (iocResults) iocResults.innerHTML = '<div class="empty-state" style="height:auto;padding:24px;"><p>Searching...</p></div>';

    try {
      const resp = await fetch('/api/ioc/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, query, size, fetchLinks, resolveTokens }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showAlert(data.error || 'Search failed', 'error');
        if (iocResults) iocResults.innerHTML = `<div class="empty-state" style="height:auto;padding:24px;"><p>${escapeHtml(data.error || 'Search failed')}</p></div>`;
      } else {
        renderIoc(data);
      }
    } catch (err) {
      showAlert('Connection error. Please try again.', 'error');
    } finally {
      iocSearchBtn.disabled = false;
      if (iocStatus) iocStatus.textContent = 'Find bot tokens leaking on the internet';
    }
  });
}

// ---- TweetFeed threat feed ----
const tfTime = document.getElementById('tfTime');
const tfRefreshBtn = document.getElementById('tfRefreshBtn');
const tfResults = document.getElementById('tfResults');
const tfStatus = document.getElementById('tfStatus');

function renderTweetfeed(data) {
  if (!tfResults) return;
  const results = data.results || [];
  results.forEach(r => (r.iocs || []).forEach(i => {
    const v = String(i.value || '').toLowerCase();
    if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(v)) mbCollected.add(v);
  }));
  if (!results.length) {
    tfResults.innerHTML = feedEmpty(`No tweets mentioning a Telegram bot (checked ${data.checked || 0} of ${data.totalTweets || 0} tweets)`);
    return;
  }
  const summary = `<div class="feed-summary">Found <strong>${data.count}</strong> tweet(s) mentioning a Telegram bot &middot; checked ${data.checked} of ${data.totalTweets} tweets (${escapeHtml(data.window)})</div>`;
  tfResults.innerHTML = summary + results.map(r => {
    const user = r.user || '?';
    const initial = escapeHtml(user.slice(0, 1).toUpperCase());
    const tags = (r.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('');
    const iocs = (r.iocs || []).slice(0, 10).map(i => `<span class="ioc-item ${escapeHtml(i.type || '')}">${escapeHtml(i.value || '')}</span>`).join('');
    const tokens = (r.pairs || []).filter(p => p.token).map(p => {
      const arg = "'" + p.token + "','" + (p.chatId || '') + "'";
      return `<div class="token-line"><code class="token-code">${escapeHtml(p.token)}</code><span class="chip tg">chat_id: ${escapeHtml(p.chatId || 'n/a')}</span><button class="btn-use" onclick="useIoc(${arg})">Use</button></div>`;
    }).join('');
    const tweetLink = r.tweet ? `<a href="${escapeHtml(r.tweet)}" target="_blank" rel="noopener" class="link-open">Open tweet &#8599;</a>` : '';
    return `
      <div class="rcard">
        <div class="rcard-head">
          <div class="author"><span class="avatar">${initial}</span>@${escapeHtml(user)}</div>
          <div class="rcard-head-left">
            <span class="meta-time">${escapeHtml(r.date || '')}</span>
            ${tweetLink}
          </div>
        </div>
        <div class="rcard-body">
          <div class="tweet-text">${escapeHtml(r.text || '')}</div>
          ${iocs ? `<div class="ioc-group"><div class="ioc-group-title">IOCs</div><div class="ioc-list">${iocs}</div></div>` : ''}
          ${tags ? `<div class="chip-row">${tags}</div>` : ''}
          ${tokens}
        </div>
      </div>`;
  }).join('');
}

if (tfRefreshBtn) {
  tfRefreshBtn.addEventListener('click', async () => {
    tfRefreshBtn.disabled = true;
    if (tfStatus) tfStatus.textContent = 'Loading...';
    if (tfResults) tfResults.innerHTML = '<div class="empty-state" style="height:auto;padding:24px;"><p>Loading...</p></div>';
    try {
      const time = tfTime ? tfTime.value : 'week';
      const resp = await fetch(`/api/tweetfeed?time=${encodeURIComponent(time)}`);
      const data = await resp.json();
      if (!resp.ok) {
        showAlert(data.error || 'TweetFeed failed', 'error');
        if (tfResults) tfResults.innerHTML = `<div class="empty-state" style="height:auto;padding:24px;"><p>${escapeHtml(data.error || 'Failed')}</p></div>`;
      } else {
        renderTweetfeed(data);
      }
    } catch (err) {
      showAlert('Connection error. Please try again.', 'error');
    } finally {
      tfRefreshBtn.disabled = false;
      if (tfStatus) tfStatus.textContent = 'Community IOCs from Twitter/X (TweetFeed) - no key needed';
    }
  });
}

// ---- TI Report Dorking ----
const newsSourcesEl = document.getElementById('newsSources');
const newsMinScore = document.getElementById('newsMinScore');
const newsRunBtn = document.getElementById('newsRunBtn');
const newsResults = document.getElementById('newsResults');
const newsStatus = document.getElementById('newsStatus');

async function loadNewsSources() {
  try {
    const resp = await fetch('/api/news/sources');
    const data = await resp.json();
    const sources = data.sources || [];
    if (!newsSourcesEl) return;
    newsSourcesEl.innerHTML = sources.map((s, i) => `
      <label class="src-toggle ${i < 6 ? 'on' : ''}">
        <input type="checkbox" class="news-src" value="${escapeHtml(s)}" ${i < 6 ? 'checked' : ''}>
        <span class="dot"></span>${escapeHtml(s)}
      </label>`).join('');
    newsSourcesEl.querySelectorAll('.news-src').forEach(cb =>
      cb.addEventListener('change', () => cb.closest('.src-toggle').classList.toggle('on', cb.checked)));
  } catch (err) {}
}

function feedEmpty(msg) {
  return `<div class="feed-empty">
    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
    <p>${escapeHtml(msg)}</p></div>`;
}

function selectedNewsSources() {
  return Array.from(document.querySelectorAll('.news-src:checked')).map(el => el.value);
}

function renderNews(data) {
  if (!newsResults) return;
  const results = data.results || [];
  results.forEach(a => ((a.iocs && a.iocs.hashes) || []).forEach(h => mbCollected.add(String(h).toLowerCase())));
  if (!results.length) {
    newsResults.innerHTML = feedEmpty(`No matching reports (scanned ${data.scanned || 0} articles across ${data.dorks || 0} dorks)`);
    return;
  }
  const summary = `<div class="feed-summary">Found <strong>${data.count}</strong> report(s) &middot; scanned ${data.scanned} article(s), ${data.dorks} dorks, min score ${data.minScore}</div>`;
  newsResults.innerHTML = summary + results.map(a => {
    const scoreCls = a.score >= 13 ? 'high' : 'mid';
    const kws = (a.matchedKeywords || []).map(k => `<span class="chip kw">${escapeHtml(k)}</span>`).join('');
    const tg = [];
    (a.telegram.handles || []).forEach(h => tg.push(`<span class="chip tg">${escapeHtml(h)}</span>`));
    (a.telegram.tme || []).slice(0, 4).forEach(u => tg.push(`<span class="chip tg">${escapeHtml(u)}</span>`));
    (a.telegram.api || []).slice(0, 3).forEach(u => tg.push(`<span class="chip tg">${escapeHtml(u)}</span>`));
    const ctx = (a.contexts || []).slice(0, 2).map(c => `<div class="ctx-quote">${escapeHtml(c.context)}</div>`).join('');
    const iocBlock = (() => {
      const io = a.iocs || {};
      const group = (label, arr, cls) => {
        if (!arr || !arr.length) return '';
        const shown = arr.slice(0, 12).map(v => `<span class="ioc-item ${cls}">${escapeHtml(v)}</span>`).join('');
        const more = arr.length > 12 ? `<span class="ioc-item">+${arr.length - 12}</span>` : '';
        return `<div class="ioc-group"><div class="ioc-group-title">${label} &middot; ${arr.length}</div><div class="ioc-list">${shown}${more}</div></div>`;
      };
      return group('IPs', io.ips, 'ip') + group('Domains', io.domains, 'domain') + group('URLs', io.urls, 'url') + group('Hashes', io.hashes, 'hash');
    })();
    return `
      <div class="rcard">
        <div class="rcard-head">
          <div class="rcard-head-left">
            <span class="score-badge ${scoreCls}">&#9733; ${a.score}</span>
            <span class="meta-time">${escapeHtml(a.source)}${a.published_at ? ' &middot; ' + escapeHtml(String(a.published_at).slice(0, 10)) : ''}</span>
          </div>
          ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="link-open">Open report &#8599;</a>` : ''}
        </div>
        <div class="rcard-body">
          <div class="tweet-text" style="font-weight:700;color:#fff;font-size:0.98rem;line-height:1.4;">${escapeHtml(a.title || a.url)}</div>
          ${kws || tg.length ? `<div class="chip-row">${kws}${tg.join('')}</div>` : ''}
          ${iocBlock}
          ${ctx}
        </div>
      </div>`;
  }).join('');
}

if (newsRunBtn) {
  newsRunBtn.addEventListener('click', async () => {
    const sources = selectedNewsSources();
    if (!sources.length) { showAlert('Select at least one source.', 'warning'); return; }
    const minScore = newsMinScore ? parseInt(newsMinScore.value, 10) || 8 : 8;
    newsRunBtn.disabled = true;
    if (newsStatus) newsStatus.textContent = 'Hunting (this can take a while)...';
    if (newsResults) newsResults.innerHTML = '<div class="empty-state" style="height:auto;padding:24px;"><p>Searching dorks and fetching articles...</p></div>';
    try {
      const resp = await fetch('/api/news/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, minScore }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showAlert(data.error || 'News hunt failed', 'error');
        if (newsResults) newsResults.innerHTML = `<div class="empty-state" style="height:auto;padding:24px;"><p>${escapeHtml(data.error || 'Failed')}</p></div>`;
      } else {
        renderNews(data);
      }
    } catch (err) {
      showAlert('Connection error. Please try again.', 'error');
    } finally {
      newsRunBtn.disabled = false;
      if (newsStatus) newsStatus.textContent = 'Google-dork TI blogs via DuckDuckGo (free, no key)';
    }
  });
}

// ---- MalwareBazaar ----
const mbCollected = new Set();
const mbHashes = document.getElementById('mbHashes');
const mbLoadBtn = document.getElementById('mbLoadBtn');
const mbCheckBtn = document.getElementById('mbCheckBtn');
const mbResults = document.getElementById('mbResults');
const mbStatus = document.getElementById('mbStatus');
const mbCheckStatus = document.getElementById('mbCheckStatus');
const mbTelegramResults = document.getElementById('mbTelegramResults');

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i > 0 ? 1 : 0) + ' ' + u[i];
}

function bazaarCards(results = []) {
  return results.map(s => {
    const tags = (s.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('');
    const meta = [];
    if (s.file_type) meta.push(`<span class="chip">${escapeHtml(s.file_type)}</span>`);
    if (s.file_format && s.file_format !== s.file_type) meta.push(`<span class="chip">${escapeHtml(s.file_format)}</span>`);
    if (s.file_arch) meta.push(`<span class="chip">${escapeHtml(s.file_arch)}</span>`);
    if (s.file_size) meta.push(`<span class="chip">${escapeHtml(fmtSize(s.file_size))}</span>`);
    if (s.delivery) meta.push(`<span class="chip">${escapeHtml(s.delivery)}</span>`);
    if (s.origin_country) meta.push(`<span class="chip">country ${escapeHtml(s.origin_country)}</span>`);
    if (s.reporter) meta.push(`<span class="chip">reporter ${escapeHtml(s.reporter)}</span>`);
    if (Number.isFinite(s.downloads)) meta.push(`<span class="chip">${escapeHtml(s.downloads)} downloads</span>`);
    if (Number.isFinite(s.uploads)) meta.push(`<span class="chip">${escapeHtml(s.uploads)} uploads</span>`);
    const hashes = [['sha256', s.sha256], ['sha1', s.sha1], ['md5', s.md5], ['imphash', s.imphash]].filter(x => x[1])
      .map(x => `<div class="ioc-item hash">${x[0]}: ${escapeHtml(x[1])}</div>`).join('');
    const detections = [
      ...(s.detection_sources || []),
      ...(s.yara_rules || []).map(rule => `YARA: ${rule}`),
      ...(s.clamav || []).slice(0, 5).map(name => `ClamAV: ${name}`),
    ].filter(Boolean).map(value => `<span class="chip">${escapeHtml(value)}</span>`).join('');
    const seen = [
      s.first_seen ? `first seen ${String(s.first_seen).slice(0, 16)}` : '',
      s.last_seen ? `last seen ${String(s.last_seen).slice(0, 16)}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="rcard">
        <div class="rcard-head">
          <div class="rcard-head-left">
            <span class="score-badge high">&#9888; ${escapeHtml(s.signature || 'unknown')}</span>
            <span class="meta-time">${escapeHtml(seen)}</span>
          </div>
          ${s.link ? `<a href="${escapeHtml(s.link)}" target="_blank" rel="noopener" class="link-open">View on MalwareBazaar &#8599;</a>` : ''}
        </div>
        <div class="rcard-body">
          <div class="tweet-text" style="font-weight:700;color:#fff;">${escapeHtml(s.file_name || s.sha256 || s.queried)}</div>
          <div class="chip-row">${meta}${tags}</div>
          ${detections ? `<div class="chip-row">${detections}</div>` : ''}
          <div class="ioc-group"><div class="ioc-list" style="flex-direction:column;gap:4px;align-items:flex-start;">${hashes}</div></div>
        </div>
      </div>`;
  }).join('');
}

function renderBazaar(data) {
  if (!mbResults) return;
  const results = data.results || [];
  if (!results.length) {
    mbResults.innerHTML = feedEmpty(`No samples on MalwareBazaar (checked ${data.checked || 0} hash(es))`);
    return;
  }
  const summary = `<div class="feed-summary"><strong>${data.found}</strong> of ${data.checked} hash(es) available on MalwareBazaar</div>`;
  mbResults.innerHTML = summary + bazaarCards(results);
}

function renderTelegramBazaarFeed(data) {
  if (!mbTelegramResults) return;
  if (!data.configured) {
    mbTelegramResults.innerHTML = feedEmpty('Add ABUSECH_AUTH_KEY to .env to load this feed.');
    if (mbStatus) mbStatus.textContent = 'telegram_bot_api YARA · Auth-Key required';
    return;
  }
  const results = data.results || [];
  if (mbStatus) {
    mbStatus.textContent = data.stale
      ? `telegram_bot_api YARA · cached ${timeAgo(data.updated_at)} · refresh failed`
      : data.updated_at
      ? `telegram_bot_api YARA · updated ${timeAgo(data.updated_at)} · every 3 hours`
      : 'telegram_bot_api YARA · waiting for first refresh';
  }
  if (!results.length) {
    mbTelegramResults.innerHTML = feedEmpty('No telegram_bot_api YARA matches were added in the last 14 days.');
    return;
  }
  mbTelegramResults.innerHTML = `
    <div class="feed-summary"><strong>${results.length}</strong> sample(s) matched telegram_bot_api in the last ${escapeHtml(data.window_days || 14)} days</div>
    ${bazaarCards(results)}`;
}

async function loadTelegramBazaarFeed() {
  if (!mbTelegramResults) return;
  try {
    const response = await fetch('/api/malwarebazaar/telegram', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load MalwareBazaar Telegram feed');
    renderTelegramBazaarFeed(data);
  } catch (error) {
    mbTelegramResults.innerHTML = feedEmpty(error.message || 'Could not load MalwareBazaar Telegram feed');
    if (mbStatus) mbStatus.textContent = 'telegram_bot_api YARA · refresh failed';
  }
}

if (mbLoadBtn) {
  mbLoadBtn.addEventListener('click', () => {
    const list = [...mbCollected];
    if (!list.length) { showAlert('No hashes collected yet. Run a TI Report Dorking hunt first.', 'warning'); return; }
    if (mbHashes) mbHashes.value = list.join('\n');
  });
}

if (mbCheckBtn) {
  mbCheckBtn.addEventListener('click', async () => {
    const hashes = (mbHashes ? mbHashes.value : '').split(/[\s,]+/).map(h => h.trim().toLowerCase()).filter(Boolean);
    if (!hashes.length) { showAlert('Paste or load some hashes first.', 'warning'); return; }
    mbCheckBtn.disabled = true;
    if (mbCheckStatus) mbCheckStatus.textContent = 'Checking...';
    if (mbResults) mbResults.innerHTML = feedEmpty('Querying MalwareBazaar...');
    try {
      const resp = await fetch('/api/malwarebazaar/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showAlert(data.error || 'MalwareBazaar check failed', 'error');
        if (mbResults) mbResults.innerHTML = feedEmpty(data.error || 'Failed');
      } else renderBazaar(data);
    } catch (err) {
      showAlert('Connection error. Please try again.', 'error');
    } finally {
      mbCheckBtn.disabled = false;
      if (mbCheckStatus) mbCheckStatus.textContent = 'Optional';
    }
  });
}

// ---- Local MCP Analysis ----
const mcpConnections = document.getElementById('mcpConnections');
const mcpFindings = document.getElementById('mcpFindings');
const mcpStatusText = document.getElementById('mcpStatusText');
const mcpConnectionCount = document.getElementById('mcpConnectionCount');
const mcpFindingCount = document.getElementById('mcpFindingCount');
const mcpTokenCount = document.getElementById('mcpTokenCount');
const mcpChatCount = document.getElementById('mcpChatCount');
const mcpRefreshBtn = document.getElementById('mcpRefreshBtn');
const mcpClearBtn = document.getElementById('mcpClearBtn');
const aiStatusText = document.getElementById('aiStatusText');
const aiProviders = document.getElementById('aiProviders');
const mcpAiFallback = document.getElementById('mcpAiFallback');
const mcpProbeBtn = document.getElementById('mcpProbeBtn');
const mcpScanBtn = document.getElementById('mcpScanBtn');
const mcpScanJobPanel = document.getElementById('mcpScanJobPanel');
const mcpScanJobName = document.getElementById('mcpScanJobName');
const mcpScanJobStage = document.getElementById('mcpScanJobStage');
const mcpScanJobProgressBar = document.getElementById('mcpScanJobProgressBar');
const mcpScanJobMessage = document.getElementById('mcpScanJobMessage');
const mcpScanJobProgress = document.getElementById('mcpScanJobProgress');
const mcpScanJobMeta = document.getElementById('mcpScanJobMeta');
const orcaSettings = document.getElementById('orcaSettings');
const orcaCredentialState = document.getElementById('orcaCredentialState');
const orcaApiKeyInput = document.getElementById('orcaApiKeyInput');
const orcaSaveKeyBtn = document.getElementById('orcaSaveKeyBtn');
const orcaClearKeyBtn = document.getElementById('orcaClearKeyBtn');
const orcaModelSelect = document.getElementById('orcaModelSelect');
const orcaModelTrigger = document.getElementById('orcaModelTrigger');
const orcaModelValue = document.getElementById('orcaModelValue');
const orcaModelList = document.getElementById('orcaModelList');
const orcaRefreshModelsBtn = document.getElementById('orcaRefreshModelsBtn');
const orcaModelHint = document.getElementById('orcaModelHint');

let aiProviderState = [];
let aiEnabledState = true;
let aiPrimaryProvider = 'openai';
let mcpScanJobId = '';
let mcpScanPollTimer = null;
let mcpScanRunning = false;
let mcpConnectedCount = 0;

const ORCA_PROVIDER_ID = 'orcarouter';
const ORCA_MODEL_STORAGE_KEY = 'matkap-orcarouter-model';
let orcaCredential = null;
let orcaModels = [];
let orcaCatalogMeta = null;
let orcaModelsLoaded = false;
let orcaModelsLoading = false;
let orcaSelectedModel = localStorage.getItem(ORCA_MODEL_STORAGE_KEY) || '';
// Monotonic guard: a slow catalog/credential response from an older provider
// selection must never overwrite the current panel state.
let orcaRequestGeneration = 0;

const expectedMcpConnections = [
  { name: 'jadx', label: 'JADX MCP', detail: 'Open an APK in JADX', active: true },
  { name: 'ghidra', label: 'Ghidra MCP', detail: 'SOON', active: false },
  { name: 'binaryninja', label: 'Binary Ninja MCP', detail: 'SOON', active: false },
];

const activeMcpConnections = expectedMcpConnections.filter(item => item.active);

function syncMcpScanButton() {
  if (!mcpScanBtn) return;
  mcpScanBtn.disabled = mcpScanRunning || mcpConnectedCount === 0;
  mcpScanBtn.textContent = mcpScanRunning ? 'JADX scan running...' : 'Scan open JADX project';
}

function renderMcpScanJob(job) {
  if (!mcpScanJobPanel || !job) return;
  const status = String(job.status || 'queued');
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  const details = [];
  if (job.result?.servers?.length) details.push(job.result.servers.join(', '));
  if (Number.isFinite(job.result?.calls)) details.push(`${job.result.calls} MCP calls`);
  if (Number.isFinite(job.result?.findings)) details.push(`${job.result.findings} findings`);
  mcpScanJobPanel.hidden = false;
  mcpScanJobPanel.classList.remove('queued', 'running', 'completed', 'error');
  mcpScanJobPanel.classList.add(status);
  if (mcpScanJobName) mcpScanJobName.textContent = job.result?.summary || 'Connected project scan';
  if (mcpScanJobStage) mcpScanJobStage.textContent = String(job.stage || status).replaceAll('-', ' ');
  if (mcpScanJobProgressBar) mcpScanJobProgressBar.style.width = `${progress}%`;
  if (mcpScanJobMessage) mcpScanJobMessage.textContent = job.error || job.message || 'AI is reading connected MCP tools.';
  if (mcpScanJobProgress) mcpScanJobProgress.textContent = `${progress}%`;
  if (mcpScanJobMeta) mcpScanJobMeta.textContent = details.join(' · ') || 'Read-only MCP access';
  mcpScanJobProgressBar?.parentElement?.setAttribute('aria-valuenow', String(progress));
}

function stopMcpScanPolling() {
  if (mcpScanPollTimer) clearTimeout(mcpScanPollTimer);
  mcpScanPollTimer = null;
}

async function pollMcpScanJob() {
  if (!mcpScanJobId) return;
  try {
    const response = await fetch(`/api/mcp/scans/${encodeURIComponent(mcpScanJobId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'MCP investigation job was not found');
    renderMcpScanJob(data.job);
    if (data.job.status === 'completed') {
      mcpScanJobId = '';
      mcpScanRunning = false;
      stopMcpScanPolling();
      syncMcpScanButton();
      await loadMcpDashboard();
      const total = Number(data.job.result?.findings || 0);
      showAlert(total ? `MCP investigation found ${total} Telegram artifact${total === 1 ? '' : 's'}` : 'MCP investigation complete: no exact Telegram artifacts found', total ? 'success' : 'warning');
      return;
    }
    if (data.job.status === 'error') {
      mcpScanJobId = '';
      mcpScanRunning = false;
      stopMcpScanPolling();
      syncMcpScanButton();
      showAlert(data.job.error || 'MCP investigation failed', 'error');
      return;
    }
    mcpScanPollTimer = setTimeout(pollMcpScanJob, 1200);
  } catch (error) {
    mcpScanJobId = '';
    mcpScanRunning = false;
    stopMcpScanPolling();
    syncMcpScanButton();
    showAlert(error.message || 'Could not read MCP investigation status', 'error');
  }
}

async function startMcpScan() {
  if (mcpScanRunning) return;
  const provider = aiEnabledState && mcpAiFallback?.checked
    ? (selectedAiProviders()[0] || aiPrimaryProvider || '')
    : '';
  mcpScanRunning = true;
  syncMcpScanButton();
  try {
    const payload = { provider };
    const model = selectedOrcaModel();
    if (model) payload.model = model;
    const response = await fetch('/api/mcp/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start MCP investigation');
    mcpScanJobId = data.job.id;
    renderMcpScanJob(data.job);
    await pollMcpScanJob();
  } catch (error) {
    mcpScanRunning = false;
    showAlert(error.message || 'Could not start MCP investigation', 'error');
  } finally {
    syncMcpScanButton();
  }
}

function renderMcpConnections(connections = []) {
  if (!mcpConnections) return;
  const byName = new Map(connections.map(item => [item.name, item]));
  mcpConnections.innerHTML = expectedMcpConnections.map(expected => {
    if (!expected.active) {
      return `
        <div class="mcp-connection planned" aria-disabled="true">
          <span class="mcp-connection-dot" aria-hidden="true"></span>
          <div class="mcp-connection-copy">
            <strong>${escapeHtml(expected.label)}</strong>
            <span>${escapeHtml(expected.detail)}</span>
          </div>
        </div>`;
    }
    const connection = byName.get(expected.name);
    const connected = connection?.connected === true;
    const state = connected ? 'Connected' : connection?.configured ? 'Offline' : 'Not configured';
    const detail = connected && connection.lastSeenAt
      ? `${state} · ${connection.tools || 0} tools · ${timeAgo(connection.lastSeenAt)}`
      : `${state} · ${connection?.error || expected.detail}`;
    return `
      <div class="mcp-connection ${connected ? 'connected' : ''}">
        <span class="mcp-connection-dot" aria-hidden="true"></span>
        <div class="mcp-connection-copy">
          <strong>${escapeHtml(expected.label)}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      </div>`;
  }).join('');
}

function renderMcpFindings(findings = []) {
  if (!mcpFindings) return;
  if (!findings.length) {
    mcpFindings.innerHTML = feedEmpty('No local MCP findings yet');
    return;
  }

  mcpFindings.innerHTML = findings.map(finding => {
    const isToken = finding.kind === 'bot_token';
    const locator = finding.locator?.line ? `line ${finding.locator.line}` : 'MCP evidence';
    const correlatedSources = finding.correlation?.sources || [];
    const correlation = correlatedSources.length > 1
      ? ` / ${correlatedSources.length} correlated sources`
      : '';
    return `
      <article class="mcp-finding ${isToken ? 'bot-token' : 'chat-id'}" id="mcp-finding-${finding.id}">
        <div class="mcp-finding-head">
          <code class="mcp-finding-value">${escapeHtml(finding.maskedValue || '')}</code>
          <span class="mcp-finding-kind">${isToken ? 'BOT TOKEN' : 'CHAT ID'}</span>
        </div>
        <p class="mcp-finding-context">${escapeHtml(finding.context || 'No surrounding text was retained.')}</p>
        <div class="mcp-finding-meta">
          <span>${escapeHtml(finding.source)} / ${escapeHtml(locator)} / ${Math.round((finding.confidence || 0) * 100)}%${escapeHtml(correlation)}</span>
          <div class="mcp-finding-actions">
            ${isToken
              ? `<button class="btn btn-secondary" type="button" data-mcp-reveal="${finding.id}">Reveal</button>
                 <button class="btn btn-secondary" type="button" data-mcp-use="${finding.id}">Use in Hunt</button>`
              : `<button class="btn btn-secondary" type="button" data-mcp-copy="${escapeHtml(finding.maskedValue || '')}">Copy</button>`}
          </div>
        </div>
      </article>`;
  }).join('');
}

function selectedAiProviders() {
  if (!aiProviders) return [];
  return [...aiProviders.querySelectorAll('input[data-ai-provider]:checked')].map(input => input.value);
}

function orcaProviderSelected() {
  return selectedAiProviders()[0] === ORCA_PROVIDER_ID;
}

function renderOrcaCredential(status) {
  orcaCredential = status || null;
  if (!orcaCredentialState) return;
  const configured = status?.configured === true;
  orcaCredentialState.textContent = configured ? `API key saved (${status.masked})` : 'No API key';
  if (orcaClearKeyBtn) orcaClearKeyBtn.disabled = !configured;
  if (orcaSaveKeyBtn) orcaSaveKeyBtn.disabled = false;
}

function setOrcaListOpen(open) {
  if (!orcaModelList || !orcaModelTrigger) return;
  const shouldOpen = Boolean(open) && orcaModels.length > 0;
  orcaModelList.hidden = !shouldOpen;
  orcaModelTrigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

function renderOrcaModels(catalog) {
  orcaCatalogMeta = catalog || null;
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  orcaModels = models;
  let notice = '';
  if (orcaSelectedModel && !models.some(model => model.id === orcaSelectedModel)) {
    // Compatibility changed (provider/catalog refresh): clear the stale value
    // instead of silently sending a model the gateway may no longer serve.
    orcaSelectedModel = '';
    localStorage.removeItem(ORCA_MODEL_STORAGE_KEY);
    notice = 'The previously selected model is no longer available. Choose another model.';
  }
  if (!models.length) orcaSelectedModel = '';
  if (!orcaSelectedModel && models.length) orcaSelectedModel = models[0].id;

  if (orcaModelList) {
    orcaModelList.replaceChildren();
    for (const model of models) {
      const item = document.createElement('li');
      item.className = 'orca-select-option';
      item.setAttribute('role', 'option');
      item.dataset.modelId = model.id;
      item.setAttribute('aria-selected', String(model.id === orcaSelectedModel));
      item.textContent = model.name && model.name !== model.id ? `${model.id} — ${model.name}` : model.id;
      orcaModelList.append(item);
    }
  }
  if (orcaModelValue) {
    orcaModelValue.textContent = models.length ? orcaSelectedModel : 'No compatible models';
  }
  if (orcaModelTrigger) orcaModelTrigger.disabled = !models.length;
  if (!models.length) setOrcaListOpen(false);
  if (orcaModelHint) {
    const parts = [];
    if (catalog?.source === 'live') parts.push(`${models.length} models from the live OrcaRouter catalog`);
    else if (models.length) parts.push(`${models.length} verified fallback models — live catalog unavailable`);
    else parts.push('No models available');
    if (catalog?.degraded) parts.push('degraded');
    const errorText = String(catalog?.error || '').trim();
    if (errorText) parts.push(errorText);
    if (notice) parts.push(notice);
    orcaModelHint.textContent = parts.join(' · ');
    orcaModelHint.classList.toggle('orca-degraded', Boolean(catalog?.degraded || errorText));
  }
}

async function loadOrcaModels({ refresh = false } = {}) {
  const generation = orcaRequestGeneration;
  orcaModelsLoading = true;
  if (orcaRefreshModelsBtn) orcaRefreshModelsBtn.disabled = true;
  try {
    const url = `/api/ai/models?provider=${ORCA_PROVIDER_ID}&capability=chat${refresh ? '&refresh=1' : ''}`;
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (generation !== orcaRequestGeneration || !orcaProviderSelected()) return;
    if (!response.ok) {
      renderOrcaModels({ source: 'error', degraded: true, models: [], error: data.error || 'Model discovery failed.' });
      return;
    }
    renderOrcaModels(data);
  } catch (error) {
    if (generation !== orcaRequestGeneration || !orcaProviderSelected()) return;
    renderOrcaModels({ source: 'error', degraded: true, models: [], error: 'Could not reach the OrcaRouter model catalog.' });
  } finally {
    orcaModelsLoading = false;
    if (orcaRefreshModelsBtn) orcaRefreshModelsBtn.disabled = false;
  }
}

async function loadOrcaCredential() {
  const generation = orcaRequestGeneration;
  try {
    const response = await fetch('/api/orcarouter/credential', { cache: 'no-store' });
    const data = await response.json();
    if (generation !== orcaRequestGeneration || !orcaProviderSelected()) return;
    if (!response.ok) throw new Error(data.error || 'Could not read the OrcaRouter credential state.');
    renderOrcaCredential(data);
  } catch (error) {
    if (generation !== orcaRequestGeneration || !orcaProviderSelected()) return;
    if (orcaCredentialState) orcaCredentialState.textContent = 'Status unavailable';
  }
}

async function loadOrcaSettings({ refreshModels = false } = {}) {
  orcaRequestGeneration += 1;
  orcaModelsLoaded = true;
  await Promise.all([loadOrcaCredential(), loadOrcaModels({ refresh: refreshModels })]);
}

function syncOrcaPanel() {
  if (!orcaSettings) return;
  const active = orcaProviderSelected();
  orcaSettings.hidden = !active;
  if (active) {
    if (!orcaModelsLoaded && !orcaModelsLoading) void loadOrcaSettings();
    return;
  }
  // Leaving the provider invalidates in-flight responses for its panel.
  orcaRequestGeneration += 1;
  setOrcaListOpen(false);
}

function selectedOrcaModel() {
  if (!orcaProviderSelected()) return '';
  return orcaModels.some(model => model.id === orcaSelectedModel) ? orcaSelectedModel : '';
}

function renderAiProviders(data = {}) {
  if (!aiProviders) return;
  const previouslySelected = new Set(selectedAiProviders());
  aiProviderState = data.providers || [];
  aiEnabledState = data.enabled !== false;
  aiPrimaryProvider = data.primary || 'openai';
  const configured = aiProviderState.filter(provider => provider.configured);
  // OrcaRouter stays selectable without a key so its settings panel (API-key
  // entry, model list) is reachable from the UI.
  const selectable = aiProviderState.filter(provider => provider.configured || provider.id === ORCA_PROVIDER_ID);
  if (!previouslySelected.size) {
    previouslySelected.add(selectable.find(provider => provider.id === aiPrimaryProvider)?.id || selectable[0]?.id);
  }
  const selected = [...previouslySelected].find(id => selectable.some(provider => provider.id === id))
    || selectable.find(provider => provider.id === aiPrimaryProvider)?.id
    || selectable[0]?.id;
  aiProviders.innerHTML = aiProviderState.map(provider => {
    const enabled = provider.configured || provider.id === ORCA_PROVIDER_ID;
    const checked = enabled && selected === provider.id;
    return `
      <label class="mcp-ai-provider ${enabled ? '' : 'unconfigured'}" title="${escapeHtml(provider.model)}">
        <input type="radio" name="mcp-ai-provider" data-ai-provider value="${escapeHtml(provider.id)}"
          ${checked ? 'checked' : ''} ${enabled && aiEnabledState ? '' : 'disabled'}>
        <span class="mcp-ai-provider-copy">${escapeHtml(provider.label)}</span>
      </label>`;
  }).join('');
  if (aiStatusText) {
    aiStatusText.textContent = !aiEnabledState
      ? 'AI disabled'
      : configured.length
        ? `${configured.length} provider${configured.length === 1 ? '' : 's'} ready`
        : 'Add an API key to .env';
  }
  syncOrcaPanel();
  syncMcpScanButton();
}

async function loadMcpDashboard() {
  if (!mcpConnections || !mcpFindings) return;
  try {
    const [statusResponse, findingsResponse, providersResponse] = await Promise.all([
      fetch('/api/mcp/status', { cache: 'no-store' }),
      fetch('/api/mcp/findings', { cache: 'no-store' }),
      fetch('/api/ai/providers', { cache: 'no-store' }),
    ]);
    const status = await statusResponse.json();
    const findingData = await findingsResponse.json();
    const providerData = await providersResponse.json();
    const connectedNames = new Set((status.connections || []).filter(item => item.connected).map(item => item.name));
    const connected = activeMcpConnections.filter(item => connectedNames.has(item.name)).length;
    mcpConnectedCount = connected;
    if (mcpConnectionCount) mcpConnectionCount.textContent = `${connected} / ${activeMcpConnections.length}`;
    if (mcpFindingCount) mcpFindingCount.textContent = String(status.findings || 0);
    if (mcpTokenCount) mcpTokenCount.textContent = String(status.tokens || 0);
    if (mcpChatCount) mcpChatCount.textContent = String(status.chatIds || 0);
    if (mcpStatusText) mcpStatusText.textContent = connected
      ? 'JADX MCP online'
      : 'Waiting for JADX MCP';
    renderMcpConnections(status.connections || []);
    renderMcpFindings(findingData.findings || []);
    renderAiProviders(providerData);
    syncMcpScanButton();
  } catch (error) {
    if (mcpStatusText) mcpStatusText.textContent = 'Local MCP service unavailable';
  }
}

async function revealMcpFinding(id) {
  const response = await fetch(`/api/mcp/findings/${encodeURIComponent(id)}/reveal`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not reveal finding');
  return data.finding;
}

if (mcpRefreshBtn) mcpRefreshBtn.addEventListener('click', loadMcpDashboard);

if (mcpProbeBtn) {
  mcpProbeBtn.addEventListener('click', async () => {
    mcpProbeBtn.disabled = true;
    mcpProbeBtn.textContent = 'Connecting...';
    try {
      const response = await fetch('/api/mcp/probe', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not connect JADX');
      await loadMcpDashboard();
      const online = (data.connections || []).filter(item => item.connected).length;
      showAlert(online ? 'JADX MCP connected' : 'JADX MCP is offline', online ? 'success' : 'warning');
    } catch (error) {
      showAlert(error.message || 'Could not connect JADX', 'error');
    } finally {
      mcpProbeBtn.disabled = false;
      mcpProbeBtn.textContent = 'Connect JADX';
    }
  });
}

if (mcpScanBtn) mcpScanBtn.addEventListener('click', startMcpScan);
if (mcpAiFallback) mcpAiFallback.addEventListener('change', syncMcpScanButton);

if (mcpClearBtn) {
  mcpClearBtn.addEventListener('click', async () => {
    const response = await fetch('/api/mcp/findings', { method: 'DELETE' });
    if (!response.ok) return showAlert('Could not clear MCP findings', 'error');
    await loadMcpDashboard();
    showAlert('Local MCP findings cleared', 'success');
  });
}

if (aiProviders) {
  aiProviders.addEventListener('change', () => {
    syncOrcaPanel();
    syncMcpScanButton();
  });
}

function selectOrcaModel(modelId) {
  if (!orcaModels.some(model => model.id === modelId)) return;
  orcaSelectedModel = modelId;
  localStorage.setItem(ORCA_MODEL_STORAGE_KEY, modelId);
  if (orcaModelValue) orcaModelValue.textContent = modelId;
  if (orcaModelList) {
    for (const option of orcaModelList.querySelectorAll('[data-model-id]')) {
      option.setAttribute('aria-selected', String(option.dataset.modelId === modelId));
    }
  }
  setOrcaListOpen(false);
}

if (orcaModelTrigger) {
  orcaModelTrigger.addEventListener('click', () => {
    setOrcaListOpen(orcaModelList?.hidden !== false);
  });
}

if (orcaModelList) {
  orcaModelList.addEventListener('click', event => {
    const option = event.target.closest('[data-model-id]');
    if (option) selectOrcaModel(option.dataset.modelId);
  });
}

document.addEventListener('click', event => {
  if (!orcaModelSelect || orcaModelSelect.contains(event.target)) return;
  setOrcaListOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setOrcaListOpen(false);
});

if (orcaRefreshModelsBtn) {
  orcaRefreshModelsBtn.addEventListener('click', () => {
    void loadOrcaModels({ refresh: true });
  });
}

if (orcaSaveKeyBtn) {
  orcaSaveKeyBtn.addEventListener('click', async () => {
    const apiKey = String(orcaApiKeyInput?.value || '').trim();
    if (!apiKey) return showAlert('Enter an OrcaRouter API key first', 'warning');
    orcaSaveKeyBtn.disabled = true;
    try {
      const response = await fetch('/api/orcarouter/credential', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the OrcaRouter API key.');
      if (orcaApiKeyInput) orcaApiKeyInput.value = '';
      renderOrcaCredential(data);
      await loadOrcaModels({ refresh: true });
      await loadMcpDashboard();
      showAlert('OrcaRouter API key saved', 'success');
    } catch (error) {
      showAlert(error.message || 'Could not save the OrcaRouter API key.', 'error');
    } finally {
      if (orcaSaveKeyBtn) orcaSaveKeyBtn.disabled = false;
    }
  });
}

if (orcaClearKeyBtn) {
  orcaClearKeyBtn.addEventListener('click', async () => {
    orcaClearKeyBtn.disabled = true;
    try {
      const response = await fetch('/api/orcarouter/credential', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not clear the OrcaRouter API key.');
      renderOrcaCredential(data);
      await loadOrcaModels({ refresh: true });
      await loadMcpDashboard();
      showAlert('OrcaRouter API key cleared', 'success');
    } catch (error) {
      showAlert(error.message || 'Could not clear the OrcaRouter API key.', 'error');
    } finally {
      if (orcaClearKeyBtn) orcaClearKeyBtn.disabled = false;
    }
  });
}

if (mcpFindings) {
  mcpFindings.addEventListener('click', async event => {
    const revealButton = event.target.closest('[data-mcp-reveal]');
    const useButton = event.target.closest('[data-mcp-use]');
    const copyButton = event.target.closest('[data-mcp-copy]');
    try {
      if (copyButton) {
        await navigator.clipboard.writeText(copyButton.dataset.mcpCopy || '');
        showAlert('Copied to clipboard', 'success');
        return;
      }

      const id = revealButton?.dataset.mcpReveal || useButton?.dataset.mcpUse;
      if (!id) return;
      const finding = await revealMcpFinding(id);

      if (revealButton) {
        const value = document.querySelector(`#mcp-finding-${id} .mcp-finding-value`);
        if (value) value.textContent = finding.value;
        revealButton.textContent = 'Revealed';
        revealButton.disabled = true;
      }

      if (useButton) {
        const tokenInput = document.getElementById('botToken');
        const chatInput = document.getElementById('malChatId');
        if (tokenInput) tokenInput.value = finding.value;
        if (chatInput && finding.chatId) chatInput.value = finding.chatId;
        const huntTab = document.getElementById('nav-hunt');
        if (huntTab) activateWorkspaceTab(huntTab, true);
        showAlert('Finding loaded into Hunt', 'success');
      }
    } catch (error) {
      showAlert(error.message || 'MCP finding action failed', 'error');
    }
  });
}

// ---- Threat Statistics ----
const threatStatsStatus = document.getElementById('threatStatsStatus');
const threatStatsSummary = document.getElementById('threatStatsSummary');
const statsTypePie = document.getElementById('statsTypePie');
const statsTypeLegend = document.getElementById('statsTypeLegend');
const statsFamilyBars = document.getElementById('statsFamilyBars');
const statsNameBars = document.getElementById('statsNameBars');
const statsCampaignBars = document.getElementById('statsCampaignBars');
const statsReportBars = document.getElementById('statsReportBars');
const statsTimeline = document.getElementById('statsTimeline');
const statsPeriodButtons = [...document.querySelectorAll('[data-stats-days]')];
const statsPalette = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#f97316'];
let threatStatsDays = 14;

function statsEmpty(message) {
  return `<div class="stats-empty">${escapeHtml(message)}</div>`;
}

function renderStatsBars(container, rows, emptyMessage) {
  if (!container) return;
  if (!rows?.length) {
    container.innerHTML = statsEmpty(emptyMessage);
    return;
  }
  const max = Math.max(...rows.map(row => Number(row.count) || 0), 1);
  container.innerHTML = rows.map(row => `
    <div class="stats-bar-row" title="${escapeHtml(row.label)}: ${escapeHtml(row.count)}">
      <span class="stats-bar-label">${escapeHtml(row.label)}</span>
      <span class="stats-bar-track"><span class="stats-bar-fill" style="width:${Math.max(2, (row.count / max) * 100)}%"></span></span>
      <strong>${escapeHtml(row.count)}</strong>
    </div>`).join('');
}

function renderStatsPie(rows = []) {
  if (!statsTypePie || !statsTypeLegend) return;
  const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  if (!total) {
    statsTypePie.style.background = 'var(--bg-3)';
    statsTypeLegend.innerHTML = statsEmpty('No file-type metadata');
    return;
  }
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += (row.count / total) * 100;
    return `${statsPalette[index % statsPalette.length]} ${start}% ${cursor}%`;
  });
  statsTypePie.style.background = `conic-gradient(${segments.join(',')})`;
  statsTypePie.setAttribute('aria-label', `${total} malware samples grouped by file type`);
  statsTypeLegend.innerHTML = rows.map((row, index) => `
    <div class="stats-legend-row">
      <span class="stats-legend-swatch" style="background:${statsPalette[index % statsPalette.length]}"></span>
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.count)}</strong>
    </div>`).join('');
}

function renderStatsTimeline(rows = []) {
  if (!statsTimeline) return;
  if (!rows.length) {
    statsTimeline.innerHTML = statsEmpty('No dated activity');
    return;
  }
  const max = Math.max(...rows.flatMap(row => [row.malware, row.reports, row.feed]), 1);
  const labelEvery = rows.length <= 7 ? 1 : rows.length <= 14 ? 2 : 5;
  statsTimeline.innerHTML = rows.map((row, index) => {
    const label = index % labelEvery === 0 || index === rows.length - 1 ? row.date.slice(5) : '';
    const bar = (kind, value) => `<span class="stats-day-bar ${kind}" style="height:${value ? Math.max(3, (value / max) * 100) : 0}%;opacity:${value ? 1 : 0}" aria-hidden="true"></span>`;
    return `<div class="stats-day" title="${escapeHtml(row.date)} · malware ${row.malware} · reports ${row.reports} · feed ${row.feed}">
      ${bar('malware', row.malware)}${bar('reports', row.reports)}${bar('feed', row.feed)}
      <span class="stats-day-label">${escapeHtml(label)}</span>
    </div>`;
  }).join('');
}

function renderThreatStatistics(data) {
  const summary = data.summary || {};
  if (threatStatsSummary) {
    threatStatsSummary.innerHTML = [
      ['Malware', summary.malware || 0],
      ['Reports', summary.reports || 0],
      ['Feed Signals', summary.feed || 0],
      ['Families', summary.families || 0],
      ['Campaigns', summary.campaigns || 0],
    ].map(([label, value]) => `<div class="stats-summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }
  renderStatsPie(data.dimensions?.types || []);
  renderStatsBars(statsFamilyBars, data.dimensions?.families || [], 'No family metadata in this period');
  renderStatsBars(statsNameBars, data.dimensions?.names || [], 'No malware filename metadata in this period');
  renderStatsBars(statsCampaignBars, data.dimensions?.campaigns || [], 'No explicit campaign metadata in this period');
  renderStatsBars(statsReportBars, data.dimensions?.report_sources || [], 'No dated reports in this period');
  renderStatsTimeline(data.timeline || []);
  if (threatStatsStatus) {
    const undated = Number(data.coverage?.reports_without_date || 0);
    const exclusions = undated ? ` · ${undated} undated report(s) excluded` : '';
    threatStatsStatus.textContent = `${data.days}-day view · MalwareBazaar YARA, TweetFeed, and TI reports${exclusions}`;
  }
}

async function loadThreatStatistics(days = threatStatsDays) {
  if (!threatStatsSummary) return;
  threatStatsDays = Number(days) || 14;
  statsPeriodButtons.forEach(button => button.classList.toggle('active', Number(button.dataset.statsDays) === threatStatsDays));
  if (threatStatsStatus) threatStatsStatus.textContent = `Loading ${threatStatsDays}-day statistics...`;
  try {
    const response = await fetch(`/api/statistics/threats?days=${encodeURIComponent(threatStatsDays)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load threat statistics');
    renderThreatStatistics(data);
  } catch (error) {
    threatStatsSummary.innerHTML = statsEmpty(error.message || 'Could not load threat statistics');
    if (threatStatsStatus) threatStatsStatus.textContent = 'Statistics unavailable';
  }
}

statsPeriodButtons.forEach(button => button.addEventListener('click', () => loadThreatStatistics(button.dataset.statsDays)));

// ---- Tabs ----
const workspaceTabs = [...document.querySelectorAll('.tab-btn')];

function activateWorkspaceTab(btn, moveFocus = false) {
  workspaceTabs.forEach(b => {
    const active = b === btn;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('tab-' + btn.dataset.tab);
  if (pane) pane.classList.add('active');
  if (moveFocus) btn.focus();
}

workspaceTabs.forEach((btn, index) => {
  btn.addEventListener('click', () => {
    activateWorkspaceTab(btn);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  btn.addEventListener('keydown', event => {
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % workspaceTabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = workspaceTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateWorkspaceTab(workspaceTabs[nextIndex], true);
  });
});

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  return Math.floor(m / 60) + 'h ago';
}

async function loadCachedFeeds() {
  try {
    const tf = await (await fetch('/api/feeds/tweetfeed')).json();
    if (tf.cached && tf.results) {
      renderTweetfeed(tf);
      if (tfStatus) tfStatus.textContent = `Auto-cached · updated ${timeAgo(tf.updated_at)}`;
    }
  } catch (e) {}
  try {
    const nw = await (await fetch('/api/feeds/news')).json();
    if (nw.cached && nw.results) {
      renderNews(nw);
      if (newsStatus) newsStatus.textContent = `Auto-cached · updated ${timeAgo(nw.updated_at)}`;
    }
  } catch (e) {}
}

loadAccounts();
loadIocSources();
loadNewsSources();
loadCachedFeeds();
loadTelegramBazaarFeed();
loadMcpDashboard();
loadThreatStatistics();
updateLogs();
updateMessages();
setInterval(updateLogs, 2000);
setInterval(updateMessages, 2000);
setInterval(loadMcpDashboard, 5000);
setInterval(loadTelegramBazaarFeed, 5 * 60 * 1000);
setInterval(() => loadThreatStatistics(threatStatsDays), 5 * 60 * 1000);
