import { noteModelUsage } from "@/lib/usage";

export type LlmClient = {
  name: "sinox" | "gapgpt" | "avalai";
  baseUrl: string;
  apiKey: string;
  model: string;
};

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export function getAvalaiClient(): LlmClient | null {
  const apiKey = (process.env.AVALAI_API_KEY || "").trim();
  if (!apiKey) return null;
  return {
    name: "avalai",
    baseUrl: "https://api.avalai.ir/v1",
    apiKey,
    model: "gpt-4o-mini",
  };
}

export function getSinoxClient(): LlmClient | null {
  const apiKey = (process.env.SINOX_API_KEY || "").trim();
  if (!apiKey) return null;
  const model = (process.env.SINOX_MODEL || "t-grok-4.5").trim();
  if (!/^t-/.test(model)) return null;
  return {
    name: "sinox",
    baseUrl: trimSlash(
      process.env.SINOX_BASE_URL || "https://sinoxapi.com/v1"
    ),
    apiKey,
    model,
  };
}

export function getGapgptClient(): LlmClient | null {
  const apiKey = (process.env.GAPGPT_API_KEY || "").trim();
  if (!apiKey) return null;
  return {
    name: "gapgpt",
    baseUrl: trimSlash(
      process.env.GAPGPT_BASE_URL || "https://api.gapgpt.app/v1"
    ),
    apiKey,
    model: process.env.GAPGPT_MODEL || "gpt-5.6-luna",
  };
}

export function getTextClient(): LlmClient | null {
  const provider = (process.env.CHAT_PROVIDER || "").trim().toLowerCase();
  if (provider === "sinox") {
    const sinox = getSinoxClient();
    if (sinox) return sinox;
  }
  return getGapgptClient() || getAvalaiClient();
}

export function parseCompletion(data: unknown) {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const choices = Array.isArray(row.choices) ? row.choices : [];
  const first = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as Record<string, unknown>)
    : {};
  const message =
    first.message && typeof first.message === "object"
      ? (first.message as Record<string, unknown>)
      : {};
  const content = typeof message.content === "string" ? message.content.trim() : "";
  const finishReason =
    typeof first.finish_reason === "string" ? first.finish_reason : "";
  const err =
    row.error && typeof row.error === "object"
      ? (row.error as Record<string, unknown>)
      : {};
  const errorText =
    typeof err.message === "string" ? err.message.trim() : "";
  return {
    text: content,
    error: errorText,
    finishReason,
  };
}

export function tokenLimitFields(model: string, n?: number) {
  if (!n) return {};
  if (/gpt-5|^o[0-9]|luna|gpt-4\.1/i.test(model)) {
    return { max_completion_tokens: n };
  }
  return { max_tokens: n };
}

export function isModelErrorText(text: string) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/max_tokens|max_completion_tokens|not supported/i.test(t)) return true;
  if (/invalid_request_error|no available channel/i.test(t) && t.length < 1500) {
    return true;
  }
  if (/^\{\s*"error"/.test(t)) return true;
  return false;
}

export function completionText(data: unknown) {
  return parseCompletion(data).text;
}

export async function chatCompletions(
  client: LlmClient,
  body: {
    messages: unknown[];
    temperature?: number;
    max_tokens?: number;
  },
  extra?: { timeoutMs?: number }
) {
  console.log("CHAT_PROVIDER", client.name, client.model);
  const response = await fetch(client.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + client.apiKey,
    },
    body: JSON.stringify({
      model: client.model,
      temperature: body.temperature,
      ...tokenLimitFields(client.model, body.max_tokens),
      messages: body.messages,
    }),
    signal: extra?.timeoutMs
      ? AbortSignal.timeout(extra.timeoutMs)
      : undefined,
  });
  const data = await response.json().catch(() => ({}));
  noteModelUsage(data, client.model);
  return data;
}

function deltaContent(data: unknown) {
  const row =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const choices = Array.isArray(row.choices) ? row.choices : [];
  const first =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : {};
  const delta =
    first.delta && typeof first.delta === "object"
      ? (first.delta as Record<string, unknown>)
      : {};
  if (typeof delta.content === "string") return delta.content;
  const message =
    first.message && typeof first.message === "object"
      ? (first.message as Record<string, unknown>)
      : {};
  return typeof message.content === "string" ? message.content : "";
}


export function hasReplacementChar(text: string) {
  return /\uFFFD/.test(String(text || ""));
}

/** Chunk by Unicode code points so surrogate pairs / Persian stay intact. */
export async function emitTextLive(
  text: string,
  onDelta: (chunk: string) => void
) {
  const value = String(text || "");
  if (!value) return;
  const chars = Array.from(value);
  const step = Math.max(4, Math.min(14, Math.ceil(chars.length / 48)));
  for (let i = 0; i < chars.length; i += step) {
    onDelta(chars.slice(i, i + step).join(""));
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}



export async function readSseCompletion(
  response: Response,
  model: string,
  onDelta?: (chunk: string) => void
) {
  if (!response.body) return { text: "", streamed: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let streamed = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as unknown;
        noteModelUsage(json, model);
        const piece = deltaContent(json);
        if (piece) {
          streamed = true;
          text += piece;
          onDelta?.(piece);
        }
      } catch {
        /* keep reading */
      }
    }
  }
  return { text, streamed };
}

export async function chatCompletionsStream(
  client: LlmClient,
  body: {
    messages: unknown[];
    temperature?: number;
    max_tokens?: number;
  },
  extra?: { timeoutMs?: number; onDelta?: (chunk: string) => void }
) {
  console.log("CHAT_PROVIDER", client.name, client.model);
  const response = await fetch(client.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + client.apiKey,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: client.model,
      stream: true,
      temperature: body.temperature,
      ...tokenLimitFields(client.model, body.max_tokens),
      messages: body.messages,
    }),
    signal: extra?.timeoutMs
      ? AbortSignal.timeout(extra.timeoutMs)
      : undefined,
  });
  const ctype = response.headers.get("content-type") || "";
  if (response.status !== 200) {
    return { text: "", streamed: false };
  }
  if (ctype.includes("application/json") && !ctype.includes("event-stream")) {
    const data = await response.json().catch(() => ({}));
    noteModelUsage(data, client.model);
    const text = completionText(data);
    return { text, streamed: false };
  }
  return readSseCompletion(response, client.model, extra?.onDelta);
}

