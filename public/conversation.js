import * as smd from '/vendor/smd.min.js';

const conversationId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const pendingEl = document.getElementById('pending-question');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const stopIcon = document.getElementById('stop-icon');

const OTHER_VALUE = '__other__';
const NEAR_BOTTOM_PX = 64;
const BUSY_STATUSES = new Set(['queued', 'streaming']);

const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// id -> DOM node, for entries we've already rendered and may need to update in place
// (tool_call/tool_result/diff sharing an id, or task-list updates).
const activityNodes = new Map();
const historyIds = new Set();
const subagentGroups = new Map(); // subagent.id -> group body element (holds the activity items)
let taskListEl = null;
let streaming = null; // { node, contentEl, parser, written, key }
let firstRender = true;
let pendingQuestionKey = null;

// visualViewport follows the visible area when a mobile keyboard opens.
function syncViewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.body.style.setProperty('--app-height', `${height}px`);
  document.body.classList.toggle('compact-viewport', height < 450);
}
syncViewport();
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('resize', syncViewport);

function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < NEAR_BOTTOM_PX;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function insertAtEnd(node) {
  if (streaming && streaming.node.isConnected) {
    messagesEl.insertBefore(node, streaming.node);
  } else {
    messagesEl.appendChild(node);
  }
}

function newMarkdownBody() {
  const el = document.createElement('div');
  el.className = 'markdown-body';
  return el;
}

function renderMarkdownOnce(container, text) {
  const parser = smd.parser(smd.default_renderer(container));
  smd.parser_write(parser, text);
  smd.parser_end(parser);
}

function renderHumanEntry(entry) {
  const div = document.createElement('div');
  div.className = 'message message-human';
  div.textContent = entry.text;
  return div;
}

function attachCopyButton(wrapper, getText) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.setAttribute('aria-label', 'Copiar mensagem');
  btn.title = 'Copiar';
  btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.innerHTML = CHECK_ICON;
      setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1200);
    } catch {
      // clipboard indisponível (ex: contexto não seguro); ignora silenciosamente
    }
  });
  wrapper.appendChild(btn);
}

function renderAgentEntry(entry) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message message-agent';
  const body = newMarkdownBody();
  renderMarkdownOnce(body, entry.text);
  wrapper.appendChild(body);
  attachCopyButton(wrapper, () => entry.text);
  return wrapper;
}

function activityState(kind) {
  return kind === 'tool_call' ? 'running' : 'done';
}

function fillActivityNode(node, entry) {
  node.dataset.kind = entry.kind;
  // Estado (rodando/feito) já é o ponto colorido; texto de vide-code costuma
  // já vir com o nome da ferramenta, então prefixo tipo "Executando: " só duplicava.
  node.className = `activity-item activity-${activityState(entry.kind)}`;
  node.textContent = entry.text;
}

function targetContainerFor(entry) {
  if (!entry.subagent) return messagesEl;
  let body = subagentGroups.get(entry.subagent.id);
  if (!body) {
    const group = document.createElement('div');
    group.className = 'subagent-group';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'subagent-group-label';
    toggle.setAttribute('aria-expanded', 'true');
    const name = document.createElement('span');
    name.className = 'subagent-group-name';
    name.textContent = entry.subagent.name || 'Subagente';
    const count = document.createElement('span');
    count.className = 'subagent-group-count';
    toggle.append(chevronIcon(), name, count);
    body = document.createElement('div');
    body.className = 'subagent-group-body';
    toggle.addEventListener('click', () => {
      const collapsed = group.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    // Mantém a contagem de atividades visível mesmo com o card colapsado.
    new MutationObserver(() => {
      count.textContent = String(body.childElementCount);
    }).observe(body, { childList: true });
    group.append(toggle, body);
    insertAtEnd(group);
    subagentGroups.set(entry.subagent.id, body);
  }
  return body;
}

function chevronIcon() {
  const span = document.createElement('span');
  span.className = 'subagent-group-chevron';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return span;
}

function renderTaskList(entry) {
  if (!taskListEl) {
    taskListEl = document.createElement('div');
    taskListEl.className = 'task-list-card';
    messagesEl.insertBefore(taskListEl, messagesEl.firstChild);
  }
  taskListEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'task-list-title';
  title.textContent = 'Lista de tarefas';
  taskListEl.appendChild(title);
  const lines = entry.text.split('\n').filter(Boolean);
  for (const line of lines) {
    const [status, ...rest] = line.split(':');
    const item = document.createElement('div');
    item.className = `task-item task-${(status || '').trim()}`;
    item.textContent = rest.join(':').trim() || line;
    taskListEl.appendChild(item);
  }
}

function upsertActivity(entry) {
  if (entry.id === 'task-list') {
    renderTaskList(entry);
    return;
  }
  const existing = activityNodes.get(entry.id);
  if (existing) {
    fillActivityNode(existing, entry);
    // A live tool-call can arrive untagged and only get its subagent id once
    // the subagent's card exists in vide-code's DOM; move it into the right
    // group instead of leaving it stuck wherever it first landed.
    const container = targetContainerFor(entry);
    if (existing.parentElement !== container) {
      if (container === messagesEl) insertAtEnd(existing);
      else container.appendChild(existing);
    }
    return;
  }
  const node = document.createElement('div');
  fillActivityNode(node, entry);
  const container = targetContainerFor(entry);
  // Top-level items must land before the in-progress streaming message, same as
  // history entries: appendChild alone would drop them after it (or, once the
  // node already exists elsewhere, silently move it there).
  if (container === messagesEl) insertAtEnd(node);
  else container.appendChild(node);
  activityNodes.set(entry.id, node);
}

function ensureStreamingNode() {
  if (streaming) return streaming;
  const wrapper = document.createElement('div');
  wrapper.className = 'message message-agent';
  const body = newMarkdownBody();
  wrapper.appendChild(body);
  messagesEl.appendChild(wrapper);
  const parser = smd.parser(smd.default_renderer(body));
  streaming = { node: wrapper, parser, content: '' };
  return streaming;
}

function updateStreamingMessage(content) {
  // Snapshots may replace a placeholder or revise earlier text, not just append.
  if (streaming && !content.startsWith(streaming.content)) clearStreamingMessage();
  const state = ensureStreamingNode();
  if (content.length > state.content.length) {
    smd.parser_write(state.parser, content.slice(state.content.length));
    state.content = content;
  }
}

function clearStreamingMessage() {
  if (!streaming) return;
  smd.parser_end(streaming.parser);
  streaming.node.remove();
  streaming = null;
}

function renderConversation(conversation) {
  const wasNearBottom = firstRender || isNearBottom();

  const newItems = [];
  for (const entry of conversation.history) {
    if (historyIds.has(entry.id)) continue;
    historyIds.add(entry.id);
    newItems.push({ createdAt: entry.createdAt, build: () => (entry.role === 'human' ? renderHumanEntry(entry) : renderAgentEntry(entry)) });
  }
  newItems.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const item of newItems) insertAtEnd(item.build());

  for (const entry of conversation.activity) upsertActivity(entry);

  if (conversation.message && conversation.message.content) {
    updateStreamingMessage(conversation.message.content);
  } else {
    clearStreamingMessage();
  }

  renderPendingQuestion(conversation);
  renderCompose(conversation);

  if (wasNearBottom) scrollToBottom();
  firstRender = false;
}

function renderCompose(conversation) {
  const disconnected = conversation.status === 'disconnected';
  const busy = BUSY_STATUSES.has(conversation.status);
  messageInput.disabled = disconnected;
  sendBtn.disabled = disconnected;
  // sendIcon/stopIcon are <svg> (SVG namespace): the HTML .hidden property
  // doesn't reflect to the attribute there, so toggleAttribute is required.
  sendIcon.toggleAttribute('hidden', busy);
  stopIcon.toggleAttribute('hidden', !busy);
  sendBtn.setAttribute('aria-label', busy ? 'Parar resposta' : 'Enviar mensagem');
}

function renderPendingQuestion(conversation) {
  const pending = conversation.status === 'disconnected' ? null : conversation.pendingQuestion;
  const key = pending ? JSON.stringify(pending) : null;
  if (key === pendingQuestionKey) return;
  pendingQuestionKey = key;
  pendingEl.replaceChildren();
  if (!pending) return;

  const card = document.createElement('div');
  card.className = 'ask-user-card';
  const heading = document.createElement('h2');
  heading.className = 'ask-user-heading';
  heading.textContent = 'Sua resposta é necessária';
  card.appendChild(heading);
  const body = document.createElement('div');
  body.className = 'ask-user-body';
  card.appendChild(body);

  for (const question of pending.questions) {
    const block = document.createElement('fieldset');
    block.className = 'ask-user-question';
    block.dataset.questionId = question.id;

    const title = document.createElement('legend');
    title.textContent = question.question;
    block.appendChild(title);

    const inputType = question.type === 'checkbox' ? 'checkbox' : 'radio';
    const defaults = Array.isArray(question.default) ? question.default.map(String) : [String(question.default)];
    const groupName = `q-${question.id}`;

    const list = document.createElement('div');
    list.className = 'options-list';
    for (const option of question.options) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = groupName;
      input.value = option.value;
      input.checked = defaults.includes(String(option.value));
      label.appendChild(input);
      label.appendChild(document.createTextNode(option.label));
      list.appendChild(label);
    }
    if (question.allowOther !== false) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = inputType;
      input.name = groupName;
      input.value = OTHER_VALUE;
      const otherText = document.createElement('input');
      otherText.type = 'text';
      otherText.placeholder = 'Outro...';
      otherText.setAttribute('aria-label', `Outra resposta: ${question.question}`);
      otherText.disabled = true;
      list.addEventListener('change', () => {
        otherText.disabled = !input.checked;
      });
      label.appendChild(input);
      label.appendChild(otherText);
      list.appendChild(label);
    }
    block.appendChild(list);
    body.appendChild(block);
  }

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Responder';
  submitBtn.onclick = () => submitAnswer(pending.questions, card, false);

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Seguir sem mim';
  skipBtn.className = 'secondary';
  skipBtn.onclick = () => submitAnswer(pending.questions, card, true);

  const error = document.createElement('p');
  error.className = 'error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  body.prepend(error);
  const actions = document.createElement('div');
  actions.className = 'ask-user-actions';
  actions.append(submitBtn, skipBtn);
  card.appendChild(actions);
  pendingEl.appendChild(card);
}

async function submitAnswer(questions, card, skipped) {
  let answers;
  if (!skipped) {
    answers = {};
    for (const question of questions) {
      const block = [...card.querySelectorAll('.ask-user-question')].find(el => el.dataset.questionId === question.id);
      const checkedValues = [...block.querySelectorAll('input:checked')].map((el) => el.value);
      const values = checkedValues.map((value) => {
        if (value !== OTHER_VALUE) return value;
        const otherInput = block.querySelector('input[type="text"]');
        return otherInput ? otherInput.value : '';
      });
      answers[question.id] = question.type === 'checkbox' ? values : values[0] ?? '';
    }
  }
  const buttons = [...card.querySelectorAll('button')];
  const error = card.querySelector('.error');
  error.hidden = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(`/api/conversations/${conversationId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipped, answers }),
    });
    if (!response.ok) throw new Error('answer_failed');
  } catch {
    error.textContent = 'Não foi possível enviar. Sua resposta foi mantida; tente novamente.';
    error.hidden = false;
    card.querySelector('.ask-user-body').scrollTop = 0;
  } finally {
    // HTTP 202 confirms forwarding, not that the agent consumed the answer.
    // Keep the pending question usable until a later snapshot removes it.
    buttons.forEach(button => { button.disabled = false; });
  }
}

let currentStatus = 'idle';

sendBtn.addEventListener('click', async () => {
  if (BUSY_STATUSES.has(currentStatus)) {
    await fetch(`/api/conversations/${conversationId}/stop`, { method: 'POST' });
    return;
  }
  const message = messageInput.value.trim();
  if (!message) return;
  messageInput.value = '';
  await fetch(`/api/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendBtn.click();
  }
});

fetch(`/api/conversations/${conversationId}`)
  .then((r) => r.json())
  .then((conversation) => {
    currentStatus = conversation.status;
    renderConversation(conversation);
  });

const events = new EventSource(`/conversations/${conversationId}/events`);
events.addEventListener('update', (event) => {
  const conversation = JSON.parse(event.data);
  currentStatus = conversation.status;
  renderConversation(conversation);
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
