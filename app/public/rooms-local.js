// Salas guardadas só neste navegador: a chave E2EE nunca vai ao servidor, então só quem tem o link
// consegue reabrir a sala. A página inicial lista estas salas; a sala as registra ao entrar.

const RECENT = 'rooms';
const RECENT_MAX = 20;

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

export const randomKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Chave E2EE de cada sala fixa: nasce no navegador do admin e fica só nele
const fixedKeyName = (id) => `fixed-key:${id}`;
export const getFixedKey = (id) => read(fixedKeyName(id));
export const setFixedKey = (id, key) => write(fixedKeyName(id), key);

// Cada sala: { code, k, h (só de quem é anfitrião), type, title, at }
export const recentRooms = () => {
  try {
    const list = JSON.parse(read(RECENT) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => r && typeof r.code === 'string' && typeof r.k === 'string') : [];
  } catch {
    return [];
  }
};
const save = (list) => write(RECENT, JSON.stringify(list.slice(0, RECENT_MAX)));

// A mais recente fica no topo; voltar a uma sala como espectador não apaga a chave de anfitrião
export const rememberRoom = (room) => {
  const list = recentRooms();
  const old = list.find((r) => r.code === room.code);
  const entry = { ...old, ...room, h: room.h ?? old?.h, at: Date.now() };
  if (!entry.h) delete entry.h;
  save([entry, ...list.filter((r) => r.code !== room.code)]);
};

export const forgetRoom = (code) => save(recentRooms().filter((r) => r.code !== code));
export const forgetAllRooms = () => save([]);

// O anfitrião trocou o link: a sala continua a mesma, com o código novo
export const renameRoom = (oldCode, newCode) =>
  save(recentRooms().map((r) => (r.code === oldCode ? { ...r, code: newCode } : r)));

// Apelido que a pessoa dá à sala na lista (só neste navegador); vazio volta ao nome original
export const setNickname = (code, nick) =>
  save(recentRooms().map((r) => (r.code === code ? { ...r, nick: nick || undefined } : r)));

export const roomLink = (r, { asHost = true } = {}) =>
  `/r/${r.code}#${new URLSearchParams({ k: r.k, ...(asHost && r.h && { h: r.h }) })}`;
