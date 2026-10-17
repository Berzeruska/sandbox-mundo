/**
 * Botão "Medir desempenho" (painel Dados): estatística dos quadros de cada cenário e o relatório em
 * texto que o usuário copia e cola. Funções puras: os tempos entram como parâmetro (testável com
 * tempos sintéticos); quem roda os cenários é o `App`.
 */

/** Contadores acumulados do worker (desde que ele nasceu). A diferença entre dois mostra um trecho. */
export interface WorkCounters {
  /** Tempo trabalhando no relógio (passos + aplicar recomposições), ms. */
  ms: number;
  ticks: number;
  recompositions: number;
  /**
   * Partes das recomposições, ms: mover as placas, clima e cores (no ajudante 2, sem parar o relógio,
   * quando há memória compartilhada) e aplicar no mundo do relógio e enviar à tela.
   */
  plates: number;
  climate: number;
  colors: number;
  send: number;
  /** Pior recomposição completa, ms, desde o último `resetWorst` (o começo do cenário). */
  worstGeology: number;
  /** Tempo em que o relógio ficou parado esperando o ajudante da geologia, ms. */
  waitMs: number;
  /** Mensagens de relógio enviadas à tela. */
  clockMessages: number;
  /** Soldas de continentes e pedaços de placa absorvidos (geologia). */
  welds: number;
  fragments: number;
  /** Ciclo de Wilson (G2): rupturas e supercontinentes já formados, e a fase atual (CYCLE_PHASES). */
  ruptures: number;
  supercontinents: number;
  cyclePhase: number;
  /** Recálculos só de clima (ciclo glacial ou controle, T7) e o tempo deles no ajudante 2 (ms). */
  climateUpdates: number;
  climateUpdateMs: number;
}

/** Nomes das fases do ciclo, pelo código em `WorkCounters.cyclePhase` (0 = sem placas andando ainda). */
export const CYCLE_PHASES = ['—', 'dispersão', 'reunião', 'supercontinente'] as const;

export function emptyWork(): WorkCounters {
  return { ms: 0, ticks: 0, recompositions: 0, plates: 0, climate: 0, colors: 0, send: 0, worstGeology: 0, waitMs: 0, clockMessages: 0, welds: 0, fragments: 0, ruptures: 0, supercontinents: 0, cyclePhase: 0, climateUpdates: 0, climateUpdateMs: 0 };
}

/**
 * Diferença entre dois retratos dos contadores. O pior é o do fim: o cenário zera o pior ao começar
 * (`resetWorst`), então ele é o pior do trecho (antes era o pior desde que o mundo abriu).
 */
export function workDelta(a: WorkCounters, b: WorkCounters): WorkCounters {
  return {
    ms: b.ms - a.ms,
    ticks: b.ticks - a.ticks,
    recompositions: b.recompositions - a.recompositions,
    plates: b.plates - a.plates,
    climate: b.climate - a.climate,
    colors: b.colors - a.colors,
    send: b.send - a.send,
    worstGeology: b.worstGeology,
    waitMs: b.waitMs - a.waitMs,
    clockMessages: b.clockMessages - a.clockMessages,
    welds: Math.max(0, b.welds - a.welds),
    fragments: Math.max(0, b.fragments - a.fragments),
    ruptures: Math.max(0, b.ruptures - a.ruptures),
    supercontinents: Math.max(0, b.supercontinents - a.supercontinents),
    cyclePhase: b.cyclePhase,
    climateUpdates: b.climateUpdates - a.climateUpdates,
    climateUpdateMs: b.climateUpdateMs - a.climateUpdateMs,
  };
}

export interface FrameSummary {
  frames: number;
  durationMs: number;
  fpsAvg: number;
  /** Pior janela de 1 s. */
  fpsMin: number;
  /** Maior intervalo entre dois quadros (ms). */
  worstFrameMs: number;
  /** Quadros com intervalo acima de 50 ms (abaixo de 20 fps naquele instante). */
  slowFrames: number;
  /** Trabalho da thread principal por quadro (ms): média e máximo. */
  workAvgMs: number;
  workMaxMs: number;
  /** Quadros em que o globo foi desenhado de fato (parado, nada muda e nada é desenhado). */
  drawn: number;
}

/** Junta os quadros de um cenário. `frame` recebe o horário do quadro e o trabalho dele (ms). */
export class FrameRecorder {
  private times: number[] = [];
  private work: number[] = [];
  private drew: boolean[] = [];

  frame(time: number, workMs: number, drew = true): void {
    this.times.push(time);
    this.work.push(workMs);
    this.drew.push(drew);
  }

  summary(): FrameSummary {
    const t = this.times;
    const frames = Math.max(0, t.length - 1);
    const durationMs = frames > 0 ? (t[t.length - 1] as number) - (t[0] as number) : 0;
    let worst = 0;
    let slow = 0;
    for (let i = 1; i < t.length; i++) {
      const gap = (t[i] as number) - (t[i - 1] as number);
      worst = Math.max(worst, gap);
      if (gap > 50) slow++;
    }
    // Pior janela de 1 s, deslizando quadro a quadro: quadros que começam dentro dela.
    let fpsMin = durationMs >= 1000 ? Infinity : frames > 0 ? (frames * 1000) / durationMs : 0;
    if (durationMs >= 1000) {
      let j = 0;
      for (let i = 0; i < t.length; i++) {
        while (j < t.length - 1 && (t[j + 1] as number) - (t[i] as number) <= 1000) j++;
        if ((t[i] as number) + 1000 > (t[t.length - 1] as number)) break;
        // Intervalos inteiros dentro da janela, mais a fração do que atravessa o fim dela.
        const inside = j - i;
        const next = j + 1 < t.length ? (t[j + 1] as number) - (t[j] as number) : 0;
        const partial = next > 0 ? ((t[i] as number) + 1000 - (t[j] as number)) / next : 0;
        fpsMin = Math.min(fpsMin, inside + partial);
      }
    }
    const work = this.work.slice(1);
    return {
      frames,
      durationMs,
      fpsAvg: durationMs > 0 ? (frames * 1000) / durationMs : 0,
      fpsMin: fpsMin === Infinity ? 0 : fpsMin,
      worstFrameMs: worst,
      slowFrames: slow,
      workAvgMs: work.length ? work.reduce((a, b) => a + b, 0) / work.length : 0,
      workMaxMs: work.length ? Math.max(...work) : 0,
      drawn: this.drew.slice(1).filter(Boolean).length,
    };
  }
}

export interface ScenarioResult {
  name: string;
  frames: FrameSummary;
  work: WorkCounters;
  /** Tempo da tela ao receber cada recomposição (aplicar cores e enviar à GPU), ms. */
  receiveAvgMs: number;
  receiveMaxMs: number;
}

export interface GenerationResult {
  totalMs: number;
  workerMs: number;
  stagesMs: Record<string, number>;
  /** Fração do terreno feita pelo ajudante 2. */
  helperShare: number;
  /** Tela: montar o globo com o mundo recebido (ms). */
  receiveMs: number;
}

/** Primeira abertura da página (o mundo nasce junto com a página, sem nada em cache no worker). */
export interface FirstLoad {
  /** Da navegação até o globo aparecer. */
  pageToGlobeMs: number;
  /** Do pedido de mundo (página já carregada) até o globo. */
  requestToGlobeMs: number;
  workerMs: number;
  stagesMs: Record<string, number>;
}

export interface DeviceInfo {
  version: string;
  date: string;
  gpu: string;
  drawing: string;
  cores: number;
  /** Memória compartilhada entre a tela e o worker (teste da correção 2). */
  sharedMemory: string;
  screen: string;
  userAgent: string;
}

const f0 = (v: number): string => v.toFixed(0);
const f1 = (v: number): string => v.toFixed(1);
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

/** Relógio do worker num cenário, em uma linha. */
function workLine(r: ScenarioResult): string {
  const w = r.work;
  const secs = r.frames.durationMs / 1000;
  if (w.ticks === 0) return 'worker parado';
  const busy = secs > 0 ? (100 * w.ms) / 1000 / secs : 0;
  const climate = w.climateUpdates ? ` · clima ${w.climateUpdates}× (média ${f0(w.climateUpdateMs / w.climateUpdates)} ms no ajudante)` : '';
  const base = `worker ${f0(w.ticks / Math.max(secs, 1e-9))} passos/s · ${(w.ms / w.ticks).toFixed(3)} ms/passo · ocupado ${f0(busy)}% · ${f0(w.clockMessages / Math.max(secs, 1e-9))} msg/s${climate}`;
  if (!w.recompositions) return base;
  const k = w.recompositions;
  return (
    `${base}\n    ${k} recomposições (${w.welds} soldas · ${w.ruptures} rupturas · ${w.fragments} pedaços absorvidos): média ${f0((w.plates + w.climate + w.colors + w.send) / k)} ms (placas ${f0(w.plates / k)} · clima ${f0(w.climate / k)} · cores ${f0(w.colors / k)} · aplicar ${f0(w.send / k)}) · pior ${f0(w.worstGeology)} ms · relógio esperou ${f0(w.waitMs)} ms` +
    `\n    tela ao receber: média ${f1(r.receiveAvgMs)} · pior ${f1(r.receiveMaxMs)} ms`
  );
}

/** O relatório completo, em texto simples (o usuário copia e cola na conversa). */
export function formatReport(
  device: DeviceInfo,
  scenarios: readonly ScenarioResult[],
  gen: GenerationResult | null,
  first: FirstLoad | null = null,
  stalls: readonly string[] = [],
): string {
  const lines = [
    'Sandbox Mundo — medição de desempenho',
    `versão ${device.version} · ${device.date}`,
    `GPU: ${device.gpu}`,
    `desenho: ${device.drawing} · núcleos: ${device.cores} · memória compartilhada: ${device.sharedMemory} · ${device.screen}`,
    `navegador: ${device.userAgent}`,
    '',
    `${pad('cenário', 26)}${lpad('fps méd', 8)}${lpad('mín', 6)}${lpad('pior quadro', 13)}${lpad('>50ms', 7)}${lpad('tela ms', 9)}${lpad('desenhados', 13)}`,
  ];
  for (const s of scenarios) {
    const fr = s.frames;
    lines.push(
      `${pad(s.name, 26)}${lpad(f0(fr.fpsAvg), 8)}${lpad(f0(fr.fpsMin), 6)}${lpad(`${f0(fr.worstFrameMs)} ms`, 13)}${lpad(String(fr.slowFrames), 7)}${lpad(`${f1(fr.workAvgMs)}/${f0(fr.workMaxMs)}`, 9)}${lpad(`${fr.drawn} de ${fr.frames}`, 13)}`,
    );
  }
  lines.push(
    '',
    '("tela ms" = trabalho da thread principal por quadro: média/pior; "desenhados" = quadros em que o globo',
    ' foi desenhado. Parado, nada é desenhado e o fps é o ritmo que o aparelho dá a uma página parada.',
    ' A meta de "pausado" vale para "pausado, girando". "De perto" = zoom máximo, células quadradas.)',
  );
  for (const s of scenarios) lines.push(`${s.name}: ${workLine(s)}`);
  if (gen) {
    const stages = Object.entries(gen.stagesMs)
      .map(([k, v]) => `${k} ${f0(v)}`)
      .join(' · ');
    lines.push(
      '',
      `geração: ${f0(gen.totalMs)} ms do pedido ao globo (worker ${f0(gen.workerMs)} · tela ao receber ${f0(gen.receiveMs)})`,
      `  etapas: ${stages} · ajudante fez ${f0(gen.helperShare * 100)}% do terreno`,
    );
  }
  if (first) {
    const stages = Object.entries(first.stagesMs)
      .map(([k, v]) => `${k} ${f0(v)}`)
      .join(' · ');
    lines.push(
      `primeira abertura: ${f0(first.pageToGlobeMs)} ms da página ao globo (pedido ao globo ${f0(first.requestToGlobeMs)} · worker ${f0(first.workerMs)})`,
      `  etapas: ${stages}`,
    );
  }
  if (stalls.length) lines.push('', 'desde que a página abriu (inclui a medição):', ...stalls);
  return lines.join('\n');
}
