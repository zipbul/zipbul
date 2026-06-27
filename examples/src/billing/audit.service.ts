import { Injectable } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

@Injectable()
export class BillingAuditService {
  private readonly logger = new Logger('BillingAuditService');

  logAction(action: string, detail: string): string {
    const entry = `[BILLING] ${action}: ${detail}`;

    this.logger.info(entry);

    return entry;
  }
}
