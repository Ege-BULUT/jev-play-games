import 'server-only';
import { experimental_evaluate as evaluate, InvalidResponseDataError } from 'ai';
import type { Option } from '@/games/types';

export type Pick = { action: string; probs: Record<string, number>; confidence: number | null; tokens: number };

const argmax = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];

export async function ask(state: string, instruction: string, options: Option[]): Promise<Pick> {
  if (options.length === 1) return { action: options[0].id, probs: { [options[0].id]: 1 }, confidence: 1, tokens: 0 };
  const criteria = Object.fromEntries(options.map((o) => [o.id, o.detail]));
  try {
    const r = await evaluate({
      model: 'typesafe-ai/jev',
      state,
      questions: { move: { type: 'choice', instructions: instruction, criteria } },
      maxRetries: 1,
    });
    const probs = r.answers.move.probabilities ?? { [r.answers.move.choice]: 1 };
    const confidence = (r.providerMetadata?.typesafe as { confidence?: Record<string, number> } | undefined)?.confidence?.move ?? null;
    return { action: r.answers.move.choice, probs, confidence, tokens: r.usage.inputTokens ?? estimate(state, criteria) };
  } catch (e) {
    // The SDK rejects an answer whose choice ties the top probability, or whose distribution
    // misses an option. The probabilities are still Jev's, so pick the top one ourselves.
    const p = InvalidResponseDataError.isInstance(e) ? (e.data as { move?: { probabilities?: Record<string, number> } })?.move?.probabilities : undefined;
    if (!p) throw e;
    const probs = Object.fromEntries(options.map((o) => [o.id, Number(p[o.id]) || 0]));
    return { action: argmax(probs), probs, confidence: null, tokens: estimate(state, criteria) };
  }
}

// Used only when the provider did not report usage: about four characters per token.
const estimate = (state: string, criteria: object) => Math.ceil((state.length + JSON.stringify(criteria).length) / 4);
