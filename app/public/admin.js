import { t, translatePage } from '/static/i18n.js';
import { $, api, busy, showError } from '/static/ui.js';

translatePage();

const state = await api('/api/state');
if (state.user?.role !== 'admin') location.replace('/');

const el = (tag, attrs = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), attrs);
  e.append(...children);
  return e;
};

const action = (label, fn, className = 'secondary') => {
  const b = el('button', { type: 'button', className, textContent: t(label) });
  b.addEventListener('click', async () => {
    b.disabled = true;
    $('users-error').hidden = true;
    try {
      await fn();
    } catch (err) {
      showError($('users-error'), err);
    } finally {
      b.disabled = false;
    }
  });
  return b;
};

const formatDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

// --- configurações ---------------------------------------------------------

const settings = await api('/api/admin/settings');
$('require2fa').checked = settings.require2fa;
$('max').value = settings.maxParticipants;

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('settings-error').hidden = true;
  $('settings-ok').hidden = true;
  busy(e.target, async () => {
    try {
      await api('/api/admin/settings', { require2fa: $('require2fa').checked, maxParticipants: Number($('max').value) });
      // A regra vale para o próprio admin: sem 2FA, ele precisa configurar antes de continuar
      if ($('require2fa').checked && !state.user.totp) return location.replace('/conta');
      $('settings-ok').hidden = false;
    } catch (err) {
      showError($('settings-error'), err);
    }
  });
});

// --- login da empresa (SSO) -------------------------------------------------

const fillSso = (sso) => {
  $('sso-redirect').textContent = sso.redirectUri;
  $('sso-enabled').checked = sso.enabled;
  $('sso-issuer').value = sso.issuer;
  $('sso-client-id').value = sso.clientId;
  $('sso-client-secret').value = '';
  $('sso-client-secret').placeholder = sso.hasClientSecret ? t('Salvo (deixe vazio para manter)') : '';
  $('sso-domains').value = sso.domains.join(', ');
  $('sso-group').value = sso.broadcasterGroup;
  $('sso-emails').value = sso.broadcasterEmails.join(', ');
  $('sso-rooms-default').checked = sso.roomsDefault;
  $('sso-force').checked = sso.forceRooms;
};
fillSso(await api('/api/admin/sso'));

$('sso-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('sso-error').hidden = true;
  $('sso-ok').hidden = true;
  busy(e.target, async () => {
    try {
      fillSso(
        await api('/api/admin/sso', {
          enabled: $('sso-enabled').checked,
          issuer: $('sso-issuer').value,
          clientId: $('sso-client-id').value,
          clientSecret: $('sso-client-secret').value,
          domains: $('sso-domains').value,
          broadcasterGroup: $('sso-group').value,
          broadcasterEmails: $('sso-emails').value,
          roomsDefault: $('sso-rooms-default').checked,
          forceRooms: $('sso-force').checked,
        }),
      );
      $('sso-ok').hidden = false;
    } catch (err) {
      showError($('sso-error'), err);
    }
  });
});

// --- transmissores ---------------------------------------------------------

const showCodes = (username, codes) => {
  $('codes-for').textContent = username;
  $('codes').replaceChildren(...codes.map((c) => el('li', { textContent: c })));
  $('user-codes').hidden = false;
};

const loadUsers = async () => {
  const { users } = await api('/api/admin/users');
  $('users').replaceChildren(
    ...users.map((u) => {
      const status = [
        t(u.role === 'admin' ? 'administrador' : 'transmissor'),
        u.sso ? t('login da empresa ({email})', { email: u.email }) : null,
        t(u.totp ? '2FA ativo' : 'sem 2FA'),
        u.disabled ? t('revogado') : null,
        u.liveRooms ? t('{n} sala(s) ao vivo', { n: u.liveRooms }) : null,
      ].filter(Boolean);
      const actions = el('div', { className: 'actions' });
      if (u.totp) {
        actions.append(
          action('Novos códigos', async () => showCodes(u.username, (await api('/api/admin/recovery-codes', { username: u.username })).recoveryCodes)),
          action('Remover 2FA', async () => {
            if (!confirm(t('Remover o 2FA de {name}? A conta poderá configurá-lo de novo.', { name: u.username }))) return;
            await api('/api/admin/reset-2fa', { username: u.username });
            await loadUsers();
          }),
        );
      }
      if (u.role !== 'admin') {
        actions.append(
          u.disabled
            ? action('Reativar', async () => {
                await api('/api/admin/users/restore', { username: u.username });
                await loadUsers();
              })
            : action(
                'Revogar',
                async () => {
                  if (!confirm(t('Revogar {name}? As sessões e as salas ao vivo dessa pessoa serão encerradas agora.', { name: u.username })))
                    return;
                  await api('/api/admin/users/revoke', { username: u.username });
                  await loadUsers();
                },
                'danger',
              ),
          action(
            'Excluir',
            async () => {
              if (!confirm(t('Excluir a conta {name}? Isso não pode ser desfeito.', { name: u.username }))) return;
              await api('/api/admin/users/delete', { username: u.username });
              await loadUsers();
            },
            'danger',
          ),
        );
      }
      const li = el('li', { className: u.disabled ? 'disabled' : '' }, el('div', {}, el('b', { textContent: u.username }), el('span', { className: 'muted small', textContent: ` · ${status.join(' · ')}` })), actions);
      li.dataset.username = u.username;
      return li;
    }),
  );
};

// --- convites ----------------------------------------------------------------

const loadInvites = async () => {
  const { invites } = await api('/api/admin/invites');
  $('invites').replaceChildren(
    ...invites.map((i) =>
      el(
        'li',
        {},
        el('span', { className: 'muted small', textContent: t('Convite pendente, vale até {date}', { date: formatDate(i.expiresAt) }) }),
        action('Cancelar', async () => {
          await api('/api/admin/invites/cancel', { id: i.id });
          await loadInvites();
        }),
      ),
    ),
  );
};

$('new-invite').addEventListener('click', async () => {
  const { path } = await api('/api/admin/invites', {});
  $('invite-link').value = `${location.origin}${path}`;
  $('invite-box').hidden = false;
  $('copy-invite').textContent = t('Copiar');
  await loadInvites();
});

$('copy-invite').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('invite-link').value).catch(() => $('invite-link').select());
  $('copy-invite').textContent = t('Copiado!');
});

await Promise.all([loadUsers(), loadInvites()]);
