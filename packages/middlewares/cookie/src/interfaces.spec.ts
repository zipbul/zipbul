import { describe, expect, it } from 'bun:test';

import { CookieErrorReason } from './enums';
import { CookieError } from './interfaces';

describe('interfaces', () => {
  describe('CookieError', () => {
    it('should be an instance of Error', () => {
      const error = new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'test' });
      expect(error).toBeInstanceOf(Error);
    });

    it('should be an instance of CookieError', () => {
      const error = new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'test' });
      expect(error).toBeInstanceOf(CookieError);
    });

    it('should set the name to CookieError', () => {
      const error = new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'test' });
      expect(error.name).toBe('CookieError');
    });

    it('should set the reason from the data', () => {
      const error = new CookieError({ reason: CookieErrorReason.WeakSecret, message: 'test' });
      expect(error.reason).toBe(CookieErrorReason.WeakSecret);
    });

    it('should set the message from the data', () => {
      const error = new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'boom' });
      expect(error.message).toBe('boom');
    });
  });
});
