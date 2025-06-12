import posthog from "posthog-js";

// PostHog client instance for renderer process
let initialized = false;
let userId: string = "";

// Initialize PostHog for renderer process
export function initRendererAnalytics() {
  try {
    // Use anonymous userId for renderer - the main process handles user identification
    userId = "renderer-process";

    // Initialize PostHog with the same configuration as main process + session replay
    posthog.init("phc_oMabWAWOtEF4LwFnSOzvx4nbm4OtoIQIHOYTS03E4TK", {
      api_host: "https://eu.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false, // Disable automatic pageview tracking
      capture_pageleave: false, // Disable automatic pageleave tracking
      // Enable session replay
      session_recording: {
        maskAllInputs: false, // Don't mask inputs by default (can be configured per project)
        maskInputOptions: {
          // Mask sensitive input types
          password: true,
          email: false, // Allow email for better support
        },
        maskTextSelector: "[data-posthog-mask]", // Use data attribute to mask specific elements
        blockSelector: "[data-posthog-block]", // Use data attribute to block specific elements
      },
      loaded: (posthog) => {
        console.log(
          "[Renderer Analytics] PostHog initialized successfully with session replay enabled"
        );
        initialized = true;
      },
    });

    console.log(
      "[Renderer Analytics] Initialization started with session replay"
    );
  } catch (error) {
    console.error("[Renderer Analytics] Failed to initialize:", error);
  }
}

// Track events from renderer process
export function trackUIEvent(
  eventName: string,
  properties: Record<string, any> = {}
) {
  if (!initialized) {
    console.warn("[Renderer Analytics] PostHog not initialized yet");
    return;
  }

  try {
    const enhancedProperties = {
      ...properties,
      process_type: "renderer",
      timestamp: new Date().toISOString(),
      url: window.location.href,
      user_agent: navigator.userAgent,
      screen_resolution: `${screen.width}x${screen.height}`,
    };

    posthog.capture(eventName, enhancedProperties);
    console.log(`[Renderer Analytics] Event tracked: ${eventName}`);
  } catch (error) {
    console.error(
      `[Renderer Analytics] Failed to track event ${eventName}:`,
      error
    );
  }
}

// Capture exceptions from renderer process
export function captureUIException(
  error: Error,
  context: Record<string, any> = {},
  level: "error" | "warning" | "info" = "error"
) {
  if (!initialized) {
    console.warn(
      "[Renderer Analytics] PostHog not initialized yet, logging error locally"
    );
    console.error("[Renderer Analytics] UI Exception:", error);
    return;
  }

  try {
    const errorProperties = {
      // Error details
      error_message: error.message,
      error_name: error.name,
      error_stack: error.stack,

      // Context information
      ...context,

      // Renderer-specific info
      process_type: "renderer",
      timestamp: new Date().toISOString(),
      url: window.location.href,
      user_agent: navigator.userAgent,
      screen_resolution: `${screen.width}x${screen.height}`,
      error_level: level,

      // Browser/window info
      window_inner_width: window.innerWidth,
      window_inner_height: window.innerHeight,
      is_focused: document.hasFocus(),
      visibility_state: document.visibilityState,
    };

    // Use PostHog's exception capture with Error Tracking structure
    posthog.capture("$exception", {
      ...errorProperties,
      // PostHog Error Tracking specific properties
      $exception_type: error.name,
      $exception_message: error.message,
      $exception_stack_trace_raw: error.stack,
      $exception_fingerprint: `${error.name}:${
        context.component || context.function || "renderer"
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
                        lang: "javascript",
                        resolved: true,
                      };
                    }

                    return {
                      filename: "unknown",
                      function: "anonymous",
                      line: 0,
                      column: 0,
                      in_app: true,
                      lang: "javascript",
                      resolved: false,
                    };
                  })
              : [],
          },
        },
      ],
    });

    console.log(`[Renderer Analytics] UI Exception captured: ${error.message}`);
  } catch (captureError) {
    console.error(
      "[Renderer Analytics] Failed to capture UI exception:",
      captureError
    );
    console.error("[Renderer Analytics] Original error was:", error);
  }
}

// Capture custom UI errors
export function captureUIError(
  message: string,
  context: Record<string, any> = {},
  level: "error" | "warning" | "info" = "error"
) {
  const syntheticError = new Error(message);
  captureUIException(syntheticError, context, level);
}

// Setup global error handlers for renderer process
export function setupUIErrorHandlers() {
  // Handle uncaught JavaScript errors
  window.addEventListener("error", (event) => {
    console.error("[Renderer Global] JavaScript Error:", event.error);
    captureUIException(event.error || new Error(event.message), {
      error_type: "javascript_error",
      filename: event.filename,
      line_number: event.lineno,
      column_number: event.colno,
      fatal: false,
    });
  });

  // Handle unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    console.error(
      "[Renderer Global] Unhandled Promise Rejection:",
      event.reason
    );

    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    captureUIException(error, {
      error_type: "unhandled_promise_rejection",
      promise_rejection: true,
      fatal: false,
    });
  });

  console.log("[Renderer Analytics] Global UI error handlers initialized");
}

// Shutdown analytics when renderer is closing
export function shutdownRendererAnalytics() {
  try {
    if (initialized) {
      // PostHog web SDK doesn't need explicit shutdown
      initialized = false;
      console.log("[Renderer Analytics] Shutdown completed");
    }
  } catch (error) {
    console.error("[Renderer Analytics] Error during shutdown:", error);
  }
}
