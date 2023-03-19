/** @jsxImportSource https://esm.sh/v110/solid-js@1.6.12 */
import { Show } from "solid-js";

export type ErrorProps = {
  error: { status?: number; message: string };
  fullscreen?: boolean;
};

export function Err({ error: { status, message }, fullscreen }: ErrorProps) {
  const style = fullscreen
    ? {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      width: "100vw",
      height: "100vh",
      "font-size": "18px",
    }
    : {
      margin: "0",
      padding: "1.5rem 2rem",
      color: "red",
      "font-size": "18px",
    };
  return (
    <div style={style}>
      <Show when={!!status}>
        <strong style={{ "font-weight": "600" }}>{status}</strong>
        <small style={{ opacity: 0.5, padding: "0 6px" }}>-</small>
      </Show>
      {message}
    </div>
  );
}
