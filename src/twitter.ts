import './polyfills/crypto';
import { TwitterOpenApiClient } from 'twitter-openapi-typescript';
import * as fs from 'fs';

export type FetchRepliesResult = {
  url: string;
  usernames: string[];
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const extractTweetId = (url: string): string => {
  const match = /status\/(\d+)/.exec(url);
  if (!match) return '';
  return match[1] ?? '';
};

export async function fetchReplyUsernamesForUrls(urls: string[], client: TwitterOpenApiClient): Promise<FetchRepliesResult[]> {
  const tweetApi = client.getTweetApi();

  const results: FetchRepliesResult[] = [];

  for (const url of urls) {
    const single = await fetchReplyUsernamesForUrl(url, client);
    results.push(single);
  }

  return results;
}

export async function fetchReplyUsernamesForUrl(url: string, client: TwitterOpenApiClient): Promise<FetchRepliesResult> {
  const tweetApi = client.getTweetApi();
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    return { url, usernames: [] };
  }

  const usernamesSet = new Set<string>();
  let page = 0;
  let cursor: string | undefined = undefined;

  do {
    // Random delay 10s to mitigate rate limits/bans
    await sleep(3000);

    const params: any = {
      focalTweetId: tweetId,
    };
    
    if (cursor) params.cursor = cursor;
    
    const resp = await tweetApi.getTweetDetail(params);

    if (!resp?.raw?.response?.ok) {
      throw new Error(resp?.raw?.response?.statusText || 'Failed to fetch tweet detail');
    }

    // Collect usernames from tweets
    for (const item of resp.data.data) {
      const screenName = item.user?.legacy?.screenName;
      if (screenName) {
        usernamesSet.add(screenName);
      }
    }

    console.log(resp?.data?.data);

    page += 1;

    if (resp?.data?.data?.length === 0) {
      break;
    }

    // Next page cursor
    const bottomCursor = resp.data.cursor.bottom?.value;
    cursor = bottomCursor || undefined;
  } while (cursor);

  return { url, usernames: Array.from(usernamesSet) };
}

export async function likeXPost(tweetId: string, client: TwitterOpenApiClient) {
  const tweetApi = client.getPostApi();

  await tweetApi.postFavoriteTweet({
    tweetId
  });
}

