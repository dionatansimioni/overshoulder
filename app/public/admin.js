import { t, translatePage } from '/static/i18n.js';
import { MANY_PEOPLE, QUALITIES, QUALITY_LABELS, bandwidth } from '/static/quality.js';
import { getFixedKey as getKey, randomKey, setFixedKey as setKey } from '/static/rooms-local.js';
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
for (const id of ['default-quality', 'max-quality']) {
  for (const q of QUALITIES) $(id).append(new Option(QUALITY_LABELS[q], q));
}
$('default-quality').value = settings.defaultQuality;
$('max-quality').value = settings.maxQuality;

// Estimativa de banda com a sala cheia na qualidade padrão; destacada a partir de algumas centenas
const updateMaxHint = () => {
  const people = Number($('max').value);
  const hint = $('max-hint');
  if (!Number.isInteger(people) || people < 2) return (hint.textContent = '');
  const many = people >= MANY_PEOPLE;
  hint.classList.toggle('warn', many);
  hint.classList.toggle('muted', !many);
  hint.textContent = t('Sala cheia em {quality}: o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).', {
    quality: QUALITY_LABELS[$('default-quality').value],
    ...bandwidth($('default-quality').value, people - 1),
  });
};
updateMaxHint();
$('max').addEventListener('input', updateMaxHint);
$('default-quality').addEventListener('change', updateMaxHint);
$('signup-mode').value = settings.signup;

$('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('settings-error').hidden = true;
  $('settings-ok').hidden = true;
  busy(e.target, async () => {
    try {
      await api('/api/admin/settings', {
        require2fa: $('require2fa').checked,
        maxParticipants: Number($('max').value),
        signup: $('signup-mode').value,
        defaultQuality: $('default-quality').value,
        maxQuality: $('max-quality').value,
      });
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
        u.pending ? t('aguardando aprovação') : null,
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
      if (u.pending) {
        actions.append(
          action(
            'Aprovar',
            async () => {
              await api('/api/admin/users/approve', { username: u.username });
              await loadUsers();
            },
            '',
          ),
        );
      }
      if (u.role !== 'admin') {
        actions.append(
          u.pending
            ? ''
            : u.disabled
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
      const li = el('li', { className: u.disabled ? 'disabled' : u.pending ? 'pending' : '' }, el('div', {}, el('b', { textContent: u.username }), el('span', { className: 'muted small', textContent: ` · ${status.join(' · ')}` })), actions);
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

// --- salas fixas ----------------------------------------------------------------

const roomError = (err) => showError($('fixed-error'), err);

const copyButton = (label, text) => {
  const b = el('button', { type: 'button', className: 'secondary', textContent: t(label) });
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text());
      b.textContent = t('Copiado!');
    } catch {
      prompt(t(label), text());
    }
  });
  return b;
};

const loadFixedRooms = async () => {
  const { rooms } = await api('/api/admin/rooms');
  $('fixed-rooms').replaceChildren(
    ...rooms.map((r) => {
      const key = getKey(r.id);
      const viewerLink = () => `${location.origin}/r/${r.roomId}#k=${getKey(r.id)}`;
      const status = [
        t(r.type === 'together' ? 'Jogando juntos' : 'Live'),
        r.online ? t('{n} pessoa(s) agora', { n: r.online }) : t('vazia'),
        key ? null : t('chave em outro navegador'),
      ].filter(Boolean);
      const actions = el('div', { className: 'actions' });
      if (key) {
        const enter = el('a', { className: 'button', textContent: t('Entrar como anfitrião') });
        enter.href = `/r/${r.roomId}#${new URLSearchParams({ k: key, h: r.hostKey })}`;
        enter.dataset.action = 'enter';
        const copy = copyButton('Copiar convite', viewerLink);
        copy.dataset.action = 'copy';
        actions.append(enter, copy);
      }
      actions.append(
        action(key ? 'Nova chave' : 'Criar chave', async () => {
          if (key && !confirm(t('Criar uma chave nova? Os links atuais param de funcionar: quem entrar com eles não verá nem ouvirá nada.'))) return;
          setKey(r.id, randomKey());
          await loadFixedRooms();
        }),
        action(
          'Excluir',
          async () => {
            if (!confirm(t('Excluir a sala fixa {name}? Quem estiver nela sai agora.', { name: r.title }))) return;
            await api('/api/admin/rooms/delete', { id: r.id });
            await loadFixedRooms();
          },
          'danger',
        ),
      );
      const li = el('li', {}, el('div', {}, el('b', { textContent: r.title }), el('span', { className: 'muted small', textContent: ` · ${status.join(' · ')}` })), actions);
      li.dataset.room = r.id;
      return li;
    }),
  );
};

$('fixed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('fixed-error').hidden = true;
  busy(e.target, async () => {
    try {
      const room = await api('/api/admin/rooms', { title: $('fixed-title').value, type: $('fixed-type').value });
      setKey(room.id, randomKey());
      e.target.reset();
      await loadFixedRooms();
    } catch (err) {
      roomError(err);
    }
  });
});

await Promise.all([loadUsers(), loadInvites(), loadFixedRooms()]);
