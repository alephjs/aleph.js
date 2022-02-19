import { Component, createElement, type CSSProperties } from "https://esm.sh/react@17.0.2";

type Props = Record<never, never>;

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  componentDidCatch(error: Error) {
    this.setState({ error });
  }

  render() {
    const { error } = this.state;

    // todo: error UI
    if (error !== null) {
      return createElement(
        "pre",
        null,
        error.stack || error.message || error.toString(),
      );
    }

    return this.props.children;
  }
}

export function E404Page() {
  return createElement(
    StatusError,
    {
      status: 404,
      message: "Page Not Found",
    },
  );
}

const resetStyle: CSSProperties = {
  padding: 0,
  margin: 0,
  lineHeight: 1.5,
};

export function StatusError({ status, message }: { status: number; message: string }) {
  return (
    createElement(
      "div",
      {
        style: {
          ...resetStyle,
          position: "fixed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          width: "100vw",
          height: "100vh",
        },
      },
      createElement(
        "p",
        {
          style: {
            ...resetStyle,
            fontFamily: "sans-serif",
            fontSize: 15,
            fontWeight: 500,
            color: "#333",
          },
        },
        createElement(
          "code",
          {
            style: {
              fontFamily: "monospace",
              fontWeight: 700,
            },
          },
          status,
        ),
        createElement(
          "small",
          {
            style: {
              fontSize: 14,
              color: "#999",
            },
          },
          " - ",
        ),
        createElement(
          "span",
          null,
          message,
        ),
      ),
    )
  );
}
