import dotenv from 'dotenv';
import { AccountModel, IAccount } from './models/account';

dotenv.config();

export type Account = {
  id: string;
  auth_token: string;
  ct0: string;
  enabled: boolean;
};

let roundRobinIndex = 0;

function toAccount(doc: IAccount): Account {
  return {
    id: doc.id,
    auth_token: doc.auth_token,
    ct0: doc.ct0,
    enabled: doc.enabled,
  };
}

async function loadAccountsFromDb(): Promise<Account[]> {
  const docs = await AccountModel.find({}).sort({ createdAt: -1 }).lean();
  return docs.map((d: any) => toAccount(d as IAccount));
}

export async function listAccounts(): Promise<Account[]> {
  return await loadAccountsFromDb();
}

export async function getAccountById(accountId: string): Promise<Account | undefined> {
  const doc = await AccountModel.findOne({ id: accountId }).lean();
  return doc ? toAccount(doc as unknown as IAccount) : undefined;
}

export async function getNextActiveAccount(): Promise<Account> {
  const accounts = await loadAccountsFromDb();
  const active = accounts.filter((a) => a.enabled !== false);
  const pool = active.length > 0 ? active : accounts;
  if (pool.length === 0) throw new Error('No accounts available');
  if (roundRobinIndex >= pool.length) roundRobinIndex = 0;
  const index = roundRobinIndex % pool.length;
  const account = pool[index]!;
  roundRobinIndex = (roundRobinIndex + 1) % pool.length;
  return account;
}

export function resetRoundRobin(): void {
  roundRobinIndex = 0;
}

export async function createAccount(newAccount: { auth_token: string; ct0: string; enabled?: boolean }): Promise<Account> {
  const doc = await AccountModel.create({
    auth_token: String(newAccount.auth_token).trim(),
    ct0: String(newAccount.ct0).trim(),
    enabled: newAccount.enabled === false ? false : true,
  });
  return toAccount(doc);
}

export async function updateAccount(accountId: string, patch: { auth_token?: string; ct0?: string; enabled?: boolean; error?: string }): Promise<Account> {
  const update: any = {};
  if (patch.auth_token !== undefined) update.auth_token = String(patch.auth_token).trim();
  if (patch.ct0 !== undefined) update.ct0 = String(patch.ct0).trim();
  if (patch.enabled !== undefined) update.enabled = Boolean(patch.enabled);
  if (patch.error !== undefined) update.error = String(patch.error).trim();
  const doc = await AccountModel.findOneAndUpdate({ id: accountId }, { $set: update }, { new: true });
  if (!doc) throw new Error(`Account not found: ${accountId}`);
  return toAccount(doc);
}

export async function deleteAccount(accountId: string): Promise<boolean> {
  const res = await AccountModel.deleteOne({ id: accountId });
  return res.deletedCount > 0;
}


