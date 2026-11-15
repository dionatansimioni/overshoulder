// Qualidades de transmissão, da mais leve à mais pesada. A ordem e os nomes são os mesmos de
// QUALITIES no server.js; o bitrate é o teto da camada mais alta, que vai a cada pessoa que aguenta.
import { t } from '/static/i18n.js';

export const PRESETS = {
  '720p30': { width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  '720p60': { width: 1280, height: 720, fps: 60, bitrate: 4_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 7_000_000 },
  '1440p60': { width: 2560, height: 1440, fps: 60, bitrate: 12_000_000 },
};
export const QUALITIES = Object.keys(PRESETS);
export const QUALITY_LABELS = Object.fromEntries(Object.entries(PRESETS).map(([q, p]) => [q, `${p.height}p · ${p.fps} fps`]));

// Acima disto o padrão é 720p: qualidade maior mostra o aviso de banda
export const HEAVY_HEIGHT = 720;
// No painel, o limite de pessoas passa a ser destacado a partir daqui
export const MANY_PEOPLE = 200;

const fmt = (n) => n.toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1 });

// Quanto o servidor envia com `people` pessoas assistindo na qualidade dada
export const bandwidth = (quality, people) => {
  const mbps = (PRESETS[quality].bitrate / 1e6) * people;
  return { mbps: fmt(mbps), gb: fmt((mbps * 3600) / 8 / 1000) };
};

export const bandwidthWarning = (quality, people) => {
  const perPerson = fmt(PRESETS[quality].bitrate / 1e6);
  const base = t('Cada pessoa recebe até {mbps} Mbps.', { mbps: perPerson });
  if (people < 1) return `${base} ${t('Confira a banda e a franquia do servidor antes de subir a qualidade.')}`;
  if (people === 1) return `${base} ${t('Com 1 pessoa assistindo, o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).', bandwidth(quality, 1))}`;
  return `${base} ${t('Com {people} pessoas assistindo, o servidor envia cerca de {mbps} Mbps ({gb} GB por hora).', { people, ...bandwidth(quality, people) })}`;
};

// Mostra só as opções de um <select> até a qualidade máxima e escolhe a padrão
export const limitQualitySelect = (select, { default: def, max }) => {
  const top = QUALITIES.indexOf(max);
  for (const option of [...select.options]) {
    if (QUALITIES.indexOf(option.value) > top) option.remove();
  }
  select.value = def;
};
