#include <napi.h>
#include <windows.h>
#include <psapi.h>
#include <tlhelp32.h>
#include <vector>
#include <string>
#include <memory>

struct WindowInfo {
    HWND hwnd;
    DWORD processId;
    std::wstring title;
};

std::vector<WindowInfo> windows;

BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    if (!IsWindowVisible(hwnd)) return TRUE;
    
    // Get window title
    wchar_t title[256];
    GetWindowTextW(hwnd, title, sizeof(title)/sizeof(wchar_t));
    if (wcslen(title) == 0) return TRUE;  // Skip windows without title
    
    // Get process ID for this window
    DWORD processId;
    GetWindowThreadProcessId(hwnd, &processId);
    
    // Store window info
    WindowInfo info = {
        hwnd,
        processId,
        std::wstring(title)
    };
    windows.push_back(info);
    
    return TRUE;
}

Napi::Array GetWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    windows.clear();
    
    // Enumerate all windows
    EnumWindows(EnumWindowsProc, 0);
    
    // Convert to JavaScript array
    Napi::Array result = Napi::Array::New(env, windows.size());
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Object window = Napi::Object::New(env);
        window.Set("hwnd", Napi::Number::New(env, (double)windows[i].hwnd));
        window.Set("processId", Napi::Number::New(env, windows[i].processId));
        
        // Convert wide string to utf8
        int utf8Length = WideCharToMultiByte(CP_UTF8, 0, windows[i].title.c_str(), -1, nullptr, 0, nullptr, nullptr);
        std::vector<char> utf8Title(utf8Length);
        WideCharToMultiByte(CP_UTF8, 0, windows[i].title.c_str(), -1, utf8Title.data(), utf8Length, nullptr, nullptr);
        window.Set("title", Napi::String::New(env, utf8Title.data()));
        
        result[i] = window;
    }
    
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getProcesses", Napi::Function::New(env, GetProcesses));
    exports.Set("getWindows", Napi::Function::New(env, GetWindows));
    // ... other existing exports ...
    return exports;
} 