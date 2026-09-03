import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@google-cloud/storage';
import { buildSponsorScript, sanitizeSponsorBrand } from '../../../src/app/lib/segments/sponsor';
import { synthesizeAnyVoice } from '../../../src/app/lib/tts';

const CREDIT_VERSION = 'v1';
const CREDIT_LANGUAGE = 'ja';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MAX_MEMORY_ENTRIES = 64;

const PACKAGED_BRANDS: Array<{ key: string; aliases: string[] }> = [
  { key: 'toyota', aliases: ['toyota', 'toyota to you'] },
  { key: 'honda', aliases: ['honda', 'hondajet'] },
  { key: 'suzuki', aliases: ['suzuki', 'suzuki jimny'] },
  { key: 'mazda', aliases: ['mazda'] },
];

export interface SponsorCredit {
  audio: Buffer;
  contentType: string;
  key: string;
  source: 'packaged' | 'gcs' | 'generated';
  brand: string;
  cacheControl: string;
}

interface CachedCredit extends SponsorCredit {
  signature?: string;
}

function normalizedBrand(value: string): string {
  return sanitizeSponsorBrand(value).toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function packagedBrandKey(brand: string): string | undefined {
  const normalized = normalizedBrand(brand);
  return PACKAGED_BRANDS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))?.key;
}

export function sponsorCreditKey(brand: string): string {
  return createHash('sha256')
    .update(`${CREDIT_VERSION}\0${CREDIT_LANGUAGE}\0${normalizedBrand(brand)}`)
    .digest('hex');
}

export function packagedSponsorBrand(brand: string): string | undefined {
  return packagedBrandKey(brand);
}

export class SponsorCreditStore {
  private readonly storage: Storage | undefined;
  private readonly bucketName: string | undefined;
  private readonly rootDirectory: string;
  private readonly memory = new Map<string, CachedCredit>();
  private readonly inflight = new Map<string, Promise<SponsorCredit>>();

  constructor(rootDirectory = process.cwd(), bucketName = process.env.SPONSOR_AUDIO_BUCKET?.trim() || undefined) {
    this.rootDirectory = rootDirectory;
    this.bucketName = bucketName;
    this.storage = bucketName ? new Storage() : undefined;
  }

  async get(brandInput: string, signal?: AbortSignal): Promise<SponsorCredit> {
    const brand = sanitizeSponsorBrand(brandInput);
    if (!brand) throw new Error('A sponsor brand is required');
    const key = sponsorCreditKey(brand);
    const cached = this.memory.get(key);
    if (cached) {
      this.memory.delete(key);
      this.memory.set(key, cached);
      return cached;
    }
    const active = this.inflight.get(key);
    if (active) return active;
    const promise = this.resolve(brand, key, signal).then((credit) => {
      this.memory.set(key, credit);
      while (this.memory.size > MAX_MEMORY_ENTRIES) this.memory.delete(this.memory.keys().next().value as string);
      return credit;
    }).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async resolve(brand: string, key: string, signal?: AbortSignal): Promise<SponsorCredit> {
    const packaged = await this.readPackaged(brand, key);
    if (packaged) return packaged;

    const objectName = `${CREDIT_VERSION}/${key}.mp3`;
    if (this.storage && this.bucketName) {
      const file = this.storage.bucket(this.bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        const [audio] = await file.download();
        return { audio, contentType: 'audio/mpeg', key, source: 'gcs', brand, cacheControl: CACHE_CONTROL };
      }
    }

    const script = buildSponsorScript(brand, 'ja');
    const tts = await synthesizeAnyVoice(script.script, 'ja', signal);
    const credit: SponsorCredit = {
      audio: tts.audio,
      contentType: tts.contentType,
      key,
      source: 'generated',
      brand,
      cacheControl: CACHE_CONTROL,
    };
    if (this.storage && this.bucketName) {
      const file = this.storage.bucket(this.bucketName).file(objectName);
      try {
        await file.save(tts.audio, {
          resumable: false,
          contentType: tts.contentType,
          metadata: { cacheControl: CACHE_CONTROL, metadata: { brand, version: CREDIT_VERSION } },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
      } catch (error) {
        if (!String(error).includes('conditionNotMet') && !String(error).includes('412')) throw error;
        const [audio] = await file.download();
        return { audio, contentType: 'audio/mpeg', key, source: 'gcs', brand, cacheControl: CACHE_CONTROL };
      }
    }
    return credit;
  }

  private async readPackaged(brand: string, key: string): Promise<SponsorCredit | undefined> {
    const packaged = packagedBrandKey(brand);
    if (!packaged) return undefined;
    const filePath = join(this.rootDirectory, 'public', 'sponsor-credits', CREDIT_LANGUAGE, `${packaged}.mp3`);
    try {
      await stat(filePath);
      const audio = await readFile(filePath);
      return {
        audio,
        contentType: 'audio/mpeg',
        key,
        source: 'packaged',
        brand,
        cacheControl: CACHE_CONTROL,
      };
    } catch {
      return undefined;
    }
  }
}
