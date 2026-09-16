const conversationId = window.location.pathname.split('/').pop();
const messagesEl = document.getElementById('messages');
const pendingEl = document.getElementById('pending-question');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

const OTHER_VALUE = '__other__';

function renderEntry(prefix, text, className) {
  const div = document.createElement('div');
  div.className = `message ${className}`;
  const prefixEl = document.createElement('span');
  prefixEl.className = 'message-prefix';
  prefixEl.textContent = prefix;
  div.appendChild(prefixEl);
  div.appendChild(document.createTextNode(text));
  return div;
}

function renderConversation(conversation) {
  messagesEl.innerHTML = '';

  const feed = [
    ...conversation.history.map((h) => ({
      createdAt: h.createdAt,
      node: renderEntry(h.role === 'human' ? '[você] ' : '[agente] ', h.text, h.role === 'human' ? 'message-human' : 'message-agent'),
    })),
    ...conversation.activity.map((a) => ({
      createdAt: a.createdAt,
      node: renderEntry('', a.text, 'message-system'),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const item of feed) messagesEl.appendChild(item.node);

  if (conversation.message && conversation.message.content) {
    messagesEl.appendChild(renderEntry('[agente] ', conversation.message.content, 'message-agent'));
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;

  renderPendingQuestion(conversation);
  renderCompose(conversation);
}

function renderCompose(conversation) {
  const disconnected = conversation.status === 'disconnected';
  messageInput.disabled = disconnected;
  sendBtn.disabled = disconnected;
  stopBtn.disabled = disconnected || !['queued', 'streaming'].includes(conversation.status);
}

function renderPendingQuestion(conversation) {
  pendingEl.innerHTML = '';
  const pending = conversation.pendingQuestion;
  if (!pending || conversation.status === 'disconnected') return;

  const card = document.createElement('div');
  card.className = 'ask-user-card';

  for (const question of pending.questions) {
    const block = document.createElement('div');
    block.className = 'ask-user-question';
    block.dataset.questionId = question.id;

    const title = document.createElement('div');
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
      otherText.disabled = true;
      input.addEventListener('change', () => {
        otherText.disabled = !input.checked;
      });
      label.appendChild(input);
      label.appendChild(otherText);
      list.appendChild(label);
    }
    block.appendChild(list);
    card.appendChild(block);
  }

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Responder';
  submitBtn.onclick = () => submitAnswer(pending.questions, card, false);

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Seguir sem mim';
  skipBtn.className = 'secondary';
  skipBtn.onclick = () => submitAnswer(pending.questions, card, true);

  card.appendChild(submitBtn);
  card.appendChild(skipBtn);
  pendingEl.appendChild(card);
}

async function submitAnswer(questions, card, skipped) {
  let answers;
  if (!skipped) {
    answers = {};
    for (const question of questions) {
      const block = card.querySelector(`[data-question-id="${question.id}"]`);
      const checkedValues = [...block.querySelectorAll('input:checked')].map((el) => el.value);
      const values = checkedValues.map((value) => {
        if (value !== OTHER_VALUE) return value;
        const otherInput = block.querySelector('input[type="text"]');
        return otherInput ? otherInput.value : '';
      });
      answers[question.id] = question.type === 'checkbox' ? values : values[0] ?? '';
    }
  }
  await fetch(`/api/conversations/${conversationId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipped, answers }),
  });
}

sendBtn.addEventListener('click', async () => {
  const message = messageInput.value.trim();
  if (!message) return;
  messageInput.value = '';
  await fetch(`/api/conversations/${conversationId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
});

stopBtn.addEventListener('click', async () => {
  await fetch(`/api/conversations/${conversationId}/stop`, { method: 'POST' });
});

fetch(`/api/conversations/${conversationId}`)
  .then((r) => r.json())
  .then(renderConversation);

const events = new EventSource(`/conversations/${conversationId}/events`);
events.addEventListener('update', (event) => {
  renderConversation(JSON.parse(event.data));
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});
