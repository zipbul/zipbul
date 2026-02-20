import { describe, expect, it } from 'bun:test';

import * as config from './index';

describe('config', () => {
  it('should export ConfigLoader', () => {
    // Arrange

    // Act

    // Assert
    expect(config.ConfigLoader).toBeDefined();
  });

  it('should export ConfigLoadError', () => {
    // Arrange

    // Act

    // Assert
    expect(config.ConfigLoadError).toBeDefined();
  });
});
