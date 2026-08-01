// src/app/lib/tts.ts
import fs from 'fs';
import path from 'path';
import type { AnnouncerLanguage } from './types';

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: 'gemini-tts' | 'style-bert-vits2' | 'anyvoicelab';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// Gemini daily limit file tracking removed

export async function synthesize(
  text: string,
  kind?: 'chatter' | 'news' | 'weather' | 'traffic' | 'jingle',
  signal?: AbortSignal,
  language: AnnouncerLanguage = 'ja'
): Promise<TtsResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    // 1. Try Gemini 3.1 Flash TTS
    try {
      return await synthesizeGeminiTts(text, 'gemini-3.1-flash-tts-preview', apiKey, kind, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn('[tts] Gemini 3.1 Flash TTS failed, trying 2.5:', err);
    }

    // 2. Try Gemini 2.5 Flash TTS
    try {
      return await synthesizeGeminiTts(text, 'gemini-2.5-flash-preview-tts', apiKey, kind, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn('[tts] Gemini 2.5 Flash TTS failed, falling back:', err);
    }
  }

  // 2.5. Try OpenRouter.ai fallback (Gemini 3.1 Flash TTS Preview)
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (openRouterApiKey) {
    try {
      return await synthesizeOpenRouterTts(text, kind, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn('[tts] OpenRouter Gemini 3.1 Flash TTS failed, falling back:', err);
    }
  }

  // 3. Fall back to Style-Bert-VITS2
  const sbv2Url = process.env.STYLE_BERT_VITS2_URL;
  if (sbv2Url) {
    try {
      return await synthesizeStyleBertVits2(text, sbv2Url, language, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn('[tts] Style-Bert-VITS2 failed, falling back:', err);
    }
  }

  // 4. Fall back to AnyVoiceLab
  return synthesizeAnyVoiceLab(text, language, signal);
}

/** Sponsor credits intentionally use AnyVoiceLab without provider fallbacks. */
export async function synthesizeAnyVoice(
  text: string,
  language: AnnouncerLanguage = 'ja',
  signal?: AbortSignal
): Promise<TtsResult> {
  return synthesizeAnyVoiceLab(text, language, signal);
}


async function synthesizeStyleBertVits2(
  text: string,
  baseUrl: string,
  announcerLanguage: AnnouncerLanguage,
  signal?: AbortSignal
): Promise<TtsResult> {
  const speakerId = process.env.STYLE_BERT_VITS2_SPEAKER_ID ?? '0';
  const modelId = process.env.STYLE_BERT_VITS2_MODEL_ID ?? '0';
  const language = announcerLanguage === 'en'
    ? process.env.STYLE_BERT_VITS2_LANGUAGE_EN ?? 'EN'
    : process.env.STYLE_BERT_VITS2_LANGUAGE ?? 'JP';

  const url = new URL('/voice', baseUrl);
  url.searchParams.set('text', text);
  url.searchParams.set('speaker_id', speakerId);
  url.searchParams.set('model_id', modelId);
  url.searchParams.set('language', language);

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SBV2 ${res.status}: ${body.slice(0, 200)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') ?? 'audio/wav',
    provider: 'style-bert-vits2',
  };
}

async function synthesizeOpenRouterTts(
  text: string,
  kind?: string,
  signal?: AbortSignal
): Promise<TtsResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  let voiceName = process.env.GEMINI_VOICE_NAME ?? 'Laomedeia';
  if (kind === 'chatter' && process.env.GEMINI_VOICE_CHATTER) {
    voiceName = process.env.GEMINI_VOICE_CHATTER;
  } else if (kind === 'news' && process.env.GEMINI_VOICE_NEWS) {
    voiceName = process.env.GEMINI_VOICE_NEWS;
  } else if (kind === 'weather' && process.env.GEMINI_VOICE_WEATHER) {
    voiceName = process.env.GEMINI_VOICE_WEATHER;
  } else if (kind === 'traffic' && process.env.GEMINI_VOICE_TRAFFIC) {
    voiceName = process.env.GEMINI_VOICE_TRAFFIC;
  } else if (!process.env.GEMINI_VOICE_NAME) {
    if (kind === 'news') voiceName = 'Erinome';
    else if (kind === 'weather') voiceName = 'Aoede';
    else if (kind === 'traffic') voiceName = 'Pulcherrima';
  }

  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3.1-flash-tts-preview',
      input: text,
      voice: voiceName,
      response_format: 'pcm',
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter TTS ${res.status}: ${body.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const pcmBuffer = Buffer.from(new Uint8Array(arrayBuffer));
  const wavBuffer = writeWavHeader(pcmBuffer, 24000, 1, 16);

  return {
    audio: wavBuffer,
    contentType: 'audio/wav',
    provider: 'gemini-tts', // Mark as gemini-tts so the client shows the correct indicator
  };
}

const ANYVOICE_MAX_CHUNK_CHARACTERS = 280;

function splitTextForAnyVoice(text: string): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [text];

  const sentenceUnits = normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu) ?? [normalized];
  const boundedUnits: string[] = [];

  for (const rawUnit of sentenceUnits) {
    let remaining = Array.from(rawUnit.trim());
    while (remaining.length > ANYVOICE_MAX_CHUNK_CHARACTERS) {
      const window = remaining.slice(0, ANYVOICE_MAX_CHUNK_CHARACTERS);
      let breakAt = -1;
      for (let index = window.length - 1; index >= Math.floor(ANYVOICE_MAX_CHUNK_CHARACTERS / 2); index -= 1) {
        if (/\s/u.test(window[index])) {
          breakAt = index;
          break;
        }
      }
      const piece = window.slice(0, breakAt >= 0 ? breakAt : window.length).join('').trim();
      if (piece) boundedUnits.push(piece);
      remaining = remaining.slice(breakAt >= 0 ? breakAt + 1 : window.length);
    }
    const tail = remaining.join('').trim();
    if (tail) boundedUnits.push(tail);
  }

  const chunks: string[] = [];
  let current = '';
  for (const unit of boundedUnits) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (Array.from(candidate).length <= ANYVOICE_MAX_CHUNK_CHARACTERS) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [normalized];
}
async function synthesizeAnyVoiceLab(
  text: string,
  announcerLanguage: AnnouncerLanguage,
  signal?: AbortSignal
): Promise<TtsResult> {
  const isEnglish = announcerLanguage === 'en';
  const nonce = isEnglish
    ? process.env.ANYVOICELAB_NONCE_EN ?? process.env.ANYVOICELAB_NONCE
    : process.env.ANYVOICELAB_NONCE;
  const cookie = process.env.ANYVOICELAB_COOKIE;
  if (!nonce || !cookie) {
    throw new Error('ANYVOICELAB_NONCE or ANYVOICELAB_COOKIE is not set');
  }

  const voiceId = isEnglish
    ? process.env.ANYVOICELAB_VOICE_ID_EN ?? '656224'
    : process.env.ANYVOICELAB_VOICE_ID ?? '656306';
  const language = isEnglish
    ? process.env.ANYVOICELAB_LANGUAGE_EN ?? 'en'
    : process.env.ANYVOICELAB_LANGUAGE ?? 'ja';

  const form = new FormData();
  form.set('action', 'tts_voice_chunk_batch_convert');
  form.set('tts_voice_nonce', nonce);
  form.set('tts_voice_id', voiceId);
  form.set('voice_to_clone_file', 'null');
  form.set('voice_index', '0');
  form.set('language', language);
  form.set('cursor', '0');

  // AnyVoice rejects oversized individual chunks even when the batch total is valid.
  // Pack English and Japanese sentences while enforcing a hard provider-safe ceiling.
  const chunks = splitTextForAnyVoice(text);
  for (const chunk of chunks) {
    form.append('chunks[]', chunk);
  }

  const res = await fetch('https://anyvoicelab.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Origin: 'https://anyvoicelab.com',
      Referer: 'https://anyvoicelab.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
      Cookie: cookie,
      DNT: '1',
    },
    body: form,
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AnyVoiceLab ${res.status}: ${body.slice(0, 200)}`);
  }

  const ct = res.headers.get('content-type') ?? '';

  if (ct.startsWith('audio/')) {
    const ab = await res.arrayBuffer();
    return { audio: Buffer.from(ab), contentType: ct, provider: 'anyvoicelab' };
  }

  const data = await res.json();
  if (!data || data.success === false) {
    throw new Error(`AnyVoiceLab returned: ${JSON.stringify(data).slice(0, 300)}`);
  }

  // Handle direct base64 audio response (batch convert format) - Concatenate all chunk buffers
  const audios = data?.data?.audios ?? data?.audios;
  if (Array.isArray(audios) && audios.length > 0) {
    const buffers = audios
      .filter((a): a is string => typeof a === 'string')
      .map((base64) => Buffer.from(base64, 'base64'));
    if (buffers.length > 0) {
      return {
        audio: Buffer.concat(buffers),
        contentType: 'audio/mpeg',
        provider: 'anyvoicelab',
      };
    }
  }

  // Fallback to legacy URL response
  const audioUrl =
    data?.data?.audio_url ?? data?.data?.url ?? data?.audio_url ?? data?.url;
  if (typeof audioUrl !== 'string') {
    throw new Error(`AnyVoiceLab response did not contain an audio URL or base64 data: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const audioRes = await fetch(audioUrl, { signal });
  if (!audioRes.ok) {
    throw new Error(`AnyVoiceLab audio fetch ${audioRes.status}`);
  }
  const ab = await audioRes.arrayBuffer();
  return {
    audio: Buffer.from(ab),
    contentType: audioRes.headers.get('content-type') ?? 'audio/mpeg',
    provider: 'anyvoicelab',
  };
}

async function synthesizeGeminiTts(
  text: string,
  modelName: string,
  apiKey: string,
  kind?: string,
  signal?: AbortSignal
): Promise<TtsResult> {
  let voiceName = process.env.GEMINI_VOICE_NAME ?? 'Laomedeia';
  if (kind === 'chatter' && process.env.GEMINI_VOICE_CHATTER) {
    voiceName = process.env.GEMINI_VOICE_CHATTER;
  } else if (kind === 'news' && process.env.GEMINI_VOICE_NEWS) {
    voiceName = process.env.GEMINI_VOICE_NEWS;
  } else if (kind === 'weather' && process.env.GEMINI_VOICE_WEATHER) {
    voiceName = process.env.GEMINI_VOICE_WEATHER;
  } else if (kind === 'traffic' && process.env.GEMINI_VOICE_TRAFFIC) {
    voiceName = process.env.GEMINI_VOICE_TRAFFIC;
  } else if (!process.env.GEMINI_VOICE_NAME) {
    // Default gender/voice variety mapping
    if (kind === 'news') voiceName = 'Erinome';
    else if (kind === 'weather') voiceName = 'Aoede';
    else if (kind === 'traffic') voiceName = 'Pulcherrima';
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini TTS ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData || !inlineData.data) {
    throw new Error(`Gemini response did not contain audio data: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const base64Data = inlineData.data;
  const pcmBuffer = Buffer.from(base64Data, 'base64');

  // Gemini returns raw 24kHz 16-bit mono PCM. We prepend a 44-byte WAV header so it is playable by HTML5 Audio.
  const wavBuffer = writeWavHeader(pcmBuffer, 24000, 1, 16);

  return {
    audio: wavBuffer,
    contentType: 'audio/wav',
    provider: 'gemini-tts',
  };
}

function writeWavHeader(
  pcmBuffer: Buffer,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}
