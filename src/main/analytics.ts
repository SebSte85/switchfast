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
  } catch (error) {
    console.error(`[Analytics] Failed to track event ${eventName}:`, error);
  }
}

// Capture exceptions and errors
export function captureException(
  error: Error,
  context: Record<string, any> = {},
  level: "error" | "warning" | "info" = "error"
) {
  if (!client) {
    console.error(
      "[Analytics] Cannot capture exception - client not initialized:",
      error.message
    );
    return;
  }

  try {
    // Use the persistent user ID
    const distinctId = userId || "anonymous-user";

    // Extract error details
    const errorProperties = {
      // Error details
      error_message: error.message,
      error_name: error.name,
      error_stack: error.stack,

      // Context information
      ...context,

      // Session and system info
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      app_version: process.env.npm_package_version || "0.1.1",
      os_platform: os.platform(),
      os_release: os.release(),
      process_type: "main",
      error_level: level,

      // Additional debugging info
      memory_usage: process.memoryUsage(),
      uptime: process.uptime(),
    };

    // Track the exception as a special event with PostHog-specific properties
    client.capture({
      distinctId,
      event: "$exception",
      properties: {
        ...errorProperties,
        // PostHog Error Tracking specific properties
        $exception_message: error.message,
        $exception_type: error.name,
        $exception_stack_trace_raw: error.stack,
        $exception_fingerprint: `${error.name}:${
          context.function || "unknown"
        }`,
        $exception_list: [
          {
            type: error.name,
            value: error.message,
            stacktrace: {
              type: "resolved",
              frames: error.stack
                ? error.stack
                    .split("\n")
                    .slice(1, 10)
                    .map((line, index) => {
                      const match =
                        line.match(/at\s+(.+?)\s*\((.+?):(\d+):(\d+)\)/) ||
                        line.match(/at\s+(.+?):(\d+):(\d+)/) ||
                        line.match(/(.+?):(\d+):(\d+)/);

                      if (match) {
                        const isFileMatch = match.length === 4;
                        return {
                          filename: isFileMatch
                            ? match[1]
                            : match[2] || "unknown",
                          function: isFileMatch
                            ? "anonymous"
                            : match[1] || "anonymous",
                          line: parseInt(
                            isFileMatch ? match[2] : match[3] || "0"
                          ),
                          column: parseInt(
                            isFileMatch ? match[3] : match[4] || "0"
                          ),
                          in_app: true,
                          lang: "node",
                          resolved: true,
                        };
                      }

                      return {
                        filename: "unknown",
                        function: "anonymous",
                        line: 0,
                        column: 0,
                        in_app: true,
                        lang: "node",
                        resolved: false,
                      };
                    })
                : [],
            },
          },
        ],
      },
    });

    console.log(`[Analytics] Exception captured: ${error.message}`);
  } catch (captureError) {
    console.error(`[Analytics] Failed to capture exception:`, captureError);
    console.error(`[Analytics] Original error was:`, error);
  }
}

// Capture custom errors with additional context
export function captureError(
  message: string,
  context: Record<string, any> = {},
  level: "error" | "warning" | "info" = "error"
) {
  const syntheticError = new Error(message);
  captureException(syntheticError, context, level);
}

// Setup global error handlers for the main process
export function setupGlobalErrorHandlers() {
  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[Global] Uncaught Exception:", error);
    captureException(error, {
      error_type: "uncaught_exception",
      fatal: true,
    });

    // Don't exit immediately, give PostHog time to send the event
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      "[Global] Unhandled Rejection at:",
      promise,
      "reason:",
      reason
    );

    // Convert reason to Error if it isn't already
    const error = reason instanceof Error ? reason : new Error(String(reason));

    captureException(error, {
      error_type: "unhandled_rejection",
      promise_details: String(promise),
      fatal: false,
    });
  });

  // Handle warnings
  process.on("warning", (warning) => {
    console.warn("[Global] Process Warning:", warning);
    captureError(
      warning.message,
      {
        error_type: "process_warning",
        warning_name: warning.name,
        warning_code: (warning as any).code,
        fatal: false,
      },
      "warning"
    );
  });

  console.log("[Analytics] Global error handlers initialized");
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
    return null;
  }

  try {
    // PostHog Personal API Key - this needs to be added to environment variables
    const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;

    if (!POSTHOG_PERSONAL_API_KEY) {
      return getMockUsageStats();
    }

    // PostHog Project ID - replace with your actual project ID
    const PROJECT_ID = "69802";

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

    const result = await makeHttpsRequest(url, {
      ...options,
      body: JSON.stringify(queryData),
    });

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

    return stats;
  } catch (error) {
    console.error("[Analytics] Error fetching usage stats:", error);
    return getMockUsageStats();
  }
}
