import { VERSION } from "../../version.ts";

export class FetchError extends Error {
  public status: number;
  public details: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.status = status;
    this.details = details ?? {};
  }

  static async fromResponse(res: Response): Promise<FetchError> {
    let status = res.status;
    let message = await res.text();
    const details: Record<string, unknown> = {};
    if (message.startsWith("{") && message.endsWith("}")) {
      try {
        const data = JSON.parse(message);
        const { status: maybeStatus, message: maybeMessage, details: maybeDetail, ...rest } = data;
        if (typeof maybeStatus === "number") {
          status = maybeStatus;
        }
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
        if (maybeDetail !== null && typeof maybeDetail === "object" && !Array.isArray(maybeDetail)) {
          Object.assign(details, maybeDetail);
        }
        Object.assign(details, rest);
      } catch (_e) {
        // ignore
      }
    }
    return new FetchError(status, message, details);
  }
}

export class TransformError {
  specifier: string;
  sourceCode: string;
  message: string;
  stack: string;
  constructor(specifier: string, sourceCode: string, message: string, stack: string) {
    this.specifier = specifier;
    this.sourceCode = sourceCode;
    this.message = message;
    this.stack = stack;
  }
}

const style = `
.aleph--error-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: #fff;
  font-family: Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji','Segoe UI Emoji';
}
.aleph--error-modal .box {
  box-sizing: border-box;
  position: relative;
  max-width: 80%;
  max-height: 90%;
  overflow: auto;
  padding: 24px 30px;
  border-radius: 12px;
  border: 2px solid rgba(255, 0, 0, 0.8);
}
.aleph--error-modal pre {
  margin: 0;
  position: relative;
  line-height: 1.4;
}
.aleph--error-modal pre.source {
  margin: 8px 0;
  padding: 12px 0;
  line-height: 1.2;
  background: #f6f6f6;
}
.aleph--error-modal code {
  font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  font-size: 14px;
  color: rgba(255, 0, 0, 1);
}
.aleph--error-modal .actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
}
.aleph--error-modal .actions button {
  padding: 5px 10px;
  border: 1px solid #ddd;
  background-color: #fff;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.2;
  color: #333;
  cursor: pointer;
}
.aleph--error-modal .actions button:hover {
  border-color: #aaa;
  background-color: rgba(255,255,255,0.9);
}
.aleph--error-modal .actions span {
  font-size: 14px;
  line-height: 1;
  color: #454545;
}
.aleph--error-modal .help-links {
  margin: 0;
  margin-top: 21px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  line-height: 1;
  color: #bbb;
  border-top: 1px solid #ddd;
  padding-top: 15px;
}
.aleph--error-modal .help-links strong {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  color: #333;
}
.aleph--error-modal .help-links a {
  color: teal;
  text-decoration: none;
}
.aleph--error-modal .help-links a:hover {
  text-decoration: underline;
}
`;
const helperLinks = `
<div class="help-links">
  <strong>Aleph.js ${VERSION}</strong>
  /
  <a href="https://alephjs.org/docs/error-handling" target="_blank">Documentation</a>
  &middot;
  <a href="https://github.com/alephjs/aleph.js/issues/new" target="_blank">Open Issue</a>
  &middot;
  <a href="https://discord.com/channels/775256646821085215/775259756041601044" target="_blank">Discord Help Channel</a>
</div>
`;
const regStackLoc = /(https?:\/\/localhost:\d+\/.+)(:\d+:\d+)/;

function formatMessage(message: string, type?: string) {
  return message.split("\n").map((line, i) => {
    const ret = line.match(regStackLoc);
    if (ret) {
      const url = new URL(ret[1]);
      line = line.replace(ret[0], `.${url.pathname}${ret[2]}`);
    }
    if (i === 0) {
      if (type) {
        return `<strong>${type} ${line}</strong>`;
      }
      return `<strong>${line}</strong>`;
    }
    return line;
  }).join("\n");
}

function sourceSummary(sourceCode: string, line: number, column: number): string {
  let lines = sourceCode.replaceAll("<", "&lt;").replaceAll(">", "&gt;").split(/\r?\n/).map((val, index) => {
    return String(1 + index).padStart(4, " ") + " | " + val;
  });
  const mark = " ".repeat(4) + " | " + " ".repeat(column) + "^";
  lines = lines.slice(line - 3, line + 2);
  lines.splice(3, 0, mark);
  return lines.join("\n");
}

export function generateErrorHtml(message: string, type?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>${type ?? ""} Error - Aleph.js</title>
    <style>
      body {
        overflow: hidden;
      }
      ${style}
    </style>
  </head>
  <body>
    <div class="aleph--error-modal">
      <div class="box">
        <pre><code>${formatMessage(message, type)}</code></pre>
        <div class="actions">
          <button onclick="location.reload()">Reload</button>
          <button onclick="navigator.clipboard.writeText(document.querySelector('code').innerText).then(()=>{const ss=document.querySelector('.actions > span').style;ss.display='inline';setTimeout(()=>ss.display='none',2000)})">Copy</button>
          <span style="display:none;">Copied!</span>
        </div>
        ${helperLinks}
      </div>
    </div>
  </body>
</html>
`;
}

export function showTransformError(err: TransformError) {
  const message = formatMessage(err.message);
  const stack = err.stack.split("\n").slice(1).filter((v) => !v.includes("wasm://wasm")).join("\n");
  const location = err.message.split(`${err.specifier.replace("\\", "\\\\")}:`)[1]?.split("\n")[0]?.split(":")
    .map((s: string) => parseInt(s));
  const source = sourceSummary(err.sourceCode, location[0], location[1]);
  const modalEl = document.createElement("div");
  modalEl.setAttribute("data-specifier", err.specifier);
  modalEl.className = "aleph--error-modal transform-error";
  modalEl.innerHTML = `
    <div class="box">
      <pre><code>${message}</code></pre>
      <pre class="source"><code>${source}</code></pre>
      <pre><code>${stack}</code></pre>
      ${helperLinks}
    </div>
  `;
  document.body.appendChild(modalEl);
}

if (globalThis.document) {
  const styleEl = document.createElement("style");
  styleEl.appendChild(document.createTextNode(style));
  document.head.appendChild(styleEl);
}
