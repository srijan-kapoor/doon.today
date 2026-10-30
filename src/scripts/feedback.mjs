import { feedbackBody, feedbackProblem } from '../lib/feedback.mjs';

/**
 * Opens the feedback dialog from any [data-feedback] link and sends the form in the background. A link with
 * data-about (an event's "Report a problem") fills in what it is about and hides the 👍/👎 question.
 * Without JavaScript the links go to /feedback/, which posts the same form.
 */
export const TOAST_MS = 6000;

export function initFeedback(document, window) {
  const dialog = document.querySelector('#feedback-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('[data-feedback-form]');
  const status = form.querySelector('[data-feedback-status]');
  const about = form.querySelector('[data-feedback-about]');
  const send = form.querySelector('button[type="submit"]');
  let opener = null;
  // A link in the phone menu is hidden once the menu closes; its summary takes focus instead.
  const focusOpener = () => { const target = opener?.closest('details:not([open])')?.querySelector('summary') ?? opener; target?.focus({ preventScroll: true }); };
  const say = (text, error = false) => { status.textContent = text; status.dataset.state = error ? 'error' : ''; };
  const toast = document.querySelector('#feedback-toast');
  let toastTimer;
  let toastHeld = false;
  const dismiss = toast.querySelector('[data-toast-dismiss]');
  const hideToast = () => { window.clearTimeout(toastTimer); toastHeld = false; toast.dataset.hidden = ''; dismiss.hidden = true; toast.querySelector('[data-toast-text]').textContent = ''; };
  const startToastTimer = () => { window.clearTimeout(toastTimer); if (!toastHeld) toastTimer = window.setTimeout(hideToast, TOAST_MS); };
  // The thanks shows outside the dialog, which closes. It stays while pointed at or focused.
  function showToast(text) {
    const label = toast.querySelector('[data-toast-text]');
    // Cleared first, so a second thanks in a row is announced again.
    label.textContent = '';
    delete toast.dataset.hidden;
    dismiss.hidden = false;
    window.setTimeout(() => { label.textContent = text; }, 0);
    startToastTimer();
  }
  for (const [on, held] of [['pointerenter', true], ['pointerleave', false], ['focusin', true], ['focusout', false]]) {
    toast.addEventListener(on, () => { if ('hidden' in toast.dataset) return; toastHeld = held; if (held) window.clearTimeout(toastTimer); else startToastTimer(); });
  }
  dismiss.addEventListener('click', () => { hideToast(); focusOpener(); });

  function open(link) {
    opener = link;
    form.reset();
    say('');
    send.disabled = false;
    form.elements.page.value = window.location.origin + window.location.pathname;
    form.elements.about.value = link.dataset.about || '';
    about.hidden = !link.dataset.about;
    about.textContent = link.dataset.aboutLabel ? `About: ${link.dataset.aboutLabel}` : '';
    form.querySelector('[data-feedback-vote]').hidden = Boolean(link.dataset.about);
    form.querySelector('[data-feedback-prompt]').textContent = link.dataset.about ? 'What is wrong with this event?' : "What's wrong, or what could be better?";
    dialog.showModal();
    form.elements.message.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-feedback]');
    if (!link) return;
    event.preventDefault();
    link.closest('details')?.removeAttribute('open');
    open(link);
  });
  dialog.addEventListener('close', focusOpener);
  dialog.querySelector('[data-feedback-close]').addEventListener('click', close);
  // A click on the backdrop lands on the dialog itself, outside the panel.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new window.FormData(form));
    const problem = feedbackProblem(fields);
    if (problem === 'spam') { close(); return; }
    if (problem) { say(problem, true); return; }
    send.disabled = true;
    say('Sending…');
    try {
      const res = await window.fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: feedbackBody(fields) });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      say('');
      close();
      showToast('Thanks, we read every message.');
    } catch {
      say("Couldn't send that. Check your connection and try again.", true);
    } finally {
      send.disabled = false;
    }
  });
}

if (typeof document !== 'undefined') initFeedback(document, window);
