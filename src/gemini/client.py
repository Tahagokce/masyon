from google import genai
from google.genai import types

from .prompts import SYSTEM


class GeminiClient:
    def __init__(self, api_key: str, tools: list[dict], state):
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
            timeout=90000, retry_options=types.HttpRetryOptions(attempts=1)))
        self.state = state
        declarations = [types.FunctionDeclaration(name=t["name"], description=t.get("description", ""),
                                                  parameters_json_schema=t["inputSchema"]) for t in tools]
        self.config = types.GenerateContentConfig(
            system_instruction=SYSTEM, temperature=0, max_output_tokens=2048,
            tools=[types.Tool(function_declarations=declarations)],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="ANY")))

    async def request(self, contents):
        self.state.metrics["geminiRequests"] += 1
        response = await self.client.aio.models.generate_content(model="gemini-2.5-flash", contents=contents, config=self.config)
        usage = response.usage_metadata
        if usage:
            for key, field in (("inputTokens", "prompt_token_count"), ("outputTokens", "candidates_token_count"),
                               ("thoughtTokens", "thoughts_token_count")):
                self.state.metrics[key] += getattr(usage, field, 0) or 0
        if not response.candidates or not response.candidates[0].content:
            raise RuntimeError("Gemini returned no executable content")
        return response.candidates[0].content

    async def close(self):
        await self.client.aio.aclose()
        self.client.close()
