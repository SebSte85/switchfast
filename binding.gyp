{
  "targets": [
    {
      "target_name": "windows_process_manager",
      "sources": [ "src/native/windows_process_manager.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "user32.lib" ]
        }],
        ["OS!='win'", {
          "type": "none"
        }]
      ]
    }
  ]
} 