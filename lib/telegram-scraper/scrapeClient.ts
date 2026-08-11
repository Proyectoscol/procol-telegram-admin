import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { getDecryptedAccount } from '@/lib/telegram-scraper/account';

export class ScraperNotConnectedError extends Error {
  constructor() {
    super('Telegram scraper is not connected. Log in from Settings first.');
    this.name = 'ScraperNotConnectedError';
  }
}

/**
 * Opens a short-lived MTProto connection from the stored session, runs fn,
 * then always disconnects — this runs on-demand from a button click, not as
 * a persistent background connection.
 */
export async function withScraperClient<T>(fn: (client: TelegramClient) => Promise<T>): Promise<T> {
  const account = await getDecryptedAccount();
  if (!account) throw new ScraperNotConnectedError();

  const client = new TelegramClient(new StringSession(account.sessionString), account.apiId, account.apiHash, {
    connectionRetries: 3,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}
