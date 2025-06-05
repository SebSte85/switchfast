import { PostHog } from 'posthog-node';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// PostHog client instance
let client: PostHog | null = null;

// User identification
let userId: string = '';
let sessionId: string = '';
const USER_ID_FILE = path.join(os.homedir(), '.workfocusmanager', 'analytics_user_id.txt');

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
      const storedId = fs.readFileSync(USER_ID_FILE, 'utf8').trim();
      if (storedId && storedId.length > 0) {
        return storedId;
      }
    }

    // Create new ID if none exists
    const newId = uuidv4();
    fs.writeFileSync(USER_ID_FILE, newId);
    return newId;
  } catch (error) {
    console.error('[Analytics] Error getting/creating user ID:', error);
    // Fallback to hostname-based ID if file operations fail
    return 'user-' + os.hostname() + '-' + Math.random().toString(36).substring(2, 9);
  }
}

// Initialize PostHog with your project API key
export function initAnalytics() {
  try {
    // Get persistent user ID
    userId = getUserId();
    
    // Create new session ID for this app instance
    sessionId = uuidv4();
    
    client = new PostHog(
      'phc_oMabWAWOtEF4LwFnSOzvx4nbm4OtoIQIHOYTS03E4TK',
      {
        host: 'https://eu.i.posthog.com'
      }
    );
    
    // Track app start event with session info
    trackEvent('app_started', {
      session_id: sessionId
    });
    
    console.log('[Analytics] PostHog client initialized successfully with user ID:', userId);
  } catch (error) {
    console.error('[Analytics] Failed to initialize PostHog client:', error);
  }
}

// Track an event
export function trackEvent(eventName: string, properties: Record<string, any> = {}) {
  if (!client) {
    console.warn('[Analytics] Cannot track event, PostHog client not initialized');
    return;
  }

  try {
    // Use the persistent user ID
    const distinctId = userId || 'anonymous-user';
    
    // Add session ID and timestamp to all events
    const enhancedProperties = {
      ...properties,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      app_version: process.env.npm_package_version || '0.1.1', // Get app version from package.json
      os_platform: os.platform(),
      os_release: os.release()
    };
    
    // Track the event
    client.capture({
      distinctId,
      event: eventName,
      properties: enhancedProperties
    });
    
    console.log(`[Analytics] Event tracked: ${eventName} for user ${distinctId.substring(0, 8)}...`);
  } catch (error) {
    console.error(`[Analytics] Failed to track event ${eventName}:`, error);
  }
}

// Shutdown analytics when the app is closing
export function shutdownAnalytics() {
  if (client) {
    try {
      client.shutdown();
      console.log('[Analytics] PostHog client shut down successfully');
    } catch (error) {
      console.error('[Analytics] Error shutting down PostHog client:', error);
    }
    client = null;
  }
}
