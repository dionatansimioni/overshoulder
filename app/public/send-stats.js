// O que está saindo de fato para o servidor, a partir das estatísticas do WebRTC de cada camada do
// simulcast (a maior vem primeiro). Sem dependência do navegador: os testes chamam direto.

// Resumo de um instante; `previous` é o `snap` do resumo anterior, para calcular taxa e perda
export const summarizeSend = (layers, previous) => {
  if (!layers?.length) return null;
  const top = layers[0];
  const sum = (field) => layers.reduce((n, l) => n + Math.max(0, l[field] ?? 0), 0);
  const snap = { bytes: sum('bytesSent'), sent: sum('packetsSent'), lost: sum('packetsLost'), time: top.timestamp };
  let mbps = null;
  let lossPct = null;
  if (previous && snap.time > previous.time) {
    mbps = ((snap.bytes - previous.bytes) * 8) / ((snap.time - previous.time) / 1000) / 1e6;
    const sent = snap.sent - previous.sent;
    const lost = snap.lost - previous.lost;
    lossPct = sent + lost > 0 ? (100 * lost) / (sent + lost) : 0;
  }
  return {
    width: top.frameWidth ?? 0,
    height: top.frameHeight ?? 0,
    fps: Math.round(top.framesPerSecond ?? 0),
    mbps,
    lossPct,
    limitedBy: top.qualityLimitationReason ?? 'none',
    snap,
  };
};

// Avisos para quem transmite, um resumo por segundo: o navegador limitando a qualidade por falta de
// banda e perda de pacotes alta, só quando duram alguns segundos seguidos (picos curtos não contam).
// Cada aviso dispara uma vez por episódio e volta a valer depois que a rede melhora.
export const createNetworkWatch = ({ seconds = 6, maxLossPct = 5 } = {}) => {
  let limited = 0;
  let lossy = 0;
  return (summary) => {
    limited = summary?.limitedBy === 'bandwidth' ? limited + 1 : 0;
    lossy = summary?.lossPct != null && summary.lossPct >= maxLossPct ? lossy + 1 : 0;
    return { bandwidth: limited === seconds, loss: lossy === seconds };
  };
};
