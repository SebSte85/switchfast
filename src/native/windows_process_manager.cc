#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <vector>
#include <string>

// Helper function to convert wide string to UTF8
std::string WideToUTF8(const std::wstring& wstr) {
  if (wstr.empty()) return std::string();
  int size_needed = WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), NULL, 0, NULL, NULL);
  std::string strTo(size_needed, 0);
  WideCharToMultiByte(CP_UTF8, 0, &wstr[0], (int)wstr.size(), &strTo[0], size_needed, NULL, NULL);
  return strTo;
}

// Function to get all running processes with window titles
Napi::Array GetRunningApplications(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  // Get all process IDs
  DWORD processes[1024], cbNeeded, cProcesses;
  if (!EnumProcesses(processes, sizeof(processes), &cbNeeded)) {
    return result;
  }

  // Calculate how many process identifiers were returned
  cProcesses = cbNeeded / sizeof(DWORD);
  int resultIndex = 0;

  // For each process, get its windows and title
  for (unsigned int i = 0; i < cProcesses; i++) {
    if (processes[i] != 0) {
      HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processes[i]);
      if (hProcess != NULL) {
        WCHAR processName[MAX_PATH] = L"<unknown>";
        
        // Get the process name
        if (GetModuleFileNameExW(hProcess, 0, processName, MAX_PATH) > 0) {
          // Extract only the file name from the path
          WCHAR* fileName = wcsrchr(processName, L'\\');
          if (fileName != NULL) {
            fileName++; // Move past the backslash
          } else {
            fileName = processName;
          }

          // Create a JavaScript object for this process
          Napi::Object processObj = Napi::Object::New(env);
          processObj.Set("id", Napi::Number::New(env, static_cast<double>(processes[i])));
          processObj.Set("name", Napi::String::New(env, WideToUTF8(fileName)));
          processObj.Set("title", Napi::String::New(env, ""));
          processObj.Set("path", Napi::String::New(env, WideToUTF8(processName)));

          result[resultIndex++] = processObj;
        }
        CloseHandle(hProcess);
      }
    }
  }

  return result;
}

// Function to minimize a window by process ID
Napi::Boolean MinimizeApplication(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Process ID expected").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  
  DWORD processId = static_cast<DWORD>(info[0].As<Napi::Number>().Int32Value());
  bool success = false;
  
  // Enumerate windows to find the one associated with the process ID
  BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    DWORD windowProcessId;
    GetWindowThreadProcessId(hwnd, &windowProcessId);
    if (windowProcessId == processId && IsWindowVisible(hwnd)) {
      ShowWindow(hwnd, SW_MINIMIZE);
      *reinterpret_cast<bool*>(lParam) = true;
      return FALSE; // Stop enumeration
    }
    return TRUE; // Continue enumeration
  }
  
  EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&success));
  return Napi::Boolean::New(env, success);
}

// Initialize the native addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getRunningApplications", Napi::Function::New(env, GetRunningApplications));
  exports.Set("minimizeApplication", Napi::Function::New(env, MinimizeApplication));
  return exports;
}

NODE_API_MODULE(windows_process_manager, Init) 