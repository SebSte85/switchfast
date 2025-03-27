# Work Focus Manager

A desktop application that helps you manage application focus by grouping them under themes. This allows you to minimize distractions and focus on specific tasks by showing only the relevant applications.

## Features

- Group applications under custom themes
- Switch between themes with a single click
- Minimize all applications not related to the current theme
- Global shortcut (Ctrl+Shift+F) to toggle focus mode
- System tray integration for quick access

## Tech Stack

- **Framework**: Electron JS
- **Frontend**: React with TypeScript
- **Styling**: Tailwind CSS
- **System Integration**: Node.js Native Addons for Windows API access

## Development

### Prerequisites

- Node.js (version 14 or higher)
- npm (version 6 or higher)

### Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the development server:
   ```
   npm run dev
   ```

### Building

To build the application:

```
npm run build
```

To package the application for distribution:

```
npm run package
```

## Project Structure

- `/src/main.ts` - Electron main process
- `/src/renderer` - React frontend
  - `/components` - React components
  - `/styles` - CSS with Tailwind

## License

MIT
# workfocusmanager
