import { $, api, busy, showError } from '/static/ui.js';

// O convite vem no fragmento (#) e sai da barra de endereço, para não vazar num copiar/colar
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (!token) showError($('invite-error'), 'Link de convite incompleto. Peça o link de novo.');

$('invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('invite-error').hidden = true;
  if ($('password').value !== $('password2').value) return showError($('invite-error'), 'As senhas não são iguais.');
  busy(e.target, async () => {
    try {
      await api('/api/invites/accept', { token, username: $('username').value, password: $('password').value });
      location.replace('/');
    } catch (err) {
      showError($('invite-error'), err);
    }
  });
});
