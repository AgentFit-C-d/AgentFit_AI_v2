"""Real providers run through authenticated API/worker/budget, never directly."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time
import httpx

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / 'apps/ai'))
from evaluations.report import load_gold, score_case, summarize
from evaluations.inputs import load_input_plan, prepare_input


async def evaluate(provider, manifest_path, limit, output_path, input_mode='text', case_id=None):
    all_cases = load_gold(manifest_path)
    input_plan = load_input_plan(manifest_path.parent / 'input-plan.json', all_cases) if input_mode == 'mixed' else {}
    cases = [case for case in all_cases if case['caseId'] == case_id] if case_id else all_cases[:limit]
    if not cases:
        raise ValueError("MISSING_GOLD")
    origin = os.environ.get("EVALUATION_ORIGIN", "")
    cookie = os.environ.get("EVALUATION_COOKIE", "")
    if origin != "http://localhost:3000" or not cookie:
        raise ValueError("LOCAL_EVALUATION_SESSION_REQUIRED")
    records, stopped = [], None
    async with httpx.AsyncClient(base_url=origin, headers={"Cookie": cookie, "Origin": origin}, timeout=15, trust_env=False, follow_redirects=False) as client:
        for case in cases:
            kind = input_plan.get(case['caseId'], 'text')
            record = {"caseId": case["caseId"], "inputKind": kind, "attempt": 1, "provider": provider, "firstAttemptStatus": "NOT_RUN", "latencyMs": 0,
                      "factScore": None, "groundingScore": None, "unknownInfraCorrect": None, "costReservationMicroUsd": None}
            if stopped:
                record["errorCode"] = stopped
                records.append(record)
                continue
            start = time.monotonic()
            try:
                response = await client.post("/api/projects", json={"name": f"Evaluation {case['caseId']}"})
                response.raise_for_status()
                project_id = response.json()["id"]
                record["projectId"] = project_id
                data, extracted = prepare_input(case, kind)
                score_source = {**case, 'text': extracted.text}
                input_value = {'kind': 'text', 'text': case['text']}
                if kind != 'text':
                    content_type = 'application/pdf' if kind == 'pdf' else 'text/markdown'
                    response = await client.post(f'/api/projects/{project_id}/uploads', json={'kind': kind, 'size': len(data), 'contentType': content_type})
                    response.raise_for_status()
                    grant = response.json()
                    if grant['storage'] != 'local' or not grant['uploadUrl'].startswith(f'/api/projects/{project_id}/uploads/'):
                        raise ValueError('INVALID_EVALUATION_UPLOAD')
                    response = await client.put(grant['uploadUrl'], content=data, headers={'Content-Type': content_type})
                    response.raise_for_status()
                    input_value = {'kind': 'upload', 'uploadId': grant['uploadId']}
                start = time.monotonic()
                response = await client.post(f"/api/projects/{project_id}/analysis", json={"provider": provider, "input": input_value})
                response.raise_for_status()
                attempt_id = response.json()["id"]
                record["attemptId"] = attempt_id
                while time.monotonic() - start < 185:
                    response = await client.get(f"/api/projects/{project_id}/analysis/{attempt_id}")
                    response.raise_for_status()
                    attempt = response.json()
                    if attempt["status"] not in {"QUEUED", "PROCESSING"}:
                        record["firstAttemptStatus"] = attempt["status"]
                        if attempt["status"] == "SUCCEEDED":
                            response = await client.get(f"/api/projects/{project_id}")
                            response.raise_for_status()
                            result = response.json()["draft"]["result"]
                            record.update(score_case(score_source, result))
                            record['reviewShape'] = [{ 'field': field, 'state': result['fieldStates'][field], 'candidateStatuses': [c['status'] for c in result['candidates'] if c['field'] == field], 'candidateValueKinds': ['explicit-none' if c['proposedValue'] == [] else 'null' if c['proposedValue'] is None else 'value' for c in result['candidates'] if c['field'] == field] } for field in record.get('incorrectFields', [])]
                            record.update({"model": result["modelMetadata"]["model"], "schemaVersion": result["schemaVersion"], "promptVersion": result["modelMetadata"]["promptVersion"]})
                        else:
                            record["errorCode"] = attempt.get("errorCode", "ANALYSIS_FAILED")
                        break
                    await asyncio.sleep(0.5)
                else:
                    record.update(firstAttemptStatus="FAILED", errorCode="EVALUATION_TIMEOUT")
                    await client.post(f"/api/projects/{project_id}/analysis/{attempt_id}/cancel")
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                record.update(firstAttemptStatus="FAILED", errorCode="EVALUATION_UNAVAILABLE")
            record["latencyMs"] = round((time.monotonic() - start) * 1000)
            if record.get("errorCode") in {"PROVIDER_BAD_REQUEST", "PROVIDER_MODEL_UNAVAILABLE", "PROVIDER_AUTH_FAILED", "PROVIDER_BUDGET_EXHAUSTED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "BUDGET_EXCEEDED", "PRICE_NOT_CONFIRMED", "EVALUATION_UNAVAILABLE"}:
                stopped = record["errorCode"]
            records.append(record)
            print(json.dumps({"caseId": record["caseId"], "status": record["firstAttemptStatus"], "latencyMs": record["latencyMs"], "errorCode": record.get("errorCode")} ), flush=True)
    report = {"source": "REAL_PROVIDER_VIA_API", "inputMode": input_mode, "provider": provider, "records": records, "summary": summarize(cases, records)}
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["upstage", "solar"], required=True)
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument('--input-mode', choices=['text', 'mixed'], default='text')
    parser.add_argument('--case-id')
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if not 1 <= arguments.limit <= 51 or not arguments.output.resolve().is_relative_to((root / "work/harness/mvp-implementation").resolve()):
        raise ValueError("INVALID_EVALUATION_SCOPE")
    asyncio.run(evaluate(arguments.provider, root / "evaluations/gold/manifest.json", arguments.limit, arguments.output, arguments.input_mode, arguments.case_id))
