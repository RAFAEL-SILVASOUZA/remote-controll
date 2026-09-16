import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFixture } from './mobile-fixture.mjs';

// Uses real HTML/CSS/JS in Chrome; only the remote agent/API is replaced.
// Start Chrome with --remote-debugging-port=9333 and an isolated profile first.
const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9333';
const fixture = await startFixture();
let ws, tab;
const checks = [];
try {
  tab = await (await fetch(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let sequence = 0;
  const pending = new Map();
  ws.on('message', raw => { const msg = JSON.parse(raw); if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + r.result.description);
    return r.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`Timed out: ${expression}`);
  };
  const goto = async route => {
    await send('Page.navigate', { url: fixture.url + route });
    await waitFor(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete'`);
  };
  const viewport = (width, height = 844) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  const check = async (name, run) => { try { await run(); checks.push({ name, ok: true }); console.log(`PASS ${name}`); } catch (error) { checks.push({ name, ok: false }); console.error(`FAIL ${name}: ${error.message}`); } };
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await viewport(320, 568);
  await goto('/conversations/mobile-test');
  await waitFor(`!!document.querySelector('.ask-user-card')`);

  await check('askUser actions and composer remain reachable on a short phone', async () => {
    const bounds = await evaluate(`([...document.querySelectorAll('.ask-user-card button, #compose')].map(e => { const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; }))`);
    assert.ok(bounds.length >= 3);
    assert.ok(bounds.every(r => r.top >= 0 && r.bottom <= 568), JSON.stringify(bounds));
    assert.ok(await evaluate(`[...document.querySelectorAll('.ask-user-card button')].every(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})`), 'answer actions clipped or covered by another element');
    assert.ok(await evaluate(`document.getElementById('messages').clientHeight >= 80`), 'history lost all usable height');
  });
  await check('live updates preserve askUser draft, selection and focus', async () => {
    await evaluate(`(() => { const q=document.querySelectorAll('.ask-user-question')[1]; const other=[...q.querySelectorAll('input')].find(e=>e.value==='__other__'); other.click(); const text=q.querySelector('input[type=text]'); text.value='Meu rascunho'; text.focus(); })()`);
    fixture.state.activity.push({ id: 'live-update', kind: 'info', text: 'Atualização recebida', createdAt: '2026-09-16T12:01:00.000Z' }); fixture.emit();
    await waitFor(`document.getElementById('messages').textContent.includes('Atualização recebida')`);
    assert.deepEqual(await evaluate(`(() => { const q=document.querySelectorAll('.ask-user-question')[1]; const t=q.querySelector('input[type=text]'); return {text:t.value,focused:document.activeElement===t,checked:[...q.querySelectorAll('input')].find(e=>e.value==='__other__').checked}; })()`), { text: 'Meu rascunho', focused: true, checked: true });
  });
  await check('shrinking the visible viewport keeps question actions tappable', async () => {
    await viewport(390, 360);
    await waitFor(`Math.round(document.body.getBoundingClientRect().height)===360`);
    assert.ok(await evaluate(`[...document.querySelectorAll('.ask-user-card button,#send-btn')].every(e=>{const r=e.getBoundingClientRect();const card=e.closest('.ask-user-card');return r.top>=0 && r.bottom<=360 && (!card || r.bottom<=card.getBoundingClientRect().bottom) && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})`), 'actions clipped in a keyboard-sized viewport');
  });
  await viewport(320, 568);
  await check('choosing a regular radio option disables Other again', async () => {
    assert.equal(await evaluate(`(() => { const q=document.querySelector('.ask-user-question'); const radios=q.querySelectorAll('input[type=radio]'); radios[radios.length-1].click(); radios[0].click(); return q.querySelector('input[type=text]').disabled; })()`), true);
  });
  await check('failed answer keeps the draft and offers a retry', async () => {
    fixture.rejectAnswers(true);
    await evaluate(`document.querySelector('.ask-user-card button').click()`);
    await waitFor(`!!document.querySelector('.ask-user-card .error:not([hidden])')`);
    assert.equal(await evaluate(`document.querySelector('.ask-user-card button').disabled`), false);
    fixture.rejectAnswers(false);
  });
  fixture.rejectAnswers(false);
  await check('accepted command without agent confirmation does not lock the question', async () => {
    fixture.keepQuestion(true);
    await evaluate(`document.querySelector('.ask-user-card button').click()`);
    await waitFor(`document.querySelector('.ask-user-card button')?.disabled === false`);
    assert.ok(await evaluate(`!!document.querySelector('.ask-user-card')`));
  });
  fixture.keepQuestion(false);
  await check('answer sends selected options and free text', async () => {
    await evaluate(`(() => { const q=document.querySelectorAll('.ask-user-question')[1]; const other=[...q.querySelectorAll('input')].find(e=>e.value==='__other__'); if(!other.checked)other.click(); q.querySelector('input[type=text]').value='Meu rascunho'; document.querySelector('.ask-user-card button').click(); })()`);
    await waitFor(`!document.querySelector('.ask-user-card')`);
    assert.deepEqual(fixture.commands.findLast(c => c.command === 'answer')?.body, { skipped: false, answers: { priority: 'touch', elements: ['table', 'Meu rascunho'] } });
  });
  await check('replacement streaming content does not mix with the previous prefix', async () => {
    fixture.state.message = { role: 'assistant', content: 'Processing...\n\n' }; fixture.emit();
    await waitFor(`document.getElementById('messages').textContent.includes('Processing...')`);
    fixture.state.message.content = 'Resposta nova e completa recebida do agente.\n\n'; fixture.emit();
    await waitFor(`document.getElementById('messages').textContent.includes('agente.')`);
    const text = await evaluate(`document.getElementById('messages').textContent`);
    assert.ok(text.includes('Resposta nova e completa recebida do agente.'));
    assert.ok(!text.includes('Processing...'));
  });
  await check('tables scroll locally instead of crushing columns', async () => {
    assert.ok(await evaluate(`(() => { const table=document.querySelector('table'); for(let e=table;e && e.id!=='messages';e=e.parentElement){if(getComputedStyle(e).overflowX==='auto' && e.scrollWidth>e.clientWidth)return true;}return false; })()`));
  });
  await check('touch actions stay visible and large enough', async () => {
    assert.ok(await evaluate(`[...document.querySelectorAll('.icon-btn,#send-btn,.copy-btn')].every(e=>{const r=e.getBoundingClientRect();return r.width>=44 && r.height>=44 && getComputedStyle(e).opacity!=='0';})`));
  });
  await check('all screens fit phone, tablet and desktop widths', async () => {
    for (const width of [320, 390, 768, 1280]) {
      await viewport(width);
      for (const route of ['/', '/tokens', '/login', '/signup', '/conversations/mobile-test']) {
        await goto(route);
        if (route === '/') await waitFor(`document.querySelectorAll('#sessions li').length===2`);
        if (route === '/tokens') await waitFor(`document.querySelectorAll('#token-list li').length===1`);
        assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `${route} overflows ${width}px`);
        assert.ok(await evaluate(`[...document.querySelectorAll('input:not([type=radio]):not([type=checkbox]),select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)`), `${route}: small input font`);
      }
    }
  });
  await check('window picker stays hidden until a window choice is needed', async () => {
    await goto('/');
    assert.equal(await evaluate(`document.getElementById('new-chat-picker').getBoundingClientRect().height`), 0);
  });
} finally {
  ws?.close();
  if (tab) await fetch(`${endpoint}/json/close/${tab.id}`).catch(() => {});
  fixture.close();
}
console.log(`${checks.filter(c=>c.ok).length}/${checks.length} browser checks passed`);
if (checks.some(c=>!c.ok)) process.exitCode = 1;
