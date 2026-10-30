import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { eventAbout, feedbackBody, feedbackProblem } from '../src/lib/feedback.mjs';
import { initFeedback, TOAST_MS } from '../src/scripts/feedback.mjs';
import { dispatchLead } from '../ingest/lib/dispatch-lead.mjs';

test('a message needs a vote or some text, and a filled honeypot is spam', () => {
  assert.equal(feedbackProblem({ vote: 'like' }), '');
  assert.equal(feedbackProblem({ message: 'The time is wrong' }), '');
  assert.match(feedbackProblem({ message: '   ' }), /Pick/);
  assert.equal(feedbackProblem({ vote: 'meh' }), 'unknown vote');
  assert.equal(feedbackProblem({ message: 'hi', 'bot-field': 'x' }), 'spam');
});

test('the body names the feedback form and carries the page and event', () => {
  const body = new URLSearchParams(feedbackBody({ 'form-name': 'other', page: 'https://doon.today/events/x/', about: eventAbout({ id: 'abc', title: 'Jazz & Co' }), message: 'Wrong venue' }));
  assert.equal(body.get('form-name'), 'feedback');
  assert.equal(body.getAll('form-name').length, 1);
  assert.equal(body.get('about'), 'Jazz & Co (abc)');
  assert.equal(body.get('page'), 'https://doon.today/events/x/');
});

test('feedback never opens a lead issue', async () => {
  const fetchImpl = async () => { throw new Error('should not be called'); };
  assert.equal(await dispatchLead({ 'form-name': 'feedback', message: 'hi' }, { fetchImpl, token: 't' }), 'other form');
  assert.equal(await dispatchLead({ kind: 'feedback', title: 'x', date: '2026-11-01', venue: 'y' }, { fetchImpl, token: 't' }), 'other form', 'even without a form name');
});

function page(t, respond = { ok: true }) {
  const dom = new JSDOM(`<!doctype html><body>
    <a href="/feedback/" data-feedback id="general">Feedback</a>
    <a href="/feedback/" data-feedback id="report" data-about="Jazz (abc)" data-about-label="Jazz">Report a problem</a>
    <dialog id="feedback-dialog"><form data-feedback-form>
      <input type="hidden" name="form-name" value="feedback"><input type="hidden" name="page"><input type="hidden" name="about">
      <input name="bot-field"><p data-feedback-about hidden></p>
      <fieldset data-feedback-vote><input type="radio" name="vote" value="like"><input type="radio" name="vote" value="dislike"></fieldset>
      <span data-feedback-prompt></span><textarea name="message"></textarea><input name="email">
      <p data-feedback-status></p><button type="submit">Send</button><button type="button" data-feedback-close>Cancel</button>
    </form></dialog><div id="feedback-toast" data-hidden><span data-toast-text></span><button data-toast-dismiss hidden>×</button></div></body>`, { url: 'https://doon.today/events/jazz/?utm_source=x' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const dialog = document.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  const sent = [];
  window.fetch = async (url, init) => { sent.push({ url, init }); return respond; };
  initFeedback(document, window);
  const $ = (s) => document.querySelector(s);
  const submit = () => $('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  return { $, dialog, sent, submit, window };
}

test('an event report opens the form about that event, without the vote', async (t) => {
  const { $, dialog, sent, submit } = page(t);
  $('#report').click();
  assert.equal(dialog.open, true);
  assert.equal($('[name="about"]').value, 'Jazz (abc)');
  assert.equal($('[name="page"]').value, 'https://doon.today/events/jazz/', 'no query string');
  assert.equal($('[data-feedback-vote]').hidden, true);
  assert.equal($('[data-feedback-about]').textContent, 'About: Jazz');
  $('[name="message"]').value = 'It starts at 8, not 7';
  submit();
  await new Promise((r) => setTimeout(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/');
  const body = new URLSearchParams(sent[0].init.body);
  assert.equal(body.get('form-name'), 'feedback');
  assert.equal(body.get('about'), 'Jazz (abc)');
  assert.equal(body.get('message'), 'It starts at 8, not 7');
  assert.equal(dialog.open, false, 'the dialog closes on success');
  assert.equal($('#feedback-toast').dataset.hidden, undefined);
  assert.equal($('[data-toast-text]').textContent, 'Thanks, we read every message.');
  assert.equal($('[data-feedback-status]').textContent, '');
});

test('general feedback shows the vote, needs something to send, and reports a failed send', async (t) => {
  const { $, dialog, sent, submit } = page(t, { ok: false });
  $('#general').click();
  assert.equal($('[data-feedback-vote]').hidden, false);
  assert.equal($('[name="about"]').value, '');
  submit();
  assert.equal(sent.length, 0);
  assert.match($('[data-feedback-status]').textContent, /Pick/);
  $('[value="dislike"]').checked = true;
  submit();
  await new Promise((r) => setTimeout(r));
  assert.equal(sent.length, 1);
  assert.match($('[data-feedback-status]').textContent, /Couldn't send/);
  assert.equal($('[data-feedback-status]').dataset.state, 'error');
  assert.equal(dialog.open, true, 'a failed send keeps the message');
  assert.equal($('#feedback-toast').dataset.hidden, '');
  $('[data-feedback-close]').click();
  assert.equal(dialog.open, false);
});

test('the thanks toast hides after a while, but not while pointed at, and can be dismissed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { $, submit, window } = page(t);
  $('#general').click();
  $('[value="like"]').checked = true;
  submit();
  await Promise.resolve(); await Promise.resolve();
  const toast = $('#feedback-toast');
  assert.equal(toast.dataset.hidden, undefined);
  toast.dispatchEvent(new window.Event('pointerenter'));
  t.mock.timers.tick(TOAST_MS);
  assert.equal(toast.dataset.hidden, undefined, 'held while pointed at');
  toast.dispatchEvent(new window.Event('pointerleave'));
  t.mock.timers.tick(TOAST_MS);
  assert.equal(toast.dataset.hidden, '');
  assert.equal($('[data-toast-dismiss]').hidden, true);
});
