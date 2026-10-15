"""One bounded review of existing ambiguity; source facts remain authoritative."""
import asyncio
import copy
import json
import time
from .contracts import validate_analysis_result, validate_provider_output
from .extraction import ExtractedDocument, SourcePage
from .grounding import validate_grounding
from .providers.base import ProviderError
from .secret_guard import assert_no_secrets

REVIEW_TIMEOUT_SECONDS = 178
_ERRORS = {'ANALYSIS_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_MODEL_UNAVAILABLE', 'INVALID_PROVIDER_RESPONSE', 'INVALID_REVIEW_SCOPE', 'INVALID_PROVIDER_OUTPUT', 'SECRET_DETECTED', 'BUDGET_EXCEEDED', 'INVALID_ANALYSIS_LEASE', 'BUDGET_RESERVATION_MISMATCH'}


def _values(items):
    # Match complete original value sets, including null/explicit none.
    return {json.dumps(part, ensure_ascii=False, sort_keys=True) for item in items for part in (item['value'] if isinstance(item['value'], list) and item['value'] else [item['value']])}


async def review_ambiguities(output, result, document, reviewer, deadline, secrets=()):
    fields = []
    for field, state in result['fieldStates'].items():
        items = [item for item in output['items'] if item['field'] == field]
        if state != 'unresolved' or not items or not any(item['context'] == 'ambiguous' for item in items) or any(item['context'] not in {'explicit', 'ambiguous'} for item in items):
            continue
        # The second model cannot bypass source uncertainty or structural guards.
        probe = validate_grounding({'items': [{**item, 'context': 'explicit'} for item in items]}, document, 'upstage', result['modelMetadata']['model'], input_format=result['modelMetadata']['inputFormat'])
        if probe['fieldStates'][field] == 'suggested':
            fields.append(field)
    if not fields:
        return result
    fields = fields[:5]
    metadata = {'provider': 'solar', 'model': getattr(reviewer, 'model', 'solar-pro4'), 'status': 'SKIPPED_UNAVAILABLE', 'targetCount': len(fields), 'acceptedCount': 0, 'latencyMs': 0}
    final = copy.deepcopy(result)
    final['modelMetadata']['secondaryReview'] = metadata
    targets = [item for item in output['items'] if item['field'] in fields]
    scope = [{'field': item['field'], 'value': item['value']} for item in targets]
    if len(targets) > 10:
        metadata['status'] = 'SKIPPED_LIMIT'
        return validate_analysis_result(final)
    if reviewer is None or not hasattr(reviewer, 'review'):
        return validate_analysis_result(final)
    available = deadline - time.monotonic() - 1.5
    if available < 5:
        metadata['status'] = 'SKIPPED_TIME'
        return validate_analysis_result(final)
    ranges = sorted({(max(0, e['start'] - 256), min(len(document.text), e['end'] + 256)) for candidate in result['candidates'] if candidate['field'] in fields for e in candidate['evidence'] if 'start' in e and 'end' in e})
    merged_ranges = []
    for start, end in ranges:
        if merged_ranges and start <= merged_ranges[-1][1]:
            merged_ranges[-1] = (merged_ranges[-1][0], max(end, merged_ranges[-1][1]))
        else:
            merged_ranges.append((start, end))
    snippets = '\n\n'.join(document.text[start:end] for start, end in merged_ranges)
    if not snippets or len(snippets) + len(json.dumps(scope, ensure_ascii=False)) > 8000:
        metadata['status'] = 'SKIPPED_LIMIT'
        return validate_analysis_result(final)
    review_document = ExtractedDocument(document.document_id, 'text', snippets, (SourcePage(1, 0, len(snippets)),))
    started = time.monotonic()
    try:
        assert_no_secrets(snippets, secrets)
        async with asyncio.timeout(min(REVIEW_TIMEOUT_SECONDS, available)):
            reviewed = await reviewer.review(review_document, scope, time.monotonic() + min(REVIEW_TIMEOUT_SECONDS, available))
        assert_no_secrets(reviewed, secrets)
        reviewed = validate_provider_output(reviewed)
        if any(item['field'] not in fields for item in reviewed['items']):
            raise ValueError('INVALID_REVIEW_SCOPE')
        revised = copy.deepcopy(output)
        for field in fields:
            original_items = [item for item in output['items'] if item['field'] == field]
            review_items = [item for item in reviewed['items'] if item['field'] == field]
            if not review_items or _values(original_items) != _values(review_items):
                continue
            candidate_output = {'items': [item for item in revised['items'] if item['field'] != field] + review_items}
            grounded = validate_grounding(candidate_output, document, 'upstage', result['modelMetadata']['model'], input_format=result['modelMetadata']['inputFormat'])
            if grounded['fieldStates'][field] != 'suggested':
                continue
            replacement = [candidate for candidate in grounded['candidates'] if candidate['field'] == field]
            original = [candidate for candidate in result['candidates'] if candidate['field'] == field]
            sources = list({json.dumps(e, sort_keys=True): e for candidate in original + replacement for e in candidate['evidence']}.values())
            usages = list({json.dumps(u, sort_keys=True): u for candidate in original + replacement for u in candidate.get('usages', [])}.values())
            if len(replacement) != 1 or len(sources) > 30 or len(usages) > 30:
                continue
            replacement[0]['evidence'] = sources
            if usages:
                replacement[0]['usages'] = usages
            # Preserve original IDs/evidence for every untouched field.
            final['profile'][field] = grounded['profile'][field]
            final['fieldStates'][field] = grounded['fieldStates'][field]
            final['candidates'] = [candidate for candidate in final['candidates'] if candidate['field'] != field] + replacement
            final['questions'] = [question for question in final['questions'] if question['field'] != field]
            revised = candidate_output
            metadata['acceptedCount'] += 1
        metadata['status'] = 'COMPLETED'
    except (TimeoutError, ProviderError, ValueError) as error:
        final = copy.deepcopy(result)
        final['modelMetadata']['secondaryReview'] = metadata
        metadata['acceptedCount'] = 0
        code = error.code if isinstance(error, ProviderError) else 'ANALYSIS_TIMEOUT' if isinstance(error, TimeoutError) else str(error)
        metadata['status'] = 'FAILED'
        metadata['errorCode'] = code if code in _ERRORS else 'REVIEW_FAILED'
    finally:
        metadata['latencyMs'] = round((time.monotonic() - started) * 1000)
    return validate_analysis_result(final)
