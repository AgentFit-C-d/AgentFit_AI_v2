import hashlib
import json
import math
import re


def load_gold(path):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("frozenBeforeProviderCalls") is not True:
        raise ValueError("GOLD_NOT_FROZEN")
    cases, seen = [], set()
    for entry in manifest["cases"]:
        target = (path.parent / entry["path"]).resolve()
        if not target.is_relative_to(path.parent.resolve()):
            raise ValueError("INVALID_GOLD_PATH")
        raw = target.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("GOLD_HASH_MISMATCH")
        case = json.loads(raw)
        if case["caseId"] != entry["caseId"] or case["caseId"] in seen:
            raise ValueError("DUPLICATE_GOLD_CASE")
        seen.add(case["caseId"])
        cases.append({**case, "group": entry["group"]})
    if not cases:
        raise ValueError("MISSING_GOLD")
    return cases


def score_case(case, result):
    expected, actual = case["expected"], result["profile"]
    if set(actual) != set(expected):
        raise ValueError("UNSCORABLE_RESULT")
    def equal(left, right):
        return sorted(left) == sorted(right) if isinstance(left, list) and isinstance(right, list) else left == right
    relevant = [field for field in expected if expected[field] is not None or actual[field] is not None]
    if not relevant:
        relevant = list(expected)
    fact_score = sum(equal(expected[field], actual[field]) for field in relevant) / len(relevant)
    grounded, proposed = 0, 0
    for field, value in actual.items():
        if value is None:
            continue
        proposed += 1
        for candidate in result["candidates"]:
            if candidate.get("status") != "suggested" or candidate.get("field") != field or not equal(candidate.get("proposedValue"), value):
                continue
            for span in candidate.get("evidence", []):
                start, end = span.get("start"), span.get("end")
                if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= len(case["text"]):
                    continue
                quote = case["text"][start:end].casefold()
                values = value if isinstance(value, list) else [value]
                valid = all(item.casefold() in quote for item in values)
                if value == []:
                    valid = bool(re.search(r"없|none|사용 안|연동 안|not required", quote))
                if valid:
                    grounded += 1
                    break
            else:
                continue
            break
    return {"factScore": fact_score, "incorrectFields": [field for field in expected if not equal(expected[field], actual[field])], "groundingScore": grounded / proposed if proposed else 1,
            "unknownInfraCorrect": all(actual[field] is None for field in ("database", "deployment") if expected[field] is None)}


def summarize(cases, records):
    ids = {case["caseId"] for case in cases}
    if len(ids) != len(cases):
        raise ValueError("DUPLICATE_GOLD_CASE")
    first, duplicates = {}, 0
    for record in records:
        if record["caseId"] not in ids:
            raise ValueError("UNKNOWN_GOLD_CASE")
        if record.get("attempt") != 1:
            continue
        if record["caseId"] in first:
            duplicates += 1
            continue
        if record["firstAttemptStatus"] == "SUCCEEDED" and any(not isinstance(record.get(key), (float, int)) or not 0 <= record[key] <= 1 for key in ("factScore", "groundingScore")):
            raise ValueError("UNSCORABLE_RESULT")
        first[record["caseId"]] = record
    if set(first) != ids:
        raise ValueError("MISSING_GOLD_RESULT")
    success = [row for row in first.values() if row["firstAttemptStatus"] == "SUCCEEDED"]
    attempted = [row for row in first.values() if row["firstAttemptStatus"] != "NOT_RUN"]
    latencies = sorted(row["latencyMs"] for row in attempted)
    normal = [first[case["caseId"]] for case in cases if case["group"] == "normal"]
    groups = {}
    for group in sorted({case['group'] for case in cases}):
        rows = [first[case['caseId']] for case in cases if case['group'] == group]
        successful = [row for row in rows if row['firstAttemptStatus'] == 'SUCCEEDED']
        groups[group] = {'distinctCases': len(rows), 'firstSuccessCount': len(successful),
                         'factMeanIncludingFailures': sum(row['factScore'] for row in successful) / len(rows),
                         'exactCorrectCount': sum(row['factScore'] == 1 and row['groundingScore'] == 1 and row['unknownInfraCorrect'] for row in successful)}
    return {"distinctCases": len(ids), "attemptedCases": len(attempted), "duplicatesIgnored": duplicates,
            "groups": groups,
            "firstSuccessCount": len(success), "factMean": sum(row["factScore"] for row in success) / len(success) if success else None,
            "groundingMean": sum(row["groundingScore"] for row in success) / len(success) if success else None,
            "unknownInfraAllCorrect": bool(success) and all(row["unknownInfraCorrect"] for row in success),
            "p95LatencyMs": latencies[math.ceil(len(latencies) * 0.95) - 1] if latencies else None,
            "normalAcceptance": len(normal) == 30 and sum(row["firstAttemptStatus"] == "SUCCEEDED" and row['factScore'] == 1 and row['groundingScore'] == 1 and row['unknownInfraCorrect'] for row in normal) >= 29 and all(row["firstAttemptStatus"] in {"SUCCEEDED", "FAILED", "CANCELLED"} and row["latencyMs"] <= 60000 for row in normal)}
