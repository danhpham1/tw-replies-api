import './polyfills/crypto';
import express from 'express';
import bodyParser from 'body-parser';
import { fetchReplyUsernamesForUrl } from './twitter';
import { getClientForAccount, invalidateClient } from './login';
import { getNextActiveAccount, listAccounts, createAccount, updateAccount, deleteAccount, getAccountById } from './accounts';
import { connectMongo } from './db';
import { Reply } from './models/reply';
import { TwitterOpenApiClient } from 'twitter-openapi-typescript';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const CHECKVAR_BASE_URL = 'http://103.90.224.221:3005/api/v1';
const CHECKVAR_HEADERS = {
  'Content-Type': 'application/json',
  'x-secret-key': 'PCzFgzSxsT7h2jHTgb7BIWn6QlqMFdG8gWeIb/bet8SPavEqQKTzJT0kGxFDza/V',
};

function getOwnerFromXUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (!host.includes('twitter.com') && !host.includes('x.com')) return '';
    const pathname = u.pathname.replace(/^\/+/, '');
    const [owner] = pathname.split('/');
    return owner || '';
  } catch {
    const match = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([^\/?#]+)/i.exec(String(rawUrl));
    return match?.[1] ?? '';
  }
}

app.use(bodyParser.json({ limit: '1mb' }));

// Global secret-key middleware (exclude /health)
const INCOMING_SECRET = process.env.X_SECRET_KEY || process.env.API_SECRET_KEY || '';
app.use((req, res, next) => {
  if (req.path === '/health') return next();

  if (!INCOMING_SECRET) {
    return res.status(500).json({ error: 'Server secret not configured' });
  }

  const headerValue = req.headers['x-secret-key'];
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!provided || provided !== INCOMING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

async function init() {
  await connectMongo();
  // Prewarm all clients
  try {
    const accounts = (await listAccounts()).filter((a) => a.enabled !== false);
    for (const acc of accounts) {
      try {
        await getClientForAccount(acc);
      } catch (e) {
        // ignore individual failures during prewarm
      }
    }
  } catch {
    // no accounts available at startup, continue
  }
}

type FetchRequestBody = {
  urls: string[];
};

function isRateLimitError(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  if (status === 429) return true;
  const msg: string = (error?.message || '').toString().toLowerCase();
  return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit');
}

app.post('/fetch-replies', async (req, res) => {
  const body = req.body as FetchRequestBody;

  if (!body || !Array.isArray(body.urls)) {
    return res.status(400).json({ error: 'Invalid body. Expect { urls: string[] }' });
  }

  try {
    const activeAccounts = (await listAccounts()).filter((a) => a.enabled !== false);
    if (activeAccounts.length === 0) {
      return res.status(400).json({ error: 'No active accounts available' });
    }
    let upserted = 0;
    let modified = 0;
    const failed: { url: string; reason: string }[] = [];

    for (const url of body.urls) {
      let attempts = 0;
      let success = false;
      let lastErr: any = null;
      while (attempts < activeAccounts.length && !success) {
        const nextAcc = await getNextActiveAccount();
        const client = await getClientForAccount(nextAcc);
        try {
          const result = await fetchReplyUsernamesForUrl(url, client);
          // check data is not empty retry
          if (result.usernames.length === 0) {
            attempts += 1;
            await sleep(10000);
            continue;
          }
          const mongoRes: any = await Reply.updateOne(
            { url: result.url },
            { $addToSet: { usernames: { $each: result.usernames } } },
            { upsert: true }
          );
          if (mongoRes.upsertedCount > 0) upserted += 1;
          if (mongoRes.modifiedCount > 0) modified += 1;
          success = true;
        } catch (e: any) {
          lastErr = e;
          attempts += 1;
          console.log(e);
          await sleep(10000);
          continue; // rotate to next account
        }
      }
      if (!success) {
        failed.push({ url, reason: lastErr?.message || 'Rate limited on all accounts' });
      }
    }

    return res.json({ message: 'OK', urls: body.urls.length, upserted, modified, failed });
  } catch (error: any) {
    console.log(error);
    // eslint-disable-next-line no-console
    console.error('Error:', error?.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Accounts CRUD
app.get('/accounts', async (_req, res) => {
  try {
    const accounts = await listAccounts();
    res.json(accounts.map((a) => ({ id: a.id, enabled: a.enabled !== false })));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list accounts' });
  }
});

app.get('/accounts/:id', async (req, res) => {
  try {
    const account = await getAccountById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    res.json({ id: account.id, enabled: account.enabled !== false });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to get account' });
  }
});

app.post('/accounts', async (req, res) => {
  try {
    const { auth_token, ct0, enabled } = req.body || {};
    if (!auth_token || !ct0) return res.status(400).json({ error: 'auth_token, ct0 required' });
    const created = await createAccount({ auth_token, ct0, enabled });
    res.status(201).json({ id: created.id, enabled: created.enabled !== false });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to create account' });
  }
});

app.patch('/accounts/:id', async (req, res) => {
  try {
    const { auth_token, ct0, enabled } = req.body || {};
    if (auth_token === undefined && ct0 === undefined && enabled === undefined) {
      return res.status(400).json({ error: 'No changes provided' });
    }
    const updated = await updateAccount(req.params.id, { auth_token, ct0, enabled });
    invalidateClient(req.params.id);
    res.json({ id: updated.id, enabled: updated.enabled !== false });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update account' });
  }
});

app.delete('/accounts/:id', async (req, res) => {
  try {
    const ok = await deleteAccount(req.params.id);
    invalidateClient(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to delete account' });
  }
});

// Bulk create accounts
app.post('/accounts/bulk', async (req, res) => {
  const body = req.body;
  const items: any[] = Array.isArray(body) ? body : (Array.isArray(body?.accounts) ? body.accounts : []);
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Provide an array of accounts or { accounts: [...] }' });
  }

  const results: { id?: string; ok: boolean; error?: string }[] = [];
  let created = 0;

  for (const raw of items) {
    const auth_token = raw?.auth_token;
    const ct0 = raw?.ct0;
    const enabled = raw?.enabled;
    if (!auth_token || !ct0) {
      results.push({ ok: false, error: 'auth_token, ct0 required' });
      continue;
    }
    try {
      const createdAcc = await createAccount({ auth_token, ct0, enabled });
      results.push({ ok: true });
      created += 1;
    } catch (e: any) {
      results.push({ ok: false, error: e?.message || 'Failed to create' });
    }
  }

  res.status(207).json({ created, total: items.length, results });
});

// Checkvar endpoints
app.post('/api/checkvar/not-sent', async (req, res) => {
  try {
    const { urls } = req.body || {};

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    const replies = await Reply.find({ url: { $in: urls } });

    const body: { link: string; usernames: string[] }[] = [];

    if (replies && replies?.length) {
      const owners = replies
        .map((reply) => getOwnerFromXUrl(reply.url)?.toLowerCase())
        .filter(Boolean) as string[];

      for (const reply of replies) {
        const owner = getOwnerFromXUrl(reply.url)?.toLowerCase();
        const lowerUsernames = (reply?.usernames || []).map((u) => u.toLowerCase());
        const usersNotReply = owners?.filter((user) => !lowerUsernames.includes(user) && user !== owner);
        if (usersNotReply?.length) {
          body.push({
            link: reply.url,
            usernames: usersNotReply,
          });
        }
      }

      if (body.length) {
        return res.status(200).json(body);
      }
    }

    return res.status(200).json({ message: 'Checkvar data sent successfully' });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.post('/api/checkvar', async (req, res) => {
  try {
    const { urls } = req.body || {};

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }

    const replies = await Reply.find({ url: { $in: urls } });

    const body: { link: string; usernames: string[] }[] = [];

    if ((urls?.length || 0) !== (replies?.length || 0)) {
      await axios.post(`${CHECKVAR_BASE_URL}/send-error`, body, { headers: CHECKVAR_HEADERS });
      return res.status(200).json({ message: 'Crawl is processing' });
    }

    if (replies && replies?.length) {
      const owners = replies
        .map((reply) => getOwnerFromXUrl(reply.url)?.toLowerCase())
        .filter(Boolean) as string[];

      for (const reply of replies) {
        const owner = getOwnerFromXUrl(reply.url)?.toLowerCase();
        const lowerUsernames = (reply?.usernames || []).map((u) => u.toLowerCase());
        const usersNotReply = owners?.filter((user) => !lowerUsernames.includes(user) && user !== owner);
        if (usersNotReply?.length) {
          body.push({
            link: reply.url,
            usernames: usersNotReply,
          });
        }
      }

      if (body.length) {
        await axios.post(`${CHECKVAR_BASE_URL}/send-checkvar`, body, { headers: CHECKVAR_HEADERS });
        return res.status(200).json(body);
      }
    }

    await axios.post(`${CHECKVAR_BASE_URL}/send-all-done`, body, { headers: CHECKVAR_HEADERS });
    return res.status(200).json({ message: 'Checkvar data sent successfully' });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.log(error);
    return res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

async function start() {
  await init();

  app.listen(3333, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://0.0.0.0:3333`);
  });
}

start();
