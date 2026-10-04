/**
 * Talks only to the local Python sidecar, which calls laya.Router.predict.
 * Never fabricates answers. If the sidecar or the checkpoint is down, error
 * is the exact string "Laya not running".
 */
export const NOT_RUNNING = "Laya not running";
export const MIN_CONFIDENCE = 0.6;

const SIDECAR = process.env.LAYA_SIDECAR ?? "http://127.0.0.1:4011";

export type LayaAnswer = {
  type?: string;
  choice?: string;
  score?: number | string;
  noul?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  answer_confidence?: number;
  low_confidence?: boolean;
  abstention?: string;
  abstention_threshold?: number;
  legend?: unknown;
};

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
} | null;

export type LayaOk = {
  ok: true;
  model: string | null;
  answers: Record<string, LayaAnswer>;
  usage: Usage;
  routing: unknown;
};

export type LayaFail = { ok: false; error: string };

export type LayaResult = LayaOk | LayaFail;

/** Gate on min_confidence via abstention / answer_confidence. Never reads action. */
export function passed(answer: LayaAnswer | undefined): boolean {
  if (!answer) return false;
  if (answer.low_confidence === true) return false;
  if (answer.abstention == null) {
    const c = answer.answer_confidence;
    if (typeof c !== "number" || !Number.isFinite(c)) return false;
    return c >= MIN_CONFIDENCE;
  }
  return answer.abstention === "passed";
}

export function costNote(usage: Usage): { cost: string; usage: { input_tokens: number | null; output_tokens: number | null } | null } {
  const tokens =
    usage && (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number")
      ? {
          input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        }
      : null;
  if (usage && typeof usage.cost === "number" && Number.isFinite(usage.cost)) {
    return { cost: `from usage: ${usage.cost}`, usage: tokens };
  }
  return { cost: "cost is unknown", usage: tokens };
}

export async function predict(state: unknown, questions: unknown): Promise<LayaResult> {
  try {
    const res = await fetch(`${SIDECAR}/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, questions, min_confidence: MIN_CONFIDENCE }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; model?: string; answers?: Record<string, LayaAnswer>; usage?: Usage; routing?: unknown }
      | null;
    if (!data || data.ok !== true || !data.answers) {
      if (!data || data.error === NOT_RUNNING || res.status === 503) return { ok: false, error: NOT_RUNNING };
      return { ok: false, error: typeof data.error === "string" ? data.error : NOT_RUNNING };
    }
    return {
      ok: true,
      model: data.model ?? null,
      answers: data.answers,
      usage: data.usage ?? null,
      routing: data.routing ?? null,
    };
  } catch {
    return { ok: false, error: NOT_RUNNING };
  }
}

export async function sidecarHealth(): Promise<{ loaded: boolean; error: string | null }> {
  try {
    const res = await fetch(`${SIDECAR}/health`, { signal: AbortSignal.timeout(400) });
    const data = (await res.json().catch(() => null)) as { loaded?: boolean } | null;
    if (res.ok && data?.loaded === true) return { loaded: true, error: null };
    return { loaded: false, error: NOT_RUNNING };
  } catch {
    return { loaded: false, error: NOT_RUNNING };
  }
}
