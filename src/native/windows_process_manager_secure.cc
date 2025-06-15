#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <vector>
#include <string>
#include <memory>
#include <limits>

// 🛡️ SECURITY: Constants for safe buffer sizes
const DWORD MAX_PROCESSES = 4096;  // Increased from fixed 1024
const DWORD MAX_FILENAME_LENGTH = 32768;  // Increased from MAX_PATH (260)

/**
 * 🛡️ SECURITY: Safe helper function to convert wide string to UTF8
 * Prevents buffer overflows and handles errors gracefully
 */
std::string SafeWideToUTF8(const std::wstring& wstr) {
  if (wstr.empty()) {
    return std::string();
  }

  // 🛡️ SECURITY: Validate input length to prevent integer overflow
  if (wstr.size() > static_cast<size_t>(std::numeric_limits<int>::max())) {
    return std::string("<path_too_long>");
  }

  try {
    // Calculate required buffer size
    int size_needed = WideCharToMultiByte(
      CP_UTF8, 0, 
      wstr.c_str(), 
      static_cast<int>(wstr.size()), 
      nullptr, 0, 
      nullptr, nullptr
    );

    if (size_needed <= 0) {
      return std::string("<conversion_failed>");
    }

    // 🛡️ SECURITY: Check for reasonable buffer size limits
    if (size_needed > 65536) {  // Max 64KB output
      return std::string("<path_too_long>");
    }

    // 🛡️ SECURITY: Use vector for safe dynamic allocation
    std::vector<char> buffer(size_needed);
    
    int result = WideCharToMultiByte(
      CP_UTF8, 0,
      wstr.c_str(),
      static_cast<int>(wstr.size()),
      buffer.data(),
      size_needed,
      nullptr, nullptr
    );

    if (result <= 0) {
      return std::string("<conversion_failed>");
    }

    return std::string(buffer.data(), result);

  } catch (const std::exception&) {
    return std::string("<exception_during_conversion>");
  }
}

/**
 * 🛡️ SECURITY: Safe process name retrieval with bounds checking
 */
std::wstring SafeGetProcessName(HANDLE hProcess) {
  try {
    // 🛡️ SECURITY: Use dynamic buffer instead of fixed MAX_PATH
    std::vector<WCHAR> processName(MAX_FILENAME_LENGTH);
    
    DWORD result = GetModuleFileNameExW(
      hProcess, 
      nullptr, 
      processName.data(), 
      static_cast<DWORD>(processName.size())
    );

    if (result == 0) {
      return L"<unknown>";
    }

    // 🛡️ SECURITY: Null-terminate explicitly
    if (result < processName.size()) {
      processName[result] = L'\0';
    } else {
      processName[processName.size() - 1] = L'\0';
    }

    return std::wstring(processName.data());

  } catch (const std::exception&) {
    return L"<exception_getting_name>";
  }
}

/**
 * 🛡️ SECURITY: Enhanced function to get running processes with overflow protection
 */
Napi::Array GetRunningApplicationsSecure(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  try {
    // 🛡️ SECURITY: Use dynamic allocation instead of fixed buffer
    std::vector<DWORD> processes(MAX_PROCESSES);
    DWORD cbNeeded, cProcesses;

    if (!EnumProcesses(processes.data(), 
                       static_cast<DWORD>(processes.size() * sizeof(DWORD)), 
                       &cbNeeded)) {
      // Return empty array on failure instead of crashing
      return result;
    }

    // 🛡️ SECURITY: Validate returned buffer size
    if (cbNeeded > processes.size() * sizeof(DWORD)) {
      cbNeeded = static_cast<DWORD>(processes.size() * sizeof(DWORD));
    }

    cProcesses = cbNeeded / sizeof(DWORD);
    
    // 🛡️ SECURITY: Additional bounds check
    if (cProcesses > MAX_PROCESSES) {
      cProcesses = MAX_PROCESSES;
    }

    uint32_t resultIndex = 0;
    const uint32_t MAX_RESULTS = 1000;  // Limit results to prevent DoS

    // Process each PID with error handling
    for (DWORD i = 0; i < cProcesses && resultIndex < MAX_RESULTS; i++) {
      if (processes[i] == 0) {
        continue;  // Skip invalid PIDs
      }

      try {
        // 🛡️ SECURITY: Use minimal required privileges
        HANDLE hProcess = OpenProcess(
          PROCESS_QUERY_LIMITED_INFORMATION, 
          FALSE, 
          processes[i]
        );

        if (hProcess == nullptr) {
          continue;  // Skip processes we can't access
        }

        // 🛡️ SECURITY: RAII for automatic handle cleanup
        struct ProcessHandleGuard {
          HANDLE handle;
          ProcessHandleGuard(HANDLE h) : handle(h) {}
          ~ProcessHandleGuard() { if (handle) CloseHandle(handle); }
        } guard(hProcess);

        // Get process name safely
        std::wstring processPath = SafeGetProcessName(hProcess);
        
        if (processPath == L"<unknown>" || processPath.empty()) {
          continue;  // Skip processes without accessible names
        }

        // Extract filename from path safely
        size_t lastSlash = processPath.find_last_of(L'\\');
        std::wstring fileName = (lastSlash != std::wstring::npos) 
          ? processPath.substr(lastSlash + 1) 
          : processPath;

        // 🛡️ SECURITY: Validate filename length
        if (fileName.length() > 255) {
          fileName = fileName.substr(0, 255);
        }

        // Create JavaScript object with error handling
        Napi::Object processObj = Napi::Object::New(env);
        
        // 🛡️ SECURITY: Validate PID range before converting to double
        if (processes[i] > static_cast<DWORD>(std::numeric_limits<int32_t>::max())) {
          continue;  // Skip PIDs that don't fit in safe range
        }

        processObj.Set("id", Napi::Number::New(env, static_cast<double>(processes[i])));
        processObj.Set("name", Napi::String::New(env, SafeWideToUTF8(fileName)));
        processObj.Set("title", Napi::String::New(env, ""));
        processObj.Set("path", Napi::String::New(env, SafeWideToUTF8(processPath)));

        result[resultIndex++] = processObj;

      } catch (const std::exception&) {
        // Skip this process and continue with others
        continue;
      }
    }

    return result;

  } catch (const std::exception&) {
    // Return empty array instead of crashing on any exception
    return Napi::Array::New(env);
  }
}

/**
 * 🛡️ SECURITY: Secure data structure for window enumeration
 */
struct SecureEnumWindowsData {
  DWORD targetProcessId;
  bool found;
  uint32_t windowCount;  // Prevent infinite loops
  static const uint32_t MAX_WINDOWS = 100;
  
  SecureEnumWindowsData(DWORD pid) : targetProcessId(pid), found(false), windowCount(0) {}
};

/**
 * 🛡️ SECURITY: Protected callback with bounds checking
 */
BOOL CALLBACK SecureEnumWindowsProc(HWND hwnd, LPARAM lParam) {
  try {
    SecureEnumWindowsData* data = reinterpret_cast<SecureEnumWindowsData*>(lParam);
    
    // 🛡️ SECURITY: Prevent infinite enumeration
    if (data->windowCount++ >= SecureEnumWindowsData::MAX_WINDOWS) {
      return FALSE;  // Stop enumeration
    }

    // 🛡️ SECURITY: Validate window handle
    if (!IsWindow(hwnd)) {
      return TRUE;  // Continue with next window
    }

    DWORD windowProcessId = 0;
    DWORD threadId = GetWindowThreadProcessId(hwnd, &windowProcessId);
    
    // 🛡️ SECURITY: Validate thread and process IDs
    if (threadId == 0 || windowProcessId == 0) {
      return TRUE;  // Continue enumeration
    }

    if (windowProcessId == data->targetProcessId && IsWindowVisible(hwnd)) {
      // 🛡️ SECURITY: Verify window can be minimized safely
      if (GetWindowLong(hwnd, GWL_STYLE) & WS_MINIMIZEBOX) {
        ShowWindow(hwnd, SW_MINIMIZE);
        data->found = true;
      }
      return FALSE;  // Stop enumeration after first match
    }

    return TRUE;  // Continue enumeration

  } catch (const std::exception&) {
    return FALSE;  // Stop enumeration on any exception
  }
}

/**
 * 🛡️ SECURITY: Enhanced minimize function with validation
 */
Napi::Boolean MinimizeApplicationSecure(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  try {
    // 🛡️ SECURITY: Validate input parameters
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "Valid process ID required").ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
    
    double pidDouble = info[0].As<Napi::Number>().DoubleValue();
    
    // 🛡️ SECURITY: Validate PID range
    if (pidDouble < 1 || pidDouble > static_cast<double>(std::numeric_limits<int32_t>::max())) {
      Napi::TypeError::New(env, "Process ID out of valid range").ThrowAsJavaScriptException();
      return Napi::Boolean::New(env, false);
    }
    
    DWORD processId = static_cast<DWORD>(pidDouble);
    
    // 🛡️ SECURITY: Verify process exists and is accessible
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (hProcess == nullptr) {
      return Napi::Boolean::New(env, false);  // Process not accessible
    }
    CloseHandle(hProcess);
    
    // Perform secure window enumeration
    SecureEnumWindowsData data(processId);
    EnumWindows(SecureEnumWindowsProc, reinterpret_cast<LPARAM>(&data));
    
    return Napi::Boolean::New(env, data.found);

  } catch (const std::exception&) {
    return Napi::Boolean::New(env, false);
  }
}

/**
 * 🛡️ SECURITY: Secure module initialization
 */
Napi::Object InitSecure(Napi::Env env, Napi::Object exports) {
  try {
    exports.Set("getRunningApplications", 
                Napi::Function::New(env, GetRunningApplicationsSecure));
    exports.Set("minimizeApplication", 
                Napi::Function::New(env, MinimizeApplicationSecure));
    
    // Add version info for security tracking
    exports.Set("securityVersion", Napi::String::New(env, "1.0.0-secure"));
    exports.Set("lastSecurityUpdate", Napi::String::New(env, "2024-01-XX"));
    
    return exports;

  } catch (const std::exception&) {
    // Return empty exports on initialization failure
    return Napi::Object::New(env);
  }
}

NODE_API_MODULE(windows_process_manager_secure, InitSecure)