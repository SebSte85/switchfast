import { PostHog } from "posthog-node";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import * as https from "https";

// Helper function to make HTTPS requests
function makeHttpsRequest(url: string, options: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          resolve({ error: "Invalid JSON response", rawData: data });
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// PostHog client instance
let client: PostHog | null = null;

// User identification
let userId: string = "";
let sessionId: string = "";
const USER_ID_FILE = path.join(
  os.homedir(),
  ".workfocusmanager",
  "analytics_user_id.txt"
);

// Get or create a persistent user ID
function getUserId(): string {
  try {
    // Ensure directory exists
    const dir = path.dirname(USER_ID_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Try to read existing ID
    if (fs.existsSync(USER_ID_FILE)) {
      const storedId = fs.readFileSync(USER_ID_FILE, "utf8").trim();
      if (storedId && storedId.length > 0) {
        return storedId;
      }
    }

    // Create new ID if none exists
    const newId = uuidv4();
    fs.writeFileSync(USER_ID_FILE, newId);
    return newId;
  } catch (error) {
    console.error("[Analytics] Error getting/creating user ID:", error);
    // Fallback to hostname-based ID if file operations fail
    return (
      "user-" + os.hostname() + "-" + Math.random().toString(36).substring(2, 9)
    );
  }
}

// Initialize PostHog with your project API key
export function initAnalytics() {
  try {
    // Get persistent user ID
    userId = getUserId();

    // Create new session ID for this app instance
    sessionId = uuidv4();

    client = new PostHog("phc_oMabWAWOtEF4LwFnSOzvx4nbm4OtoIQIHOYTS03E4TK", {
      host: "https://eu.i.posthog.com",
    });

    // Track app start event with session info
    trackEvent("app_started", {
      session_id: sessionId,
    });

    console.log("[Analytics] Initialized with userId:", userId);
  } catch (error) {
    console.error("[Analytics] Failed to initialize PostHog client:", error);
  }
}

// Track an event
export function trackEvent(
  eventName: string,
  properties: Record<string, any> = {}
) {
  if (!client) {
    console.warn(
      "[Analytics] Cannot track event, PostHog client not initialized"
    );
    return;
  }

  try {
    // Use the persistent user ID
    const distinctId = userId || "anonymous-user";

    // Add session ID and timestamp to all events
    const enhancedProperties = {
      ...properties,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      app_version: process.env.npm_package_version || "0.1.1",
      os_platform: os.platform(),
      os_release: os.release(),
    };

    // Track the event
    client.capture({
      distinctId,
      event: eventName,
      properties: enhancedProperties,
    });

    console.log(
      `[Analytics] Tracked event: ${eventName} for user: ${distinctId}`
    );
  } catch (error) {
    console.error(`[Analytics] Failed to track event ${eventName}:`, error);
  }
}

// Shutdown analytics when the app is closing
export function shutdownAnalytics() {
  if (client) {
    try {
      client.shutdown();
    } catch (error) {
      console.error("[Analytics] Error shutting down PostHog client:", error);
    }
    client = null;
  }
}

// Fallback mock data
function getMockUsageStats() {
  return {
    themeCreated: 2,
    shortcutUsed: 15,
    totalEvents: 17,
  };
}

// Function to fetch PostHog usage statistics for the current user
export async function fetchUsageStats(): Promise<{
  themeCreated: number;
  shortcutUsed: number;
  totalEvents: number;
} | null> {
  if (!userId) {
    console.warn("[Analytics] Cannot fetch usage stats, user ID not available");
    return null;
  }

  console.log("[Analytics] Querying events for user:", userId);

  try {
    // PostHog Personal API Key - this needs to be added to environment variables
    const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

    if (!POSTHOG_PERSONAL_API_KEY) {
      console.warn(
        "[Analytics] PostHog Personal API Key not found, using mock data"
      );
      return getMockUsageStats();
    }

    console.log(
      "[Analytics] Personal API Key available:",
      !!POSTHOG_PERSONAL_API_KEY
    );

    // PostHog Project ID - replace with your actual project ID
    const PROJECT_ID = "69802"; // This should be your actual PostHog project ID

    // Use PostHog Query API to count events
    const queryData = {
      query: {
        kind: "HogQLQuery",
        query: `
          SELECT 
            event,
            count() as event_count
          FROM events 
          WHERE 
            distinct_id = '${userId}' 
            AND timestamp >= now() - interval 7 day
            AND event IN ('theme_created', 'shortcut_used')
          GROUP BY event
        `,
      },
    };

    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
        "Content-Type": "application/json",
      },
    };

    const url = `https://eu.posthog.com/api/projects/${PROJECT_ID}/query/`;

    console.log("[Analytics] Making Query API request to:", url);
    console.log("[Analytics] Query:", queryData.query.query);

    const result = await makeHttpsRequest(url, {
      ...options,
      body: JSON.stringify(queryData),
    });

    console.log("[Analytics] Query API response:", result);

    if (result.error) {
      console.error("[Analytics] PostHog Query API error:", result.error);
      return getMockUsageStats();
    }

    // Parse results
    const stats = {
      themeCreated: 0,
      shortcutUsed: 0,
      totalEvents: 0,
    };

    if (result.results) {
      result.results.forEach((row: any[]) => {
        const eventName = row[0];
        const eventCount = row[1];

        if (eventName === "theme_created") {
          stats.themeCreated = eventCount;
        } else if (eventName === "shortcut_used") {
          stats.shortcutUsed = eventCount;
        }

        stats.totalEvents += eventCount;
      });
    }

    console.log("[Analytics] Parsed usage stats:", stats);
    return stats;
  } catch (error) {
    console.error("[Analytics] Error fetching usage stats:", error);
    return getMockUsageStats();
  }
}
