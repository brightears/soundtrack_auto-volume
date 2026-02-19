import { config } from "../config";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

interface AccountNode {
  id: string;
  businessName: string;
  businessType: string;
}

export class SoundtrackService {
  private accountsCache: AccountNode[] | null = null;
  private accountsCacheTime: number = 0;
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private getAuthHeader(): string {
    const token = config.soundtrack.apiToken
      || Buffer.from(
        `${config.soundtrack.clientId}:${config.soundtrack.clientSecret}`
      ).toString("base64");

    return `Basic ${token}`;
  }

  private async graphql<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const res = await fetch(config.soundtrack.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json() as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`);
    }

    return json.data!;
  }

  private async fetchAllAccounts(): Promise<AccountNode[]> {
    // Return cached if fresh
    if (this.accountsCache && Date.now() - this.accountsCacheTime < SoundtrackService.CACHE_TTL) {
      return this.accountsCache;
    }

    const allAccounts: AccountNode[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const data: any = await this.graphql<any>(
        `query FetchAccounts($first: Int!, $after: String) {
          me {
            ... on PublicAPIClient {
              accounts(first: $first, after: $after) {
                edges { node { id businessName businessType } cursor }
                pageInfo { hasNextPage }
              }
            }
          }
        }`,
        { first: 100, after: cursor }
      );

      const connection = data.me?.accounts;
      const edges: any[] = connection?.edges || [];
      for (const edge of edges) {
        allAccounts.push(edge.node);
        cursor = edge.cursor;
      }
      hasMore = connection?.pageInfo?.hasNextPage ?? false;
    }

    this.accountsCache = allAccounts;
    this.accountsCacheTime = Date.now();
    console.log(`Cached ${allAccounts.length} Soundtrack accounts`);
    return allAccounts;
  }

  async searchAccounts(query: string): Promise<AccountNode[]> {
    const allAccounts = await this.fetchAllAccounts();
    const q = query.toLowerCase().trim();
    return allAccounts
      .filter((a) => a.businessName.toLowerCase().includes(q))
      .slice(0, 20);
  }

  async getZones(accountId: string): Promise<any[]> {
    const data = await this.graphql<any>(
      `query GetZones($accountId: ID!) {
        account(id: $accountId) {
          id
          businessName
          locations(first: 50) {
            edges {
              node {
                id
                name
                soundZones(first: 50) {
                  edges {
                    node {
                      id
                      name
                      nowPlaying {
                        track {
                          name
                          artists { name }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { accountId }
    );

    const locations = data.account?.locations?.edges?.map((e: any) => e.node) || [];
    const zones: any[] = [];

    for (const location of locations) {
      const locationZones = location.soundZones?.edges?.map((e: any) => e.node) || [];
      for (const zone of locationZones) {
        zones.push({
          id: zone.id,
          name: zone.name,
          locationId: location.id,
          locationName: location.name,
          nowPlaying: zone.nowPlaying?.track
            ? {
                track: zone.nowPlaying.track.name,
                artist: zone.nowPlaying.track.artists?.map((a: any) => a.name).join(", "),
              }
            : null,
        });
      }
    }

    return zones;
  }

  async setVolume(zoneId: string, volume: number): Promise<any> {
    const clampedVolume = Math.max(0, Math.min(16, Math.round(volume)));

    const data = await this.graphql<any>(
      `mutation SetVolume($soundZone: ID!, $volume: Int!) {
        setVolume(input: { soundZone: $soundZone, volume: $volume }) {
          volume
        }
      }`,
      { soundZone: zoneId, volume: clampedVolume }
    );

    console.log(`Volume set: zone=${zoneId} volume=${clampedVolume}`);
    return data;
  }
}
