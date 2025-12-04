import './polyfills/crypto';
import { TwitterOpenApi, TwitterOpenApiClient } from 'twitter-openapi-typescript';
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
  const proxyUrl = `http://fpasuyoe:dn83l6sporh3@206.206.119.249:6160`
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

