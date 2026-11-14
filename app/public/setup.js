import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

const state = await api('/api/state');
if (state.setupDone) location.replace('/');

$('setup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('setup-error').hidden = true;
  if ($('password').value !== $('password2').value) {
    showError($('setup-error'), 'As senhas não são iguais.');
    return;
  }
  busy(e.target, async () => {
    try {
      await api('/api/setup', {
        code: $('code').value,
        username: $('username').value,
        password: $('password').value,
        maxParticipants: Number($('max').value),
      });
      location.replace('/');
    } catch (err) {
      showError($('setup-error'), err);
    }
  });
});
