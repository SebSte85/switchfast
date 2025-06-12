import { v4 as uuidv4 } from "uuid";
import * as os from "os";
import {
  ErrorContext,
  ApplicationState,
  UserBehavior,
  SystemInfo,
  ErrorMetadata,
} from "../types/analytics";
import { captureException as baseCaptureException } from "./analytics";

// Global state tracking for enhanced context
let sessionStartTime = Date.now();
let userActions: string[] = [];
let errorCountThisSession = 0;
let shortcutUsageCount = 0;
let lastThemeSwitch: string | undefined;

// Add user action to tracking
export function trackUserAction(action: string, details?: Record<string, any>) {
  const timestamp = new Date().toISOString();
  const actionWithTime = `${timestamp}: ${action}`;

  userActions.push(actionWithTime);

  // Keep only last 20 actions to prevent memory bloat
  if (userActions.length > 20) {
    userActions = userActions.slice(-20);
  }

  // Track specific actions
  if (action.includes("shortcut")) {
    shortcutUsageCount++;
  }
  if (action.includes("theme_switch")) {
    lastThemeSwitch = details?.themeId || details?.theme_name || "unknown";
  }

  console.log(`[Enhanced Analytics] User action tracked: ${action}`);
}

// Get current application state
function getCurrentApplicationState(): Partial<ApplicationState> {
  try {
    // Import dataStore dynamically to avoid circular dependencies
    const { dataStore } = require("./dataStore");
    const themes = dataStore?.getThemes() || [];

    return {
      themes_count: themes.length,
      active_shortcuts: shortcutUsageCount,
      running_processes: 0, // Will be enhanced with actual process count
      last_action: userActions[userActions.length - 1] || "none",
      app_uptime: Math.floor((Date.now() - sessionStartTime) / 1000),
      license_status: "unknown", // Will be enhanced with actual license status
    };
  } catch (error) {
    console.error(
      "[Enhanced Analytics] Error getting application state:",
      error
    );
    return {
      themes_count: 0,
      active_shortcuts: 0,
      running_processes: 0,
      last_action: "error_getting_state",
      app_uptime: Math.floor((Date.now() - sessionStartTime) / 1000),
      license_status: "unknown",
    };
  }
}

// Get current user behavior data
function getCurrentUserBehavior(): Partial<UserBehavior> {
  const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);

  return {
    session_duration: sessionDuration,
    actions_performed: userActions.slice(-10), // Last 10 actions
    last_theme_switch: lastThemeSwitch,
    shortcut_usage_count: shortcutUsageCount,
    error_count_this_session: errorCountThisSession,
  };
}

// Get current system information
function getCurrentSystemInfo(): Partial<SystemInfo> {
  const memoryUsage = process.memoryUsage();

  return {
    memory_usage_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    screen_resolution: "unknown", // Will be enhanced from renderer
    cpu_usage: Math.round(process.cpuUsage().system / 1000000), // Convert to percentage approximation
    network_status: "offline" as const, // Will be enhanced
  };
}

// Generate error fingerprint for deduplication
function generateErrorFingerprint(error: Error, context: ErrorContext): string {
  const keyParts = [
    error.name,
    error.message.substring(0, 100), // First 100 chars of message
    context.function || context.component || "unknown",
    context.error_category || "unknown",
  ];

  return Buffer.from(keyParts.join("|")).toString("base64").substring(0, 16);
}

// Generate stack trace hash for grouping
function generateStackTraceHash(error: Error): string {
  if (!error.stack) return "no-stack";

  // Extract just the function names and line numbers, ignore file paths
  const stackLines = error.stack
    .split("\n")
    .slice(1, 6) // Take first 5 stack frames
    .map((line) => {
      // Extract function name and line number, ignore file paths
      const match =
        line.match(/at\s+([^(]+)\s*\(.*:(\d+):\d+\)/) ||
        line.match(/at\s+.*[/\\]([^/\\]+):(\d+):\d+/);
      return match ? `${match[1]}:${match[2]}` : line.trim();
    })
    .join("|");

  return Buffer.from(stackLines).toString("base64").substring(0, 12);
}

// Enhanced exception capture with rich context
export function captureEnhancedException(
  error: Error,
  context: ErrorContext = {},
  level: "error" | "warning" | "info" = "error"
) {
  try {
    errorCountThisSession++;

    // Generate unique error ID
    const errorId = uuidv4();

    // Generate error fingerprint and stack hash
    const errorFingerprint = generateErrorFingerprint(error, context);
    const stackTraceHash = generateStackTraceHash(error);

    // Collect comprehensive metadata
    const errorMetadata: ErrorMetadata = {
      // Timing information
      timestamp: new Date().toISOString(),
      session_id: (global as any).sessionId || "unknown",
      error_id: errorId,

      // Application context
      app_state: getCurrentApplicationState(),
      user_behavior: getCurrentUserBehavior(),
      system_info: getCurrentSystemInfo(),

      // Enhanced error context
      error_context: {
        ...context,
        error_fingerprint: errorFingerprint,
        stack_trace_hash: stackTraceHash,
        error_severity:
          context.error_severity || classifyErrorSeverity(error, context),
        error_frequency: undefined, // Will be determined by PostHog over time
      },

      // Process type
      process_type: "main",

      // Environment
      environment: (process.env.NODE_ENV as any) || "production",
    };

    // Add PostHog Error Tracking specific properties to metadata
    const postHogErrorMetadata = {
      ...errorMetadata,
      // PostHog Error Tracking specific properties
      $exception_message: error.message,
      $exception_type: "raw",
      $exception_stack_trace_raw: error.stack,
      $exception_fingerprint: errorFingerprint,
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
    };

    // Use the base capture function with enhanced metadata
    baseCaptureException(error, postHogErrorMetadata, level);

    console.log(
      `[Enhanced Analytics] Enhanced exception captured: ${error.message} (ID: ${errorId})`
    );
  } catch (captureError) {
    console.error(
      "[Enhanced Analytics] Failed to capture enhanced exception:",
      captureError
    );
    // Fallback to basic capture
    baseCaptureException(error, context, level);
  }
}

// Classify error severity based on error type and context
function classifyErrorSeverity(
  error: Error,
  context: ErrorContext
): "low" | "medium" | "high" | "critical" {
  // Critical errors
  if (
    error.name === "TypeError" &&
    error.message.includes("Cannot read prop")
  ) {
    return "critical";
  }
  if (
    context.error_category === "licensing" ||
    context.error_category === "system"
  ) {
    return "high";
  }
  if (
    error.message.includes("ENOENT") ||
    error.message.includes("permission denied")
  ) {
    return "high";
  }

  // Medium severity
  if (
    context.error_category === "shortcuts" ||
    context.error_category === "ipc"
  ) {
    return "medium";
  }
  if (error.name === "ReferenceError" || error.name === "SyntaxError") {
    return "medium";
  }

  // Default to low for UI and analytics errors
  return "low";
}

// Track performance metrics
export function trackPerformanceMetric(
  metric: string,
  value: number,
  context: Record<string, any> = {}
) {
  trackUserAction(`performance_${metric}`, {
    value,
    ...context,
    timestamp: Date.now(),
  });
}

// Initialize enhanced analytics
export function initEnhancedAnalytics() {
  sessionStartTime = Date.now();
  userActions = [];
  errorCountThisSession = 0;
  shortcutUsageCount = 0;
  lastThemeSwitch = undefined;

  console.log("[Enhanced Analytics] Enhanced analytics initialized");
}

// Export current metrics for debugging
export function getAnalyticsMetrics() {
  return {
    sessionDuration: Date.now() - sessionStartTime,
    userActionsCount: userActions.length,
    errorCount: errorCountThisSession,
    shortcutUsage: shortcutUsageCount,
    lastActions: userActions.slice(-5),
  };
}
