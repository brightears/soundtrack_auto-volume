import { config } from "../config";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class SoundtrackService {
  private token: string | null = null;
  private tokenExpiry: number = 0;

  private async getToken(): Promise<string> {
    // Return cached token if still valid (with 5min buffer)
    if (this.token && Date.now() < this.tokenExpiry - 300000) {
      return this.token;
    }

    // Use pre-encoded token if available
    if (config.soundtrack.apiToken) {
      this.token = config.soundtrack.apiToken;
      this.tokenExpiry = Date.now() + 3600000; // Assume 1hr
      return this.token;
    }

    // Otherwise use client credentials flow
    const credentials = Buffer.from(
      `${config.soundtrack.clientId}:${config.soundtrack.clientSecret}`
    ).toString("base64");

    const res = await fetch("https://accounts.soundtrackyourbrand.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.token!;
  }

  private async graphql<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const token = await this.getToken();

    const res = await fetch(config.soundtrack.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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

  async searchAccounts(query: string): Promise<any[]> {
    const data = await this.graphql<any>(
      `query SearchAccounts($query: String!) {
        accounts(filter: { name: { contains: $query } }, first: 20) {
          edges {
            node {
              id
              name
              businessType
            }
          }
        }
      }`,
      { query }
    );

    return data.accounts?.edges?.map((e: any) => e.node) || [];
  }

  async getZones(accountId: string): Promise<any[]> {
    const data = await this.graphql<any>(
      `query GetZones($accountId: ID!) {
        account(id: $accountId) {
          locations {
            edges {
              node {
                id
                name
                soundZones {
                  edges {
                    node {
                      id
                      name
                      playing {
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
          nowPlaying: zone.playing?.track
            ? {
                track: zone.playing.track.name,
                artist: zone.playing.track.artists?.map((a: any) => a.name).join(", "),
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
      `mutation SetVolume($soundZoneId: ID!, $volume: Int!) {
        setSoundZoneVolume(input: { soundZoneId: $soundZoneId, volume: $volume }) {
          soundZone {
            id
            volume
          }
        }
      }`,
      { soundZoneId: zoneId, volume: clampedVolume }
    );

    console.log(`Volume set: zone=${zoneId} volume=${clampedVolume}`);
    return data;
  }
}
