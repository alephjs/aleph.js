const regStackLoc = /(http:\/\/localhost:60\d{2}\/.+)(:\d+:\d+)/;

export const errorHtml = (message: string, prefix?: string): string => {
  return errorTemplate(
    message.split("\n").map((line, i) => {
      const ret = line.match(regStackLoc);
      if (ret) {
        const url = new URL(ret[1]);
        line = line.replace(ret[0], `.${url.pathname}${ret[2]}`);
      }
      if (i === 0 && prefix) {
        return `<strong>${prefix} ${line}</strong>`;
      }
      return line;
    }).join("\n"),
  );
};

const errorTemplate = (message: string) => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>SSR Error - Aleph.js</title>
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
        padding: 24px 32px;
        border-radius: 12px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        background-color: rgba(255, 0, 0, 0.1);
      }
      .error .logo {
        position: absolute;
        top: 50%;
        left: 50%;
        margin-top: -36px;
        margin-left: -36px;
        opacity: 0.1;
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
        gap: 4px;
        margin-top: 12px;
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
        border-color: #ccc;
        background-color: rgba(255,255,255,0.9);
      }
      .error .actions span {
        font-size: 14px;
        line-height: 1;
        color: #454545;
      }
      .help-links {
        margin: 0;
        margin-top: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        line-height: 1;
        color: #ccc;
      }
      .help-links strong {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        color: #888;
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
        <div class="logo">
          <svg width="72" height="72" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M52.9528 11.1C54.0959 11.1 55.1522 11.7097 55.7239 12.6995C68.5038 34.8259 81.2837 56.9524 94.0636 79.0788C94.642 80.0802 94.6355 81.316 94.0425 82.3088C93.0466 83.9762 92.028 85.6661 91.0325 87.3331C90.4529 88.3035 89.407 88.9 88.2767 88.9C62.7077 88.9 37.0519 88.9 11.4828 88.9C10.3207 88.9 9.25107 88.2693 8.67747 87.2586C7.75465 85.6326 6.81025 84.0065 5.88797 82.3805C5.33314 81.4023 5.34422 80.2041 5.90662 79.2302C18.6982 57.0794 31.4919 34.8415 44.3746 12.6907C44.9474 11.7058 46.0009 11.1 47.1402 11.1C49.0554 11.1 51.0005 11.1 52.9528 11.1Z" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linejoin="round"/>
            <path d="M28.2002 72.8H80.8002L45.8187 12.5494" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M71.4999 72.7L45.1999 27.2L10.6519 87.1991" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M49.8 35.3L23.5 80.8H93.9333" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <pre><code>${message}</code></pre>
        <div class="actions">
          <button onclick="location.reload()">Reload</button>
          <button onclick="navigator.clipboard.writeText(document.querySelector('code').innerText).then(()=>{const ss=document.querySelector('.actions > span').style;ss.display='inline';setTimeout(()=>ss.display='none',2000)})">Copy</button>
          <span style="display:none;">Copied!</span>
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
  </body>
</html>
`;
