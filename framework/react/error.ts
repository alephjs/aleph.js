import type { FC, PropsWithChildren } from "react";
import { Component, createElement } from "react";

type ErrorBoundaryProps = PropsWithChildren<{ Handler: FC<{ error: Error }> }>;

export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error instanceof Error) {
      return createElement(this.props.Handler, { error: this.state.error });
    }

    return this.props.children;
  }
}

export function Err(
  { error: { status, message }, fullscreen }: { error: { status?: number; message: string }; fullscreen?: boolean },
) {
  return createElement(
    "div",
    {
      style: fullscreen
        ? {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100vw",
          height: "100vh",
          fontSize: 18,
        }
        : {
          boxSizing: "border-box",
          width: "96%",
          height: "96%",
          margin: "auto",
          border: "1px solid rgba(255,0,0,0.5)",
          backgroundColor: "rgba(255,0,0,0.05)",
          borderRadius: "8px",
          padding: "1.5rem 2rem",
          color: "red",
          textAlign: "center",
        },
    },
    status && createElement("strong", { style: { fontWeight: "600" } }, status),
    status && createElement("small", { style: { opacity: 0.5, padding: "0 6px" } }, "-"),
    message,
  );
}
