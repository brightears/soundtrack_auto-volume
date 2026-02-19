import dotenv from "dotenv";
import path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  port: parseInt(process.env.PORT || "10000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Soundtrack Your Brand API
  soundtrack: {
    apiUrl: "https://api.soundtrackyourbrand.com/v2",
    apiToken: process.env.SOUNDTRACK_API_TOKEN || "",
    clientId: process.env.SOUNDTRACK_CLIENT_ID || "",
    clientSecret: process.env.SOUNDTRACK_CLIENT_SECRET || "",
  },

  // Volume control defaults
  volume: {
    updateIntervalMs: 2000, // Min time between API calls per zone
    defaultMin: 2,
    defaultMax: 14,
    defaultQuietDb: -40,
    defaultLoudDb: -10,
    defaultSmoothing: 0.3,
  },
} as const;
