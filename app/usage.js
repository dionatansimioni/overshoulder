// Painel de uso: quantos dados de vídeo e áudio o servidor enviou no mês.
// A fonte é a métrica livekit_packet_bytes{direction="outgoing"} do LiveKit (Prometheus, só em
// 127.0.0.1). O contador do LiveKit zera quando ele reinicia; aqui só se somam as diferenças,
// guardadas por mês (UTC) no state.json.

const HISTORY_MONTHS = 12;

// Soma todas as séries de bytes enviados (cada combinação de rótulos é uma linha)
export const outgoingBytes = (text) => {
  let total = 0;
  let found = false;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('livekit_packet_bytes{') || !line.includes('direction="outgoing"')) continue;
    const value = Number(line.slice(line.lastIndexOf('}') + 1).trim().split(/\s+/)[0]);
    if (Number.isFinite(value) && value >= 0) {
      total += value;
      found = true;
    }
  }
  return found ? total : 0;
};

export const monthOf = (date = new Date()) => date.toISOString().slice(0, 7);

// Soma "bytes" ao mês atual em usage (mutável), passando o mês anterior para o histórico
export const addUsage = (usage, bytes, month = monthOf()) => {
  if (usage.month !== month) {
    if (usage.month) usage.history = [{ month: usage.month, bytesOut: usage.bytesOut ?? 0 }, ...(usage.history ?? [])].slice(0, HISTORY_MONTHS);
    usage.month = month;
    usage.bytesOut = 0;
    usage.warned = 0;
  }
  usage.bytesOut = (usage.bytesOut ?? 0) + bytes;
  return usage;
};

export const createUsageMeter = ({ metricsUrl, store, quotaGb, log, timeoutMs = 5000 }) => {
  let last = null;
  let reachable = false;

  const poll = async () => {
    let total;
    try {
      const res = await fetch(metricsUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      total = outgoingBytes(await res.text());
      reachable = true;
    } catch (err) {
      if (reachable) log.warn('métricas do LiveKit indisponíveis', { motivo: err.message });
      reachable = false;
      return;
    }
    // Primeira leitura serve de referência; contador menor que o anterior = LiveKit reiniciou
    const delta = last === null ? 0 : total >= last ? total - last : total;
    last = total;
    const month = monthOf();
    if (delta === 0 && store.state.usage?.month === month) return;
    store.update((s) => {
      s.usage = addUsage(s.usage ?? {}, delta, month);
      // Avisa nos logs uma vez ao passar de 80% e de 100% da franquia
      const quota = quotaGb() * 1e9;
      if (quota > 0) {
        const level = s.usage.bytesOut >= quota ? 100 : s.usage.bytesOut >= quota * 0.8 ? 80 : 0;
        if (level > (s.usage.warned ?? 0)) {
          s.usage.warned = level;
          log.warn('franquia de dados do mês', { usadoGb: +(s.usage.bytesOut / 1e9).toFixed(1), franquiaGb: quotaGb(), percentual: level });
        }
      }
    });
  };

  const view = () => {
    const usage = store.state.usage?.month === monthOf() ? store.state.usage : { month: monthOf(), bytesOut: 0 };
    const quota = quotaGb();
    const percent = quota > 0 ? Math.round((usage.bytesOut / (quota * 1e9)) * 100) : null;
    return {
      month: usage.month,
      bytesOut: usage.bytesOut,
      quotaGb: quota,
      percent,
      warning: percent !== null && percent >= 80,
      history: (store.state.usage?.month === monthOf() ? store.state.usage.history : addUsage(structuredClone(store.state.usage ?? {}), 0).history) ?? [],
      metrics: reachable,
    };
  };

  return { poll, view };
};
