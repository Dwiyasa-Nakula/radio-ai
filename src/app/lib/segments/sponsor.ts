import type { AnnouncerLanguage } from '../types';

export function sanitizeSponsorBrand(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, 80)
    : '';
}

export function buildSponsorScript(brand: string, language: AnnouncerLanguage) {
  const cleanBrand = sanitizeSponsorBrand(brand);
  if (!cleanBrand) throw new Error('A sponsor brand is required');

  return {
    script:
      language === 'en'
        ? `That message was brought to you by ${cleanBrand}, a proud sponsor of mirAI melody 73.9 FM.`
        : `ただいまのメッセージは、mirAI melody 73.9 FMのスポンサー、${cleanBrand}の提供でお送りしました。`,
    model: 'fixed-sponsor-copy',
  };
}
