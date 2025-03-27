import { join } from "path";

interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path: string;
}

// Try to load the native addon, but provide fallbacks if it fails
let windowsProcessManager: {
  getRunningApplications: () => ProcessInfo[];
  minimizeApplication: (processId: number) => boolean;
};

try {
  // Load the compiled addon
  windowsProcessManager = require(join(
    __dirname,
    "../../build/Release/windows_process_manager.node"
  ));
} catch (err) {
  console.error("Failed to load native addon:", err);

  // Provide mock implementations for testing/development
  windowsProcessManager = {
    getRunningApplications: () => {
      console.warn("Using mock implementation of getRunningApplications");
      return [
        {
          id: 1,
          name: "chrome.exe",
          title: "Google Chrome",
          path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        },
        {
          id: 2,
          name: "firefox.exe",
          title: "Mozilla Firefox",
          path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
        },
        {
          id: 3,
          name: "code.exe",
          title: "Visual Studio Code",
          path: "C:\\Program Files\\Microsoft VS Code\\code.exe",
        },
      ];
    },
    minimizeApplication: (processId: number) => {
      console.warn(
        `Using mock implementation of minimizeApplication for process ${processId}`
      );
      return true;
    },
  };
}

export const getRunningApplications = (): ProcessInfo[] => {
  return windowsProcessManager.getRunningApplications();
};

export const minimizeApplication = (processId: number): boolean => {
  return windowsProcessManager.minimizeApplication(processId);
};

export default {
  getRunningApplications,
  minimizeApplication,
};
