import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredOpenAgenticModel } from '../../../src/app/lib/groq';
import { configuredOpenRouterTtsModel } from '../../../src/app/lib/tts';

test('provider model environment values control their fallbacks', () => {
  const originalOpenAgentic = process.env.OPENAGENTIC_MODEL;
  const originalOpenRouter = process.env.OPENROUTER_TTS_MODEL;
  try {
    process.env.OPENAGENTIC_MODEL = 'custom/openagentic-model';
    process.env.OPENROUTER_TTS_MODEL = 'custom/openrouter-tts';
    assert.equal(configuredOpenAgenticModel(), 'custom/openagentic-model');
    assert.equal(configuredOpenRouterTtsModel(), 'custom/openrouter-tts');

    process.env.OPENAGENTIC_MODEL = '   ';
    process.env.OPENROUTER_TTS_MODEL = '';
    assert.equal(configuredOpenAgenticModel(), 'claude-sonnet-4.5-thinking');
    assert.equal(configuredOpenRouterTtsModel(), 'google/gemini-3.1-flash-tts-preview');
  } finally {
    if (originalOpenAgentic === undefined) delete process.env.OPENAGENTIC_MODEL;
    else process.env.OPENAGENTIC_MODEL = originalOpenAgentic;
    if (originalOpenRouter === undefined) delete process.env.OPENROUTER_TTS_MODEL;
    else process.env.OPENROUTER_TTS_MODEL = originalOpenRouter;
  }
});
