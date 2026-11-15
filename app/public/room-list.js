// Lista de salas da barra lateral (página inicial e sala): as salas deste navegador, com quem está
// no ar, e, para o admin, as salas fixas com a chave guardada neste navegador.
import { t } from '/static/i18n.js';
import { forgetRoom, getFixedKey, recentRooms, roomLink } from '/static/rooms-local.js';
import { $, api } from '/static/ui.js';

const TYPE_LABEL = { together: 'Jogando juntos', live: 'Live' };
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

const roomItem = ({ href, title, detail, live, onForget, current, onChange }) => {
  const li = document.createElement('li');
  const a = Object.assign(document.createElement('a'), { href, className: 'room-link' });
  if (current) a.setAttribute('aria-current', 'page');
  const dot = Object.assign(document.createElement('span'), { className: `dot${live ? ' live' : ''}` });
  dot.title = t(live ? 'Ao vivo' : 'Fora do ar');
  const text = Object.assign(document.createElement('span'), { className: 'room-link-text' });
  text.append(
    Object.assign(document.createElement('b'), { textContent: title }),
    Object.assign(document.createElement('span'), { className: 'muted small', textContent: detail }),
  );
  a.append(dot, text);
  li.append(a);
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
          title: r.title ?? t(r.h ? 'Sua sala' : 'Sala de outra pessoa'),
          detail: parts.join(' · '),
          live: !!status?.online,
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
