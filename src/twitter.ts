import './polyfills/crypto';
import { TwitterOpenApiClient } from 'twitter-openapi-typescript-v2';
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
    // Random delay 5s to mitigate rate limits/bans
    await sleep(5000);

    const params: any = {
      focalTweetId: tweetId,
    };
    
    if (cursor) params.cursor = cursor;
    
    const resp = await tweetApi.getTweetDetail(params);

    if (!resp?.raw?.response?.ok) {
      throw new Error(resp?.raw?.response?.statusText || 'Failed to fetch tweet detail');
    }

    // Extract usernames and cursor from instruction
    const instruction = resp.data?.raw?.instruction;
    let entriesCount = 0;
    let nextCursor: string | undefined = undefined;

    if (Array.isArray(instruction)) {
      for (const inst of instruction) {
        // Find TimelineAddEntries instruction
        if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
          for (const entry of inst.entries) {
            const content = entry.content as any;
            
            // Extract username from tweet entries (TimelineTimelineItem)
            if (content?.typename === 'TimelineTimelineItem') {
              const screenName = content?.itemContent?.tweetResults?.result?.core?.userResults?.result?.legacy?.screenName;
              if (screenName) {
                usernamesSet.add(screenName);
                entriesCount++;
              }
            }
            
            // Extract username from module items (TimelineTimelineModule)
            if (content?.typename === 'TimelineTimelineModule' && Array.isArray(content?.items)) {
              for (const moduleItem of content.items) {
                const item = moduleItem.item as any;
                const screenName = item?.itemContent?.tweetResults?.result?.core?.userResults?.result?.legacy?.screenName;
                if (screenName) {
                  usernamesSet.add(screenName);
                  entriesCount++;
                }
              }
            }
            
            // Extract cursor for pagination (support both Bottom and ShowMoreThreads)
            if (content?.typename === 'TimelineTimelineCursor') {
              if (content?.cursorType === 'Bottom' || content?.cursorType === 'ShowMoreThreads') {
                nextCursor = content?.value;
              }
            }
          }
        }
      }
    }

    console.log(`${url} - Page ${page + 1}: ${entriesCount} usernames found, Total unique: ${usernamesSet.size}`);

    page += 1;

    // Stop if no entries found or no next cursor
    if (entriesCount === 0 || !nextCursor) {
      break;
    }

    cursor = nextCursor;
  } while (cursor);

  console.log(`${url} - Completed: Total ${usernamesSet.size} unique usernames`);
  return { url, usernames: Array.from(usernamesSet) };
}

export async function likeXPost(tweetId: string, client: TwitterOpenApiClient) {
  const tweetApi = client.getPostApi();

  await tweetApi.postFavoriteTweet({
    tweetId
  });
}

