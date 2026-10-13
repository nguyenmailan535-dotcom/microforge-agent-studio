type DeepSeekMessage = { role: "system" | "user" | "assistant"; content: string };

export class LlmConfigurationError extends Error {}
export class LlmOutputLimitError extends Error {}
export class LlmProviderError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "LlmProviderError";
  }
}

export async function callDeepSeek(messages: DeepSeekMessage[], json = false, maxTokens?: number) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new LlmConfigurationError("DEEPSEEK_API_KEY 未配置");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      thinking: { type: "disabled" },
      reasoning_effort: "none",
      temperature: json ? 0.2 : 0.5,
      max_tokens: maxTokens ?? (json ? 3000 : 14000),
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    await response.text();
    if (response.status === 402) {
      throw new LlmProviderError("生成服务余额不足，请联系项目维护者充值或更换 DeepSeek API Key", "LLM_BALANCE_EXHAUSTED", 402);
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmProviderError("生成服务鉴权失败，请联系项目维护者检查 DeepSeek API Key", "LLM_AUTH_FAILED", 503);
    }
    if (response.status === 429) {
      throw new LlmProviderError("生成服务请求过于频繁，请稍后重试", "LLM_RATE_LIMITED", 429);
    }
    throw new LlmProviderError(`DeepSeek 服务请求失败（${response.status}）`, "LLM_PROVIDER_ERROR", 502);
  }
  const payload = await response.json() as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new LlmOutputLimitError("DeepSeek 输出达到长度上限");
  }
  const content = choice?.message?.content?.trim();
  if (!content) {
    const finishReason = choice?.finish_reason || "unknown";
    throw new Error(`DeepSeek 未返回有效内容（finish_reason: ${finishReason}）`);
  }
  return content;
}

export function stripCodeFence(value: string) {
  return value.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();
}
