import { VERSION } from "../version.ts";

export type ErrorCallback = {
  (
    error: unknown,
    cause: {
      by: "route-data-fetch" | "ssr" | "transplie" | "fs" | "middleware";
      url: string;
      context?: Record<string, unknown>;
    },
  ): Response | void;
};

export const generateErrorHtml = (message: string, type?: string): string => {
  const formatMessage = message.split("\n").map((line, i) => {
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
  return errorTemplate(formatMessage, type);
};

const regStackLoc = /(http:\/\/localhost:60\d{2}\/.+)(:\d+:\d+)/;
const errorTemplate = (message: string, type?: string) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>${type} Error - Aleph.js</title>
    <style>
      body {
        overflow: hidden;
      }
      .error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100vw;
        height: 100vh;
      }
      .error .box {
        box-sizing: border-box;
        position: relative;
        max-width: 80%;
        max-height: 90%;
        overflow: auto;
        padding: 24px 30px;
        border-radius: 12px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        background-color: rgba(255, 0, 0, 0.05);
      }
      .error pre {
        margin: 0;
        position: relative;
        line-height: 1.4;
      }
      .error code {
        font-size: 14px;
        color: rgba(255, 0, 0, 1);
      }
      .error .actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 18px;
      }
      .error .actions button {
        padding: 5px 10px;
        border: 1px solid #ddd;
        background-color: #fff;
        border-radius: 6px;
        font-size: 14px;
        line-height: 1.2;
        color: #333;
        cursor: pointer;
      }
      .error .actions button:hover {
        border-color: #aaa;
        background-color: rgba(255,255,255,0.9);
      }
      .error .actions span {
        font-size: 14px;
        line-height: 1;
        color: #454545;
      }
      .help-links {
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
      .help-links strong {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: #333;
      }
      .help-links a {
        color: teal;
        text-decoration: none;
      }
      .help-links a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div class="error">
      <div class="box">
        <pre><code>${message}</code></pre>
        <div class="actions">
          <button onclick="location.reload()">Reload</button>
          <button onclick="navigator.clipboard.writeText(document.querySelector('code').innerText).then(()=>{const ss=document.querySelector('.actions > span').style;ss.display='inline';setTimeout(()=>ss.display='none',2000)})">Copy</button>
          <span style="display:none;">Copied!</span>
        </div>
        <div class="help-links">
          <strong>Aleph.js ${VERSION}</strong>
          /
          <a href="https://alephjs.org/docs/error-handling" target="_blank">Documentation</a>
          &middot;
          <a href="https://github.com/alephjs/aleph.js/issues/new" target="_blank">Open Issue</a>
          &middot;
          <a href="https://discord.com/channels/775256646821085215/775259756041601044" target="_blank">Discord Help Channel</a>
        </div>
      </div>
    </div>
  </body>
</html>
`;
