// Lista de salas da barra lateral (página inicial e sala): as salas deste navegador, com quem está
// no ar, e, para o admin, as salas fixas com a chave guardada neste navegador.
import { t } from '/static/i18n.js';
import { forgetRoom, getFixedKey, recentRooms, roomLink, setNickname } from '/static/rooms-local.js';
import { $, api } from '/static/ui.js';

const TYPE_LABEL = { together: 'Jogando juntos', live: 'Live' };
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

// Ícones dos tipos, os mesmos de "Criar sala": controle (Jogando juntos) e antena (Live)
const TYPE_ICON = {
  together:
    '<path d="M6 8h12a4 4 0 0 1 3.9 4.8l-.9 4.4a2.4 2.4 0 0 1-4.2 1L15 16H9l-1.8 2.2a2.4 2.4 0 0 1-4.2-1l-.9-4.4A4 4 0 0 1 6 8Z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
  live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const typeBadge = (type, live) => {
  const badge = Object.assign(document.createElement('span'), { className: `room-type type-${TYPE_ICON[type] ? type : 'other'}` });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = TYPE_ICON[type] ?? '<circle cx="12" cy="12" r="6"/>';
  const dot = Object.assign(document.createElement('span'), { className: `dot${live ? ' live' : ''}` });
  dot.title = t(live ? 'Ao vivo' : 'Fora do ar');
  badge.append(svg, dot);
  return badge;
};

// Dois cliques no nome abrem a edição; Enter ou clicar fora salva, Esc desiste. Um clique só abre a
// sala (depois de um instante, para dar tempo do segundo clique).
const makeRenamable = (a, name, onRename) => {
  name.title = t('Dê dois cliques para renomear');
  let timer = null;
  const edit = () => {
    const input = Object.assign(document.createElement('input'), { className: 'room-rename', value: name.textContent, maxLength: 40 });
    input.setAttribute('aria-label', t('Novo nome da sala'));
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.replaceWith(a);
      if (save && value !== name.textContent) onRename(value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    a.replaceWith(input);
    input.focus();
    input.select();
  };
  name.addEventListener('click', (e) => {
    // O clique de verdade no link sai depois (a.click()), passando pela confirmação de sair da sala
    e.preventDefault();
    e.stopPropagation();
    if (timer) {
      clearTimeout(timer);
      timer = null;
      return edit();
    }
    timer = setTimeout(() => {
      timer = null;
      a.click();
    }, 280);
  });
  a.addEventListener('keydown', (e) => e.key === 'F2' && (e.preventDefault(), edit()));
};

const roomItem = ({ href, title, detail, type, live, onForget, onRename, current, onChange }) => {
  const li = document.createElement('li');
  const a = Object.assign(document.createElement('a'), { href, className: 'room-link' });
  if (current) a.setAttribute('aria-current', 'page');
  const text = Object.assign(document.createElement('span'), { className: 'room-link-text' });
  const name = Object.assign(document.createElement('b'), { textContent: title });
  text.append(name, Object.assign(document.createElement('span'), { className: 'muted small', textContent: detail }));
  a.append(typeBadge(type, live), text);
  li.append(a);
  if (onRename) makeRenamable(a, name, onRename);
  if (onForget) {
    const forget = Object.assign(document.createElement('button'), { type: 'button', className: 'forget', textContent: '✕' });
    forget.setAttribute('aria-label', t('Esquecer {name}', { name: title }));
    forget.title = t('Esquecer esta sala neste navegador');
    forget.addEventListener('click', () => {
      forgetRoom(onForget);
      onChange();
    });
    li.append(forget);
  }
  return li;
};

// Lista as salas nos elementos com estes ids; `current` é o código da sala aberta agora (na própria sala)
export const mountRoomList = ({
  isAdmin = false,
  current = null,
  ids = { mine: 'my-rooms', empty: 'no-rooms', fixedSection: 'fixed-section', fixed: 'fixed-rooms' },
} = {}) => {
  let roomStatus = {};

  const renderRooms = () => {
    // Não atrapalha quem está renomeando uma sala
    if ($(ids.mine).querySelector('.room-rename')) return;
    // Salas encerradas somem da lista; as fixas e as que ainda não foram consultadas ficam
    const list = recentRooms().filter((r) => roomStatus[r.code]?.exists !== false);
    $(ids.mine).replaceChildren(
      ...list.map((r) => {
        const status = roomStatus[r.code];
        const parts = [t(TYPE_LABEL[r.type] ?? 'Sala')];
        parts.push(status?.online ? t('{n} pessoa(s) agora', { n: status.online }) : when(r.at));
        if (!r.h) parts.push(t('convidado'));
        return roomItem({
          href: roomLink(r),
          title: r.nick || r.title || t(r.h ? 'Sua sala' : 'Sala de outra pessoa'),
          detail: parts.join(' · '),
          type: r.type,
          live: !!status?.online,
          onRename: (nick) => {
            setNickname(r.code, nick);
            renderRooms();
          },
          onForget: r.code,
          current: r.code === current,
          onChange: renderRooms,
        });
      }),
    );
    $(ids.empty).hidden = list.length > 0;
  };

  const refreshStatus = async () => {
    const codes = recentRooms().map((r) => r.code);
    if (!codes.length) return;
    try {
      roomStatus = (await api('/api/rooms/status', { codes })).status;
    } catch {
      return;
    }
    for (const [code, s] of Object.entries(roomStatus)) if (!s.exists) forgetRoom(code);
    renderRooms();
  };

  // Salas fixas do admin: só as que têm a chave guardada neste navegador entram como anfitrião
  const loadFixedRooms = async () => {
    const { rooms } = await api('/api/admin/rooms').catch(() => ({ rooms: [] }));
    const withKey = rooms.filter((r) => getFixedKey(r.id));
    $(ids.fixedSection).hidden = rooms.length === 0;
    $(ids.fixed).replaceChildren(
      ...withKey.map((r) =>
        roomItem({
          href: `/r/${r.roomId}#${new URLSearchParams({ k: getFixedKey(r.id), h: r.hostKey })}`,
          title: r.title,
          detail: [t(TYPE_LABEL[r.type]), r.online ? t('{n} pessoa(s) agora', { n: r.online }) : t('vazia')].join(' · '),
          type: r.type,
          live: r.online > 0,
          current: r.roomId === current,
        }),
      ),
    );
    if (withKey.length < rooms.length) {
      const li = document.createElement('li');
      li.className = 'muted small';
      li.textContent = t('{n} sala(s) com a chave em outro navegador: veja em Administração.', { n: rooms.length - withKey.length });
      $(ids.fixed).append(li);
    }
  };

  renderRooms();
  refreshStatus();
  setInterval(refreshStatus, 15_000);
  if (isAdmin) loadFixedRooms();
  return { refresh: refreshStatus };
};
