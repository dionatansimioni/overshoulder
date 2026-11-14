// Emojis do seletor do chat, por categoria. Lista própria e curta: os mais usados.
export const CATEGORIES = [
  {
    id: 'rostos',
    label: 'Rostos',
    emojis: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👻 👽 🤖',
  },
  {
    id: 'gestos',
    label: 'Gestos e pessoas',
    emojis: '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 🦾 🧠 👀 👁️ 👅 👄 🫡 🫶 🙋 🙇 🤦 🤷 💃 🕺 🏃 🧍',
  },
  {
    id: 'coracoes',
    label: 'Corações e símbolos',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 ✨ ⭐ 🌟 🔥 ⚡ ✅ ❌ ❓ ❗ ⚠️ 🚫 🔞 ♻️ 🆗 🆒 🆕 🆙',
  },
  {
    id: 'jogos',
    label: 'Jogos e atividades',
    emojis: '🎮 🕹️ 👾 🎲 ♟️ 🧩 🃏 🎯 🎳 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🥋 ⛳ 🏁 🚩 🎉 🎊 🎈 🎁 🎂 🎤 🎧 🎵 🎶 🎸 🎹 🥁 🎬 📺 📷 🎥 🍿',
  },
  {
    id: 'natureza',
    label: 'Animais e natureza',
    emojis: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🦈 🐬 🐳 🌵 🌲 🌴 🍀 🌸 🌻 🌙 ☀️ 🌈 ☁️ ❄️ 🌊',
  },
  {
    id: 'comida',
    label: 'Comida e bebida',
    emojis: '🍎 🍌 🍉 🍇 🍓 🍒 🍍 🥑 🌶️ 🌽 🥕 🥔 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍦 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🧉',
  },
  {
    id: 'objetos',
    label: 'Objetos e viagem',
    emojis: '💻 🖥️ ⌨️ 🖱️ 🎙️ 📱 ☎️ 🔋 🔌 💡 🔦 📦 📌 📎 ✏️ 📝 📅 📈 📉 🔒 🔑 🔨 🛠️ ⚙️ 🧲 💣 🔫 🗡️ 🛡️ 💰 💎 👑 🎩 🕶️ 🚀 🛸 ✈️ 🚗 🏎️ 🚓 🚑 🚒 🏠 🏰 🌍 ⏰ ⌛',
  },
].map((c) => ({ ...c, emojis: c.emojis.split(' ') }));

// Ícone de cada aba: o primeiro emoji da categoria
export const RECENT_ID = 'recentes';
export const RECENT_MAX = 24;

const EMOJI_PARTS = /[\p{Extended_Pictographic}‍️⃣\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu;

// Mensagem só com emojis (até 27, como no Discord) aparece em tamanho grande
export const isOnlyEmoji = (text) => {
  if (!/\p{Extended_Pictographic}/u.test(text)) return false;
  if (text.replace(EMOJI_PARTS, '').trim() !== '') return false;
  const count = [...new Intl.Segmenter().segment(text.replace(/\s/g, ''))].length;
  return count <= 27;
};
