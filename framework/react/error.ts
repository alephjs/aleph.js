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
    if (this.state.error) {
      return createElement(this.props.Handler, { error: this.state.error });
    }

    return this.props.children;
  }
}

export function Err({ status, statusText }: { status: number; statusText: string }) {
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        fontSize: 16,
      },
    },
    createElement("strong", { style: { fontWeight: "500" } }, status),
    createElement("small", { style: { color: "#999", padding: "0 6px" } }, "-"),
    statusText,
  );
}
