import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatterPrompt } from '../../../src/app/lib/groq';

const previousSong = {
  title: 'Previous Title',
  artist: 'Previous Artist',
  sourceNotes: 'PREVIOUS_ONLY_FACT',
};
const nextSong = {
  title: 'Next Title',
  artist: 'Next Artist',
  sourceNotes: 'NEXT_ONLY_FACT',
};

test('separate discussion prompts cannot mix the other song context', () => {
  const previous = buildChatterPrompt({ previousSong, nextSong, discussionFocus: 'previous', language: 'en' });
  assert.match(previous.user, /PREVIOUS_ONLY_FACT/);
  assert.doesNotMatch(previous.user, /NEXT_ONLY_FACT|Next Title|Next Artist/);

  const next = buildChatterPrompt({ previousSong, nextSong, discussionFocus: 'next', language: 'en' });
  assert.match(next.user, /NEXT_ONLY_FACT/);
  assert.doesNotMatch(next.user, /PREVIOUS_ONLY_FACT|Previous Title|Previous Artist/);
});

test('combined transition prompt contains both songs once', () => {
  const combined = buildChatterPrompt({ previousSong, nextSong, discussionFocus: 'transition', language: 'en' });
  assert.match(combined.user, /Previous Title/);
  assert.match(combined.user, /Next Title/);
  assert.match(combined.user, /PREVIOUS_ONLY_FACT/);
  assert.match(combined.user, /NEXT_ONLY_FACT/);
});
