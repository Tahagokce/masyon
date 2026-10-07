import asyncio
import json
from dataclasses import asdict

from google.genai import types


async def run_step(step, ai, browser, state, config, secrets, log):
    payload = {"currentStep": asdict(step), "generatedValues": state.generated_values,
               "previousState": state.summary, "pages": state.pages,
               "baseUrl": config.base_url, "credentialNames": config.secret_names}
    initial = types.Content(role="user", parts=[types.Part(text=json.dumps(secrets.object(payload)))])
    exchanges = []
    evidence, actions, errors = {}, 0, False
    latest_mutation = 0
    sequence = 0
    calls = 0

    def failed(status, reason):
        return {"stepNumber": step.stepNumber, "status": status, "reason": reason,
                "verification": "", "evidence": list(evidence.values())}

    async def loop():
        nonlocal exchanges, calls, sequence, actions, errors, latest_mutation
        while calls < config.max_step_calls:
            # Complete request/response pairs preserve Gemini thought signatures.
            # Older exchanges are dropped; only IDs, generated values and summary survive.
            context = types.Content(role="user", parts=[types.Part(text=json.dumps({
                "generatedValues": state.generated_values, "pages": state.pages,
                "verificationEvidence": list(evidence.values())[-8:]}))])
            recent = exchanges[-4:]
            while len(recent) > 1 and sum(len(item.model_dump_json()) for pair in recent for item in pair) > 20000:
                recent = recent[1:]
            content = await ai.request([initial, context, *[item for pair in recent for item in pair]])
            functions = [part.function_call for part in content.parts or [] if part.function_call]
            if not functions:
                return failed("BLOCKED", "Gemini returned no tool calls")
            replies = []
            for function in functions:
                calls += 1
                if calls > config.max_step_calls:
                    return failed("BLOCKED", "Step tool-call limit reached")
                name, args = function.name, dict(function.args or {})
                if len(json.dumps(args)) > 8000:
                    return failed("BLOCKED", "Model tool arguments exceeded the context budget")
                if name == "finish_step":
                    status = args.get("status")
                    ids = args.get("evidenceIds", [])
                    valid_ids = isinstance(ids, list) and all(isinstance(i, str) and i in evidence for i in ids)
                    fresh = valid_ids and bool(ids) and all(evidence[i]["sequence"] >= latest_mutation for i in ids)
                    valid = status in {"COMPLETED", "FAILED", "BLOCKED"} and bool(args.get("reason"))
                    if status == "COMPLETED":
                        valid = valid and len(functions) == 1 and actions > 0 and not errors
                        if step.expectedResult:
                            valid = valid and fresh and bool(args.get("verification"))
                    if not valid:
                        result = {"isError": True, "reason": "Completion rejected: need successful operations and fresh expected-result assertion evidence; finish alone."}
                    else:
                        state.summary = secrets.clean(str(args.get("stateSummary", "")))[:1200]
                        return secrets.object({"stepNumber": step.stepNumber, "status": status,
                            "reason": str(args["reason"])[:2000], "verification": str(args.get("verification", ""))[:2000],
                            "evidence": [evidence[i] for i in ids] if valid_ids else []})
                elif name == "generate_value":
                    try:
                        if secrets.contains(json.dumps(args)):
                            raise ValueError("Credentials cannot be registered as generated values")
                        value = state.generate(args.get("name", ""), args.get("prefix", "AUTO"), args.get("value"))
                        result = {"value": value}
                        log(f"[AI] Generated/reused value: {value}")
                    except ValueError as exc:
                        result = {"isError": True, "reason": str(exc)}
                elif name in {t["name"] for t in browser.tools if not t["name"].startswith("poc_")}:
                    sequence += 1
                    state.metrics["browserToolCalls"] += 1
                    log(f"[AI] Requested tool: {name}")
                    result = await browser.call(name, args)
                    state.pages = result.get("pages", state.pages)
                    if result.get("mutating"):
                        latest_mutation = sequence
                    if result.get("isError"):
                        errors = True
                        # A failed assertion is a failed expected result; never "recover" by
                        # asserting a different, easier condition and claiming success.
                        log(f"[MCP] {name} failed")
                        return failed("FAILED", f"Browser tool failed: {name}; {result.get('error', 'operation did not succeed')}")
                    actions += int(bool(result.get("executed")))
                    if result.get("evidenceId"):
                        item = {"id": result["evidenceId"], "sequence": sequence,
                                "assertion": result.get("assertion"), "page": result.get("activePage")}
                        evidence[item["id"]] = item
                        log(f"[VERIFY] Browser assertion passed ({item['id']})")
                    log(f"[MCP] {name} successful")
                    result = {k: v for k, v in result.items() if k not in {"code", "recording"}}
                else:
                    result = {"isError": True, "reason": "Tool is not available"}
                result = secrets.object(result)
                replies.append(types.Part(function_response=types.FunctionResponse(name=name, id=function.id, response=result)))
            exchanges.append((content, types.Content(role="user", parts=replies)))
            if sum(len(item.model_dump_json()) for item in exchanges[-1]) > 30000:
                return failed("BLOCKED", "Tool batch exceeded the context budget; no success inferred")
        return failed("BLOCKED", "Step tool-call limit reached")

    try:
        async with asyncio.timeout(config.step_timeout):
            return await loop()
    except TimeoutError:
        return failed("BLOCKED", "Step deadline exceeded; browser outcome may be uncertain")
