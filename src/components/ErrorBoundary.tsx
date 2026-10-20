import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught FinFolio error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center p-6 bg-neutral-950 text-neutral-200">
          <div className="max-w-md w-full bg-neutral-900 border border-rose-500/30 rounded-2xl p-6 text-center shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Something went wrong in this view
              </h2>
              <p className="text-xs text-neutral-400 mt-1">
                An unexpected rendering error occurred. Your local financial
                vault data remains completely safe.
              </p>
              {this.state.error && (
                <details className="mt-3 text-left">
                  <summary className="text-[11px] font-mono text-neutral-400 cursor-pointer hover:text-neutral-200">
                    Technical Error Details
                  </summary>
                  <pre className="mt-1.5 p-2.5 rounded-lg bg-neutral-950 text-[10px] text-rose-300 font-mono overflow-x-auto border border-neutral-800">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-semibold text-xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload Workspace</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
