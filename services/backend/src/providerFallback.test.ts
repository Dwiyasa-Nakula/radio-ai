import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configuredGroqModels,
  groqReasoningEffort,
  parseOpenAgenticResponse,
} from '../../../src/app/lib/groq';

test('uses currently supported Groq defaults', () => {
  const previousPrimary = process.env.GROQ_MODEL;
  const previousFallback = process.env.GROQ_FALLBACK_MODEL;
  delete process.env.GROQ_MODEL;
  delete process.env.GROQ_FALLBACK_MODEL;
  try {
    assert.deepEqual(configuredGroqModels(), {
      primary: 'qwen/qwen3.6-27b',
      fallback: 'openai/gpt-oss-120b',
    });
  } finally {
    if (previousPrimary === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousPrimary;
    if (previousFallback === undefined) delete process.env.GROQ_FALLBACK_MODEL;
    else process.env.GROQ_FALLBACK_MODEL = previousFallback;
  }
});

test('disables or limits reasoning for speech-generating Groq models', () => {
  assert.equal(groqReasoningEffort('qwen/qwen3.6-27b'), 'none');
  assert.equal(groqReasoningEffort('openai/gpt-oss-120b'), 'low');
  assert.equal(groqReasoningEffort('custom/model'), undefined);
});

test('parses OpenAgentic JSON followed by its done sentinel', () => {
  const response = JSON.stringify({
    choices: [{ message: { content: '  Hello radio  ' } }],
  }) + 'data: [DONE]\n\n';

  assert.equal(parseOpenAgenticResponse(response), 'Hello radio');
});
