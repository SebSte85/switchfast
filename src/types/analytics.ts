// Error tracking interfaces for better type safety and structured data

export interface ErrorContext {
  // Function/Component information
  function?: string;
  component?: string;
  method?: string;

  // User action context
  user_action?: string;
  last_user_actions?: string[];

  // Application state
  theme_id?: string;
  active_theme?: string;
  shortcuts_registered?: number;

  // Process information
  process_ids?: number[];
  window_handles?: number[];

  // Error classification
  error_category?:
    | "ui"
    | "ipc"
    | "system"
    | "licensing"
    | "shortcuts"
    | "analytics";
  error_severity?: "low" | "medium" | "high" | "critical";
  error_frequency?: "rare" | "occasional" | "frequent" | "persistent";

  // Technical context
  stack_trace_hash?: string;
  error_fingerprint?: string;

  // Additional metadata
  [key: string]: any;
}

export interface ApplicationState {
  themes_count: number;
  active_shortcuts: number;
  running_processes: number;
  last_action: string;
  app_uptime: number;
  license_status: "active" | "trial" | "expired" | "unknown";
}

export interface UserBehavior {
  session_duration: number;
  actions_performed: string[];
  last_theme_switch?: string;
  shortcut_usage_count: number;
  error_count_this_session: number;
}

export interface SystemInfo {
  cpu_usage?: number;
  memory_usage_mb: number;
  disk_space_available?: number;
  network_status?: "online" | "offline";
  screen_resolution: string;
  window_size?: string;
}

export interface ErrorMetadata {
  // Timing information
  timestamp: string;
  session_id: string;
  error_id: string;

  // Application context
  app_state: Partial<ApplicationState>;
  user_behavior: Partial<UserBehavior>;
  system_info: Partial<SystemInfo>;

  // Error context
  error_context: ErrorContext;

  // Process type
  process_type: "main" | "renderer";

  // Environment
  environment: "development" | "test" | "production";
}
