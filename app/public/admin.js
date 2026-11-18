import { lang, t, translatePage } from '/static/i18n.js';
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

// --- menu lateral: uma página por seção, no fragmento da URL (#salas) ---------------
// Cada troca entra no histórico, então o Voltar do navegador volta à seção anterior

const PAGES = [...document.querySelectorAll('.admin-page')].map((p) => p.id);
const showPage = () => {
  const id = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : PAGES[0];
  for (const page of PAGES) $(page).hidden = page !== id;
  for (const item of document.querySelectorAll('.admin-nav button')) {
    if (item.dataset.page === id) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
};
addEventListener('hashchange', showPage);
for (const item of document.querySelectorAll('.admin-nav button')) {
  item.addEventListener('click', () => (location.hash = item.dataset.page));
}
showPage();

// --- configurações ---------------------------------------------------------

const settings = await api('/api/admin/settings');
$('require2fa').checked = settings.require2fa;
$('max').value = settings.maxParticipants;
$('turn-status').textContent = settings.turnDomain
  ? t('Ligado: a porta 443 atende o TURN em {domain}.', { domain: settings.turnDomain })
  : t('Desligado. Para ligar, defina TURN_DOMAIN com um subdomínio só para o TURN e reinicie o servidor.');
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
      if ($('require2fa').checked && !state.user.totp) return location.replace('/account');
      $('settings-ok').hidden = false;
    } catch (err) {
      showError($('settings-error'), err);
    }
  });
});

// --- uso -------------------------------------------------------------------

const gb = (bytes) => (bytes / 1e9).toLocaleString([], { maximumFractionDigits: bytes < 1e10 ? 2 : 1 });
const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });

const renderUsage = (u) => {
  $('usage-month').textContent = `${gb(u.bytesOut)} GB`;
  $('usage-rooms').textContent = u.live ? u.live.rooms : '–';
  $('usage-people').textContent = u.live ? u.live.participants : '–';
  $('usage-metrics-off').hidden = u.metrics;
  $('usage-quota').hidden = !u.quotaGb;
  if (u.quotaGb) {
    $('usage-bar').value = Math.min(100, u.percent);
    $('usage-bar').classList.toggle('warn', u.warning);
    $('usage-quota-text').classList.toggle('warn', u.warning);
    $('usage-quota-text').textContent = t('{percent}% da franquia de {quota} GB.', { percent: u.percent, quota: u.quotaGb });
  }
  $('quota').value = u.quotaGb;
  $('usage-history').replaceChildren(...u.history.map((h) => el('li', { textContent: `${monthName(h.month)}: ${gb(h.bytesOut)} GB` })));
  $('usage-history-empty').hidden = u.history.length > 0;
};

const loadUsage = async () => renderUsage(await api('/api/admin/usage'));
await loadUsage();
// Atualiza enquanto a seção estiver aberta
setInterval(() => !$('uso').hidden && loadUsage().catch(() => {}), 30_000);

$('quota-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('quota-error').hidden = true;
  $('quota-ok').hidden = true;
  busy(e.target, async () => {
    try {
      await api('/api/admin/settings', { monthlyQuotaGb: Number($('quota').value) });
      await loadUsage();
      $('quota-ok').hidden = false;
    } catch (err) {
      showError($('quota-error'), err);
    }
  });
});

// --- versão e aviso de atualização --------------------------------------------

const IMAGE = 'ghcr.io/dionatansimioni/overshoulder';
// Guia de atualização no idioma da página
const UPDATE_DOCS =
  lang === 'pt-BR'
    ? 'https://github.com/dionatansimioni/overshoulder/blob/main/docs/pt-BR/install.md#atualizar'
    : 'https://github.com/dionatansimioni/overshoulder/blob/main/docs/install.md#updating';
// Passos para atualizar em cada forma de instalação: [título, explicação, comandos]
const UPDATE_STEPS = {
  installer: ['Instalador de um comando', 'No servidor, rode:', ['sudo overshoulder update']],
  compose: ['Docker Compose com a imagem pronta', 'Na pasta do compose.yml, rode:', ['docker compose pull', 'docker compose up -d']],
  'compose-build': ['Docker Compose compilando o código', 'Na pasta do projeto, rode:', ['git pull', 'docker compose up -d --build']],
  docker: [
    'docker run',
    'Baixe a imagem nova e recrie o container com o mesmo comando usado na instalação:',
    [`docker pull ${IMAGE}:latest`, 'docker rm -f overshoulder', 'docker run … (o mesmo comando da instalação)'],
  ],
  coolify: [
    'Coolify, Dokploy ou EasyPanel',
    'Abra o serviço no painel e clique em Redeploy. Com a tag latest, a imagem nova é baixada; com uma versão fixa, troque antes a tag da imagem para {version}.',
    [],
  ],
};

const stepsBlock = (method, version) => {
  const [title, text, commands] = UPDATE_STEPS[method];
  const box = el('div');
  box.append(el('h3', { textContent: t(title) }), el('p', { className: 'small', textContent: t(text, { version }) }));
  if (commands.length) box.append(el('pre', {}, el('code', { textContent: commands.map((c) => t(c)).join('\n') })));
  return box;
};

const renderUpdate = (u) => {
  const status = $('update-status');
  status.classList.toggle('update-status-new', u.available);
  status.textContent = u.devBuild
    ? t('Versão de desenvolvimento (compilada a partir do código): o aviso de nova versão fica desligado.')
    : u.disabledByEnv
      ? t('Versão {current}. A verificação de novas versões está desligada pela variável UPDATE_CHECK=off.', u)
      : !u.enabled
        ? t('Versão {current}. A verificação de novas versões está desligada.', u)
        : u.available
          ? t('Versão {latest} disponível. Este servidor está na {current}.', u)
          : u.error
            ? t('Versão {current}. Não foi possível consultar a versão mais recente.', u)
            : u.latest
              ? t('Versão {current}: é a mais recente.', u)
              : t('Versão {current}. Ainda não verificado.', u);
  $('update-how').hidden = !u.available;
  $('update-notes').href = u.notesUrl;
  // Primeiro a forma como este servidor foi instalado; sem saber, todas aparecem
  const known = u.method && UPDATE_STEPS[u.method];
  $('update-steps').replaceChildren(
    ...(known ? [stepsBlock(u.method, u.latest)] : Object.keys(UPDATE_STEPS).map((m) => stepsBlock(m, u.latest))),
  );
  $('update-other').replaceChildren(
    ...Object.keys(UPDATE_STEPS)
      .filter((m) => known && m !== u.method)
      .map((m) => stepsBlock(m, u.latest)),
    el('p', { className: 'small' }, el('a', { href: UPDATE_DOCS, target: '_blank', rel: 'noopener noreferrer', textContent: t('Guia de atualização') })),
  );
  $('update-check').checked = u.enabled;
  $('update-check').disabled = u.disabledByEnv || u.devBuild;
  $('update-check-now').disabled = u.disabledByEnv || u.devBuild || !u.enabled;
};

renderUpdate(await api('/api/admin/update'));
$('update-check').addEventListener('change', async () => {
  $('update-error').hidden = true;
  try {
    await api('/api/admin/settings', { updateCheck: $('update-check').checked });
    renderUpdate(await api('/api/admin/update'));
  } catch (err) {
    showError($('update-error'), err);
  }
});
$('update-check-now').addEventListener('click', async () => {
  $('update-error').hidden = true;
  $('update-check-now').disabled = true;
  try {
    renderUpdate(await api('/api/admin/update/check', {}));
  } catch (err) {
    showError($('update-error'), err);
    $('update-check-now').disabled = false;
  }
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
      if (u.role !== 'admin' && !u.sso && !u.pending && !u.disabled) {
        actions.append(
          action('Link de nova senha', async () => {
            const { path } = await api('/api/admin/users/reset-link', { username: u.username });
            $('reset-for').textContent = u.username;
            $('reset-link').value = `${location.origin}${path}`;
            $('copy-reset').textContent = t('Copiar');
            $('user-reset').hidden = false;
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

$('copy-reset').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('reset-link').value).catch(() => $('reset-link').select());
  $('copy-reset').textContent = t('Copiado!');
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
