import React, { Component, ErrorInfo, ReactNode } from "react";
import { captureUIException } from "../analytics";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] React Error caught:", error);
    console.error("[ErrorBoundary] Error Info:", errorInfo);

    // Capture the error with PostHog
    captureUIException(error, {
      error_type: "react_error_boundary",
      component_stack: errorInfo.componentStack,
      error_boundary: true,
      fatal: false,
      // Additional React-specific context
      react_error_info: {
        componentStack: errorInfo.componentStack,
        errorBoundary: this.constructor.name,
      },
    });

    // Update state with error details
    this.setState({
      hasError: true,
      error,
      errorInfo,
    });
  }

  public render() {
    if (this.state.hasError) {
      // Fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-8">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
            <div className="flex items-center mb-4">
              <div className="bg-red-100 rounded-full p-2 mr-3">
                <svg
                  className="w-6 h-6 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.054 0 1.955-.816 2.062-1.854L21 12l-.02-.146C20.913 10.816 20.054 10 19 10H5c-1.054 0-1.955.816-2.062 1.854L1 12l.02.146C1.087 13.184 1.946 14 3 14z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">
                Something went wrong
              </h2>
            </div>

            <p className="text-gray-600 mb-6">
              An unexpected error occurred in the application. The error has
              been automatically reported and will be investigated.
            </p>

            <div className="space-y-4">
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
              >
                Reload Application
              </button>

              <button
                onClick={() =>
                  this.setState({
                    hasError: false,
                    error: undefined,
                    errorInfo: undefined,
                  })
                }
                className="w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-md transition-colors"
              >
                Try Again
              </button>
            </div>

            {/* Development details */}
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="mt-6 text-sm">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                  Show Error Details (Development)
                </summary>
                <div className="mt-2 p-3 bg-gray-100 rounded text-xs font-mono overflow-auto max-h-40">
                  <div className="text-red-600 font-bold mb-2">
                    {this.state.error.name}: {this.state.error.message}
                  </div>
                  <div className="text-gray-700 whitespace-pre-wrap">
                    {this.state.error.stack}
                  </div>
                  {this.state.errorInfo && (
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <div className="text-blue-600 font-bold mb-2">
                        Component Stack:
                      </div>
                      <div className="text-gray-700 whitespace-pre-wrap">
                        {this.state.errorInfo.componentStack}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
