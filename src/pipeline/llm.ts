export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LlmBatchItem {
  id: string;
  input: string;
}

export interface LlmBatchOutput {
  id: string;
  output: string;
}

export function loadLlmConfig(): LlmConfig | null {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !model || !apiKey) {
    return null;
  }
  return {
    provider: process.env.LLM_PROVIDER ?? "openai-compatible",
    baseUrl,
    model,
    apiKey,
  };
}

export async function runStructuredBatch(
  config: LlmConfig,
  systemPrompt: string,
  userPrompt: string,
  items: LlmBatchItem[],
): Promise<LlmBatchOutput[]> {
  const payload = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: [
          systemPrompt.trim(),
          "Return strict JSON only.",
          "Return shape: {\"items\":[{\"id\":\"...\",\"output\":\"...\"}]}",
        ].join("\n\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt: userPrompt,
          items,
        }),
      },
    ],
    temperature: 0,
    response_format: {
      type: "json_object",
    },
  };

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`llm request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("llm response missing message content");
  }
  return validateBatchOutput(content, items);
}

function validateBatchOutput(content: string, items: LlmBatchItem[]): LlmBatchOutput[] {
  const parsed = JSON.parse(stripCodeFence(content)) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    throw new Error("llm response must contain items array");
  }
  const expected = new Set(items.map((item) => item.id));
  const seen = new Set<string>();
  const results: LlmBatchOutput[] = [];

  for (const item of parsed.items) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.output !== "string") {
      throw new Error("llm response item has invalid shape");
    }
    if (!expected.has(item.id)) {
      throw new Error(`llm response contains unknown id: ${item.id}`);
    }
    if (seen.has(item.id)) {
      throw new Error(`llm response contains duplicate id: ${item.id}`);
    }
    seen.add(item.id);
    const normalizedOutput = item.output.trim();
    if (!normalizedOutput) {
      throw new Error(`llm response item has empty output: ${item.id}`);
    }
    results.push({
      id: item.id,
      output: normalizedOutput,
    });
  }

  if (seen.size !== expected.size) {
    throw new Error("llm response missing ids");
  }

  return results;
}

function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}
