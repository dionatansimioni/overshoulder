// Atalhos de teclado da sala. Cada ação tem um atalho padrão e a pessoa troca por qualquer combinação.
// A escolha fica só no navegador (localStorage): nada disso vai para o servidor.
import { t } from '/static/i18n.js';

const STORAGE_KEY = 'shortcuts';
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);
// Sem modificador, estas teclas pertencem à navegação do teclado e dos botões
const RESERVED_ALONE = new Set(['Escape', 'Tab', 'Enter', 'Space']);

// "Ctrl+Shift+M", na ordem fixa Ctrl, Alt, Shift, Meta. Só modificador apertado não é atalho.
export const comboFromEvent = (e) => {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+');
};

// Só a tecla, sem Ctrl, Alt ou Meta: não serve para Espaço, Enter, Tab e Esc
export const isReservedCombo = (combo) => RESERVED_ALONE.has(combo.replace(/^Shift\+/, ''));

const ARROWS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
export const formatCombo = (combo) =>
  combo
    ? combo
        .split('+')
        .map((part) => ARROWS[part] ?? part)
        .join(' + ')
    : t('Sem atalho');

// Quem está digitando num campo não aciona atalhos
export const isTyping = (target) => {
  if (!(target instanceof Element)) return false;
  if (target.closest('textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  const input = target.closest('input');
  return !!input && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(input.type);
};

export const loadShortcuts = (defaults) => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const out = { ...defaults };
    for (const id of Object.keys(defaults)) if (id in saved && (saved[id] === null || typeof saved[id] === 'string')) out[id] = saved[id];
    return out;
  } catch {
    return { ...defaults };
  }
};

const saveShortcuts = (map) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
};

// actions: [{ id, label, key (padrão), run }]. list: o <ul> da tela de ajustes. Devolve o que a sala precisa.
export const mountShortcuts = ({ actions, list, resetButton, notify }) => {
  const defaults = Object.fromEntries(actions.map((a) => [a.id, a.key ?? null]));
  let map = loadShortcuts(defaults);
  let capturing = null;

  const stopCapture = () => {
    if (!capturing) return;
    document.removeEventListener('keydown', capturing.handler, true);
    capturing = null;
  };

  const render = () => {
    list.replaceChildren(
      ...actions.map((a) => {
        const li = document.createElement('li');
        li.className = 'shortcut-row';
        const name = document.createElement('span');
        name.textContent = a.label;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary shortcut-key';
        btn.dataset.action = a.id;
        btn.textContent = formatCombo(map[a.id]);
        btn.title = t('Mudar o atalho de {action}', { action: a.label });
        btn.setAttribute('aria-label', `${a.label}: ${formatCombo(map[a.id])}`);
        btn.addEventListener('click', () => capture(a, btn));
        li.append(name, btn);
        return li;
      }),
    );
  };

  const assign = (action, combo) => {
    if (combo) {
      // Uma combinação vale para uma ação só: a outra fica sem atalho
      const other = actions.find((x) => x.id !== action.id && map[x.id] === combo);
      if (other) {
        map[other.id] = null;
        notify?.(t('{key} já era usado por “{other}”. Esse ficou sem atalho.', { key: formatCombo(combo), other: other.label }));
      }
    }
    map[action.id] = combo;
    saveShortcuts(map);
    render();
  };

  const capture = (action, btn) => {
    stopCapture();
    btn.textContent = t('Pressione a combinação…');
    btn.classList.add('capturing');
    const handler = (e) => {
      // Enquanto a pessoa escolhe a combinação, a tecla não faz mais nada
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopCapture();
        return render();
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        stopCapture();
        return assign(action, null);
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (isReservedCombo(combo)) return notify?.(t('Espaço, Enter, Tab e Esc não podem ser atalhos sozinhos. Junte com Ctrl ou Alt.'));
      stopCapture();
      assign(action, combo);
    };
    capturing = { handler };
    document.addEventListener('keydown', handler, true);
    // Clicar fora do botão cancela
    btn.addEventListener(
      'blur',
      () => {
        stopCapture();
        render();
      },
      { once: true },
    );
  };

  resetButton.addEventListener('click', () => {
    stopCapture();
    map = { ...defaults };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (capturing || e.repeat || e.defaultPrevented || isTyping(e.target)) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const action = actions.find((a) => map[a.id] === combo);
    if (!action) return;
    if (action.run()) e.preventDefault();
  });

  render();
  return { current: () => ({ ...map }) };
};
