import { describe, expect, it } from 'bun:test';
import { DEFAULT_FILTER, DEFAULT_LEVELS, LEVEL_RANGES } from './constants';
import { CompressionCodec } from './enums';

describe('LEVEL_RANGES', () => {
  it('covers every CompressionCodec — a new codec without a range is a compile error', () => {
    const codecs = Object.values(CompressionCodec).sort();
    expect(Object.keys(LEVEL_RANGES).sort()).toEqual(codecs);
  });

  it('encodes each codec\'s valid integer level range', () => {
    expect(LEVEL_RANGES[CompressionCodec.Gzip]).toEqual({ min: 1, max: 9 });
    expect(LEVEL_RANGES[CompressionCodec.Br]).toEqual({ min: 0, max: 11 });
    expect(LEVEL_RANGES[CompressionCodec.Deflate]).toEqual({ min: 1, max: 9 });
    expect(LEVEL_RANGES[CompressionCodec.Zstd]).toEqual({ min: 1, max: 19 });
  });

  it('holds every DEFAULT_LEVELS value inside its codec range', () => {
    for (const codec of Object.values(CompressionCodec)) {
      const { min, max } = LEVEL_RANGES[codec];
      expect(DEFAULT_LEVELS[codec]).toBeGreaterThanOrEqual(min);
      expect(DEFAULT_LEVELS[codec]).toBeLessThanOrEqual(max);
    }
  });
});

describe('DEFAULT_FILTER', () => {
  it('should return true for text/html when given text/html', () => {
    const contentType = 'text/html';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for application/json when given application/json', () => {
    const contentType = 'application/json';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for application/javascript when given application/javascript', () => {
    const contentType = 'application/javascript';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for image/svg+xml when given image/svg+xml', () => {
    const contentType = 'image/svg+xml';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for application/ld+json when given application/ld+json', () => {
    const contentType = 'application/ld+json';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for application/vnd.api+json when given application/vnd.api+json', () => {
    const contentType = 'application/vnd.api+json';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return false for image/png when given image/png', () => {
    const contentType = 'image/png';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(false);
  });

  it('should return false for application/octet-stream when given application/octet-stream', () => {
    const contentType = 'application/octet-stream';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(false);
  });

  it('should return false for video/mp4 when given video/mp4', () => {
    const contentType = 'video/mp4';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(false);
  });

  it('should return false for empty string when given empty string', () => {
    const contentType = '';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(false);
  });

  it('should return true for content-type with charset params when given text/html; charset=utf-8', () => {
    const contentType = 'text/html; charset=utf-8';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for uppercase content-type when given TEXT/HTML', () => {
    const contentType = 'TEXT/HTML';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(true);
  });

  it('should return true for mixed-case Application/JSON', () => {
    expect(DEFAULT_FILTER('Application/JSON')).toBe(true);
  });

  it('should return true for application/atom+xml', () => {
    expect(DEFAULT_FILTER('application/atom+xml')).toBe(true);
  });

  it('should return true for application/rss+xml', () => {
    expect(DEFAULT_FILTER('application/rss+xml')).toBe(true);
  });

  it('should return false for content-type with leading space when given  text/html', () => {
    const contentType = ' text/html';
    const result = DEFAULT_FILTER(contentType);
    expect(result).toBe(false);
  });

  it('should return true for image/svg+xml but false for image/svg when given both', () => {
    expect(DEFAULT_FILTER('image/svg+xml')).toBe(true);
    expect(DEFAULT_FILTER('image/svg')).toBe(false);
  });

  it('should return false for text/event-stream (SSE)', () => {
    expect(DEFAULT_FILTER('text/event-stream')).toBe(false);
  });

  it('should return false for text/event-stream with charset param', () => {
    expect(DEFAULT_FILTER('text/event-stream; charset=utf-8')).toBe(false);
  });

  it('should return false for TEXT/EVENT-STREAM (case-insensitive)', () => {
    expect(DEFAULT_FILTER('TEXT/EVENT-STREAM')).toBe(false);
  });

  it('should return true for text/plain (other text/* types still match)', () => {
    expect(DEFAULT_FILTER('text/plain')).toBe(true);
  });

  it('should return true for text/css', () => {
    expect(DEFAULT_FILTER('text/css')).toBe(true);
  });

  it('should return true for text/xml', () => {
    expect(DEFAULT_FILTER('text/xml')).toBe(true);
  });
});
