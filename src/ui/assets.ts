export const APP_CSS = String.raw`
:root {
  color-scheme: light;
  --bg: #f7f7f4;
  --surface: #ffffff;
  --surface-raised: #fbfbf8;
  --text: #191917;
  --muted: #6f6c64;
  --faint: #a8a39a;
  --border: #dedbd2;
  --accent: #256f66;
  --accent-soft: #dcefeb;
  --tool: #7a5d1b;
  --error: #a33b35;
  --success: #2f7b42;
  --shadow: 0 18px 48px rgba(30, 29, 25, 0.12);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.dark {
  color-scheme: dark;
  --bg: #151512;
  --surface: #1d1d19;
  --surface-raised: #24231f;
  --text: #f4f1e8;
  --muted: #aaa59a;
  --faint: #777267;
  --border: #36342e;
  --accent: #7ac6b7;
  --accent-soft: #203d38;
  --tool: #d0b15a;
  --error: #df756d;
  --success: #7fcd8e;
  --shadow: 0 20px 54px rgba(0, 0, 0, 0.28);
}

* { box-sizing: border-box; }
html, body, #app { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  letter-spacing: 0;
}

.shell {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--bg);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 58px;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
}

.agent-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
}

.agent-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 700;
}

.scope-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.icon-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.icon-button:hover { background: var(--surface-raised); }

.timeline {
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  scroll-behavior: smooth;
}

.timeline-inner {
  width: min(900px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.58rem;
}

.state {
  margin: 2rem auto;
  color: var(--muted);
  font-size: 0.85rem;
}

.entry {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  max-width: 82%;
  animation: entry-in 0.14s ease-out;
}

@keyframes entry-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.entry.user {
  align-self: flex-end;
  align-items: flex-end;
}

.entry.assistant,
.entry.tool,
.entry.system {
  align-self: flex-start;
}

.bubble {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.62rem 0.74rem;
  background: var(--surface);
  box-shadow: none;
  line-height: 1.48;
  font-size: 0.9rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.entry.user .bubble {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  background: var(--accent-soft);
}

.entry.assistant .bubble {
  background: transparent;
  border-color: transparent;
  padding-left: 0;
  padding-right: 0;
}

.entry.thinking .bubble {
  color: var(--muted);
  border-color: transparent;
  background: transparent;
  font-size: 0.8rem;
  font-style: italic;
}

.meta {
  display: flex;
  gap: 0.35rem;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 0.62rem;
}

.channel {
  color: var(--accent);
}

.tool-card {
  width: min(650px, 100%);
  border-left: 1px solid var(--border);
  padding: 0.16rem 0 0.16rem 0.65rem;
}

.tool-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
  min-height: 30px;
  border-radius: 4px;
  color: var(--text);
}

.tool-icon {
  width: 13px;
  height: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--success);
  font-size: 0.7rem;
}

.tool-card.running .tool-icon {
  border: 1.5px solid color-mix(in srgb, var(--tool) 24%, transparent);
  border-top-color: var(--tool);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  color: transparent;
}

.tool-card.error .tool-icon {
  color: var(--error);
}

@keyframes spin { to { transform: rotate(360deg); } }

.tool-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 650;
}

.tool-args,
.tool-result {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.66rem;
}

.tool-status {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.64rem;
}

.composer {
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 93%, transparent);
  padding: 0.75rem;
}

.composer-inner {
  width: min(900px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.55rem;
  align-items: end;
}

textarea {
  width: 100%;
  min-height: 44px;
  max-height: 160px;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.72rem 0.82rem;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  line-height: 1.35;
  outline: none;
}

textarea:focus {
  border-color: color-mix(in srgb, var(--accent) 62%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.send {
  height: 44px;
  min-width: 44px;
  border: 1px solid color-mix(in srgb, var(--accent) 65%, var(--border));
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg);
  font-weight: 700;
  cursor: pointer;
}

.send:disabled {
  opacity: 0.45;
  cursor: default;
}

.error-banner {
  width: min(900px, 100%);
  margin: 0 auto 0.55rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid color-mix(in srgb, var(--error) 38%, var(--border));
  border-radius: 6px;
  color: var(--error);
  font-size: 0.8rem;
}

@media (max-width: 680px) {
  .topbar { min-height: 54px; padding: 0.65rem 0.75rem; }
  .timeline { padding: 0.75rem; }
  .entry { max-width: 94%; }
  .composer { padding: 0.62rem; }
  .scope-label { display: none; }
}
`;

export const APP_JS = String.raw`
const root = document.getElementById('app');
const pathParts = window.location.pathname.split('/').filter(Boolean);
const agentId = pathParts[1] || '';

const state = {
  session: null,
  entries: [],
  streaming: null,
  tools: new Map(),
  loading: true,
  sending: false,
  error: null,
};

function api(path) {
  return '/api/agents/' + encodeURIComponent(agentId) + path;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function contentText(entry) {
  return (entry.content || []).map((block) => {
    if (block.type === 'text') return block.text || '';
    if (block.type === 'thinking') return block.thinking || '';
    return '';
  }).filter(Boolean).join('');
}

function upsertEntry(entry) {
  if (!entry || !entry.id) return;
  const index = state.entries.findIndex((candidate) => candidate.id === entry.id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.push(entry);
  state.entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
}

function render() {
  const agentName = state.session?.agent?.name || root?.dataset.agentName || 'Flight';
  const scope = state.session?.scope;
  const scopeLabel = scope ? scope.kind + ':' + scope.id : 'loading';
  root.innerHTML = [
    '<section class="shell">',
      '<header class="topbar">',
        '<div class="agent-title">',
          '<div class="agent-name">' + escapeHtml(agentName) + '</div>',
          '<div class="scope-label">' + escapeHtml(scopeLabel) + '</div>',
        '</div>',
        '<div class="top-actions">',
          '<button class="icon-button" id="themeButton" title="Toggle theme" aria-label="Toggle theme">T</button>',
        '</div>',
      '</header>',
      '<section class="timeline" id="timeline"><div class="timeline-inner">' + renderTimeline() + '</div></section>',
      '<footer class="composer">' + renderComposer() + '</footer>',
    '</section>',
  ].join('');

  const button = document.getElementById('themeButton');
  if (button) button.addEventListener('click', toggleTheme);
  const form = document.getElementById('composerForm');
  const input = document.getElementById('messageInput');
  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void sendMessage(input.value);
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void sendMessage(input.value);
      }
    });
  }
  const timeline = document.getElementById('timeline');
  if (timeline) timeline.scrollTop = timeline.scrollHeight;
}

function renderTimeline() {
  if (state.loading) return '<div class="state">Loading...</div>';
  const items = state.entries.map(renderEntry);
  if (state.streaming) items.push(renderEntry(state.streaming, true));
  if (items.length === 0) items.push('<div class="state">No messages yet.</div>');
  return items.join('');
}

function renderEntry(entry, isStreaming) {
  if (!entry) return '';
  if (entry.type === 'tool_call' || entry.type === 'tool_result') return renderToolEntry(entry);
  const role = entry.role || 'system';
  const thinking = (entry.content || []).find((block) => block.type === 'thinking');
  const text = contentText(entry);
  if (!text && !thinking) return '';
  const klass = thinking && !text ? 'entry thinking' : 'entry ' + role;
  const channel = entry.channel || entry.adapter || '';
  const showUserName = role === 'user' && entry.userName;
  const showWriting = isStreaming === true && String(entry.id || '').startsWith('streaming-');
  return [
    '<article class="' + klass + '">',
      '<div class="meta">',
        '<span>' + escapeHtml(formatTime(entry.timestamp)) + '</span>',
        channel ? '<span class="channel">' + escapeHtml(channel) + '</span>' : '',
        showUserName ? '<span>' + escapeHtml(entry.userName) + '</span>' : '',
        showWriting ? '<span>writing</span>' : '',
      '</div>',
      '<div class="bubble">' + escapeHtml(text || thinking?.thinking || '') + '</div>',
    '</article>',
  ].join('');
}

function renderToolEntry(entry) {
  const call = (entry.content || []).find((block) => block.type === 'toolCall');
  const result = (entry.content || []).find((block) => block.type === 'toolResult');
  const id = call?.id || result?.toolCallId || '';
  const companion = id ? state.tools.get(id) : null;
  const name = call?.label || call?.name || companion?.name || 'Tool';
  const args = call?.arguments || companion?.arguments || {};
  const resultText = result?.result || companion?.result || '';
  const isError = Boolean(result?.isError || companion?.isError);
  const status = resultText ? (isError ? 'error' : 'done') : 'running';
  const argsText = Object.keys(args).length ? JSON.stringify(args) : '';
  return [
    '<article class="entry tool">',
      '<div class="tool-card ' + status + '">',
        '<div class="tool-row">',
          '<span class="tool-icon">' + (status === 'done' ? 'ok' : status === 'error' ? '!' : '') + '</span>',
          '<span class="tool-title">',
            '<span class="tool-name">' + escapeHtml(name) + '</span>',
            argsText ? '<span class="tool-args">' + escapeHtml(argsText) + '</span>' : '',
            resultText ? '<span class="tool-result">' + escapeHtml(resultText) + '</span>' : '',
          '</span>',
          '<span class="tool-status">' + (status === 'running' ? 'running' : status) + '</span>',
        '</div>',
      '</div>',
    '</article>',
  ].join('');
}

function renderComposer() {
  return [
    state.error ? '<div class="error-banner">' + escapeHtml(state.error) + '</div>' : '',
    '<form class="composer-inner" id="composerForm">',
      '<textarea id="messageInput" placeholder="Message ' + escapeHtml(state.session?.agent?.name || 'Flight') + '" rows="1" ' + (state.sending ? 'disabled' : '') + '></textarea>',
      '<button class="send" type="submit" title="Send" aria-label="Send" ' + (state.sending ? 'disabled' : '') + '>Send</button>',
    '</form>',
  ].join('');
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

async function loadSession() {
  const response = await fetch(api('/session'), { credentials: 'include' });
  if (response.status === 401) {
    window.location.href = 'https://tinyfat.com/login?redirect=' + encodeURIComponent(window.location.href);
    return;
  }
  if (!response.ok) throw new Error('Session failed: ' + response.status);
  state.session = await response.json();
}

async function loadHistory() {
  const response = await fetch(api('/awareness?limit=120'), { credentials: 'include' });
  if (!response.ok) throw new Error('History failed: ' + response.status);
  const page = await response.json();
  state.entries = Array.isArray(page.entries) ? page.entries : [];
}

function connectAwarenessStream() {
  const source = new EventSource(api('/awareness/stream'));
  source.onmessage = (event) => {
    try {
      upsertEntry(JSON.parse(event.data));
      render();
    } catch {
      // ignore malformed keepalive payloads
    }
  };
  source.onerror = () => {
    source.close();
    setTimeout(connectAwarenessStream, 3000);
  };
}

async function sendMessage(raw) {
  const message = String(raw || '').trim();
  if (!message || state.sending) return;
  state.sending = true;
  state.error = null;
  state.streaming = {
    id: 'streaming-' + Date.now(),
    type: 'message',
    timestamp: new Date().toISOString(),
    role: 'assistant',
    adapter: 'web',
    content: [{ type: 'text', text: '' }],
  };
  upsertEntry({
    id: 'pending-user-' + Date.now(),
    type: 'message',
    timestamp: new Date().toISOString(),
    role: 'user',
    adapter: 'web',
    channel: state.session?.scope?.id || 'web',
    userName: state.session?.user?.email || 'you',
    content: [{ type: 'text', text: message }],
  });
  render();

  try {
    const response = await fetch(api('/messages'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok || !response.body) throw new Error(await response.text());
    await readSseResponse(response, handleStreamEvent);
    await loadHistory();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.sending = false;
    state.streaming = null;
    render();
  }
}

async function readSseResponse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
      if (!lines.length) continue;
      const data = lines.map((line) => line.slice(5).trimStart()).join('\n');
      onEvent(JSON.parse(data));
    }
  }
}

function handleStreamEvent(event) {
  if (!event || !state.streaming) return;
  if (event.type === 'text_delta') {
    const block = state.streaming.content.find((item) => item.type === 'text');
    block.text += event.text || '';
  }
  if (event.type === 'thinking_delta') {
    let block = state.streaming.content.find((item) => item.type === 'thinking');
    if (!block) {
      block = { type: 'thinking', thinking: '' };
      state.streaming.content.unshift(block);
    }
    block.thinking += event.text || '';
  }
  if (event.type === 'tool_start') {
    state.tools.set(event.toolCallId, {
      name: event.label || event.toolName,
      arguments: event.args || {},
    });
    upsertEntry({
      id: 'live-tool-' + event.toolCallId,
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      role: 'assistant',
      adapter: 'web',
      content: [{ type: 'toolCall', id: event.toolCallId, name: event.toolName, arguments: event.args || {}, label: event.label }],
    });
  }
  if (event.type === 'tool_result') {
    const current = state.tools.get(event.toolCallId) || {};
    state.tools.set(event.toolCallId, { ...current, result: event.result || '', isError: Boolean(event.isError) });
    upsertEntry({
      id: 'live-tool-result-' + event.toolCallId,
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      role: 'tool',
      adapter: 'web',
      content: [{ type: 'toolResult', toolCallId: event.toolCallId, result: event.result || '', isError: Boolean(event.isError) }],
    });
  }
  if (event.type === 'assistant_message' && Array.isArray(event.content)) {
    state.streaming.content = event.content;
  }
  if (event.type === 'error') state.error = event.message || 'Flight turn failed.';
  render();
}

async function boot() {
  try {
    await loadSession();
    await loadHistory();
    state.loading = false;
    render();
    connectAwarenessStream();
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

void boot();
`;
