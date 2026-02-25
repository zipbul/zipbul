import type { LogMessage, Transport } from '../interfaces';

export class TestTransport implements Transport {
  readonly messages: LogMessage[] = [];

  log(message: LogMessage): void {
    this.messages.push(message);
  }
}
