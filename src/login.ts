import './polyfills/crypto';
import { TwitterOpenApi, TwitterOpenApiClient } from 'twitter-openapi-typescript-v2';
import * as dotenv from 'dotenv';
import { Account } from './accounts';
import { HttpProxyAgent } from 'http-proxy-agent';

dotenv.config();

const clientsCache: Map<string, TwitterOpenApiClient> = new Map();

async function createClientFromAccount(account: Account): Promise<TwitterOpenApiClient> {
  const api = new TwitterOpenApi();
  const cookie = { auth_token: account.auth_token, ct0: account.ct0 } as any;
  return await api.getClientFromCookies(cookie);
}

export async function getClientForAccount(account: Account): Promise<TwitterOpenApiClient> {
  const existing = clientsCache.get(account.id);
  if (existing) return existing;
  const client = await createClientFromAccount(account);
  // const proxyUrl = `http://cxhytyoh:s1lnkdebw8bs@206.206.119.223:6134`
  const proxyUrl = `http://hmpu0o6s:hMpU0o6S@51.81.141.175:39935`
  const agent = new HttpProxyAgent(proxyUrl);
  client.getDefaultApi().initOverrides({ agent });
  clientsCache.set(account.id, client);
  return client;
}

export function invalidateClient(accountId: string): void {
  clientsCache.delete(accountId);
}

export function clearAllClients(): void {
  clientsCache.clear();
}

