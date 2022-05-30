import events from "./events.ts";

const modal = document.createElement("div");
document.body.appendChild(modal);
modal.className = "aleph--error-modal";
modal.style.display = "none";

const errorTemplate = (message: string, sourceCode: string, stack: string) => `
<div class="error">
  <div class="box">
  <!--<div class="logo">
      <svg width="72" height="72" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M52.9528 11.1C54.0959 11.1 55.1522 11.7097 55.7239 12.6995C68.5038 34.8259 81.2837 56.9524 94.0636 79.0788C94.642 80.0802 94.6355 81.316 94.0425 82.3088C93.0466 83.9762 92.028 85.6661 91.0325 87.3331C90.4529 88.3035 89.407 88.9 88.2767 88.9C62.7077 88.9 37.0519 88.9 11.4828 88.9C10.3207 88.9 9.25107 88.2693 8.67747 87.2586C7.75465 85.6326 6.81025 84.0065 5.88797 82.3805C5.33314 81.4023 5.34422 80.2041 5.90662 79.2302C18.6982 57.0794 31.4919 34.8415 44.3746 12.6907C44.9474 11.7058 46.0009 11.1 47.1402 11.1C49.0554 11.1 51.0005 11.1 52.9528 11.1Z" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linejoin="round"/>
        <path d="M28.2002 72.8H80.8002L45.8187 12.5494" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M71.4999 72.7L45.1999 27.2L10.6519 87.1991" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M49.8 35.3L23.5 80.8H93.9333" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div> -->
    ${
  message !== "unreachable"
    ? `<pre><div class="msg">${message}<div></pre>
    <pre><code>${sourceCode}</code></pre>
    <pre><div class="stack-info">${stack}</div></pre>
    `
    : `<div class="extend-box"> unreachable </div>`
}
    <div class="actions">
    </div>
  </div>
  <div class="help-links">
    <strong>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" width="14" height="14" preserveAspectRatio="xMidYMid meet" viewBox="0 0 1024 1024"><path fill="currentColor" d="m759.936 805.248l-90.944-91.008A254.912 254.912 0 0 1 512 768a254.912 254.912 0 0 1-156.992-53.76l-90.944 91.008A382.464 382.464 0 0 0 512 896c94.528 0 181.12-34.176 247.936-90.752zm45.312-45.312A382.464 382.464 0 0 0 896 512c0-94.528-34.176-181.12-90.752-247.936l-91.008 90.944C747.904 398.4 768 452.864 768 512c0 59.136-20.096 113.6-53.76 156.992l91.008 90.944zm-45.312-541.184A382.464 382.464 0 0 0 512 128c-94.528 0-181.12 34.176-247.936 90.752l90.944 91.008A254.912 254.912 0 0 1 512 256c59.136 0 113.6 20.096 156.992 53.76l90.944-91.008zm-541.184 45.312A382.464 382.464 0 0 0 128 512c0 94.528 34.176 181.12 90.752 247.936l91.008-90.944A254.912 254.912 0 0 1 256 512c0-59.136 20.096-113.6 53.76-156.992l-91.008-90.944zm417.28 394.496a194.56 194.56 0 0 0 22.528-22.528C686.912 602.56 704 559.232 704 512a191.232 191.232 0 0 0-67.968-146.56A191.296 191.296 0 0 0 512 320a191.232 191.232 0 0 0-146.56 67.968C337.088 421.44 320 464.768 320 512a191.232 191.232 0 0 0 67.968 146.56C421.44 686.912 464.768 704 512 704c47.296 0 90.56-17.088 124.032-45.44zM512 960a448 448 0 1 1 0-896a448 448 0 0 1 0 896z"></path></svg>
      Get Help:
    </strong>
    <a href="https://alephjs.org/docs/error-handling" target="_blank">Documentations</a>
    |
    <a href="https://github.com/alephjs/aleph.js/issues/new" target="_blank">Open Issue</a>
    |
    <a href="https://discord.com/channels/775256646821085215/775259756041601044" target="_blank">Discord Help Channel</a>
  </div>
</div>
`;

events.on("transform", (e) => {
  if (e.status === "failure") {
    const err = e.error as { message: string; stack: string; location: Array<number> };
    const code = formatCode(err.message, e.sourceCode as string, err.location[1], err.location[0]);
    const stack = err.stack.split("\n").map((v) => v.trim());
    const stackStr = stack.filter((v) => !v.includes("wasm://wasm")).reduce((res, cur) => res + "\n" + cur);
    modal.innerHTML = errorTemplate(err.message, code, stackStr);
    modal.style.display = "block";
  } else {
    modal.style.display = "none";
  }
});

function formatCode(message: string, sourceCode: string, column: number, line: number): string {
  if (message === "unreachable") {
    return message;
  }
  let sourceCodeArr = sourceCode.split(/\r?\n/).map((val, index) => {
    return 1 + index + " | " + val;
  });
  const indexLen = line.toString().length;
  const mark = " ".repeat(indexLen * 2) + " | " + " ".repeat(column) + "^";
  sourceCodeArr = sourceCodeArr.slice(line - 3, line + 2);
  sourceCodeArr.splice(3, 0, mark);
  const formatStr = sourceCodeArr.reduce((res, cur) => res + "\r\n" + cur);
  return formatStr;
}

const styleEl = document.createElement("style");
styleEl.appendChild(document.createTextNode(`
.aleph--error-modal {
  position: fixed;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
  background: white;
  /* todo: support dark mode */
}
.aleph--error-modal .error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
}
.aleph--error-modal .error .box {
  box-sizing: border-box;
  position: relative;
  max-width: 60%;
  max-height: 90%;
  overflow: auto;
  padding: 24px 32px;
  border-radius: 12px;
  border: 2px solid rgba(255, 0, 0, 0.8);
  background-color: rgba(255, 0, 0, 0.1);
}
.aleph--error-modal .error .logo {
  position: absolute;
  top: 50%;
  left: 50%;
  margin-top: -36px;
  margin-left: -36px;
  opacity: 0.1;
}
.aleph--error-modal .error pre {
  margin: 0;
  position: relative;
  line-height: 1.4;
}
.aleph--error-modal .error code {
  font-size: 14px;
  color: rgba(255, 0, 0, 1);
}
.aleph--error-modal .error .actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
}
.aleph--error-modal .error .actions button {
  padding: 5px 10px;
  border: 1px solid #ddd;
  background-color: #fff;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.2;
  color: #333;
  cursor: pointer;
}
.aleph--error-modal .error .actions button:hover {
  border-color: #ccc;
  background-color: rgba(255,255,255,0.9);
}
.aleph--error-modal .error .actions span {
  font-size: 14px;
  line-height: 1;
  color: #454545;
}
.aleph--error-modal .error .help-links {
  margin: 0;
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  line-height: 1;
  color: #ccc;
}
.aleph--error-modal .error .help-links strong {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  color: #888;
}
.aleph--error-modal .error .help-links a {
  color: teal;
  text-decoration: none;
}
.aleph--error-modal .error .help-links a:hover {
  text-decoration: underline;
}
.aleph--error-modal .msg{
  margin-bottom: 20px;
  text-decoration-line: underline;
  color: #b13939;
  word-break:break-word;
  white-space: pre-wrap;
}
.aleph--error-modal .stack-info{
  margin-left: 20px;
  margin-top: 28px;
  color: #777;
  line-height: 23px;
  font-size: 15px;
}
.aleph--error-modal .extend-box{
  width:450px;
  height:200px;
  display:flex;
  justify-content:center;
  align-items:center;
  color: #b13939;
  font-size:20px;
}
`));
document.head.appendChild(styleEl);
