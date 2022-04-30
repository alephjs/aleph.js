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
    <title>SSR Error - Aleph.js</title>
    <style>
      body {
        overflow: hidden;
      }
      .error {
        display: flex;
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
        padding: 24px 36px;
        border-radius: 12px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        background-color: rgba(255, 0, 0, 0.1);
        color: rgba(255, 0, 0, 1);
      }
      .error .logo {
        position: absolute;
        top: 50%;
        left: 50%;
        margin-top: -45px;
        margin-left: -45px;
        opacity: 0.1;
      }
      .error pre {
        position: relative;
        line-height: 1.4;
      }
      .error code {
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <div class="error">
      <div class="box">
        <div class="logo">
          <svg width="90" height="90" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M52.9528 11.1C54.0959 11.1 55.1522 11.7097 55.7239 12.6995C68.5038 34.8259 81.2837 56.9524 94.0636 79.0788C94.642 80.0802 94.6355 81.316 94.0425 82.3088C93.0466 83.9762 92.028 85.6661 91.0325 87.3331C90.4529 88.3035 89.407 88.9 88.2767 88.9C62.7077 88.9 37.0519 88.9 11.4828 88.9C10.3207 88.9 9.25107 88.2693 8.67747 87.2586C7.75465 85.6326 6.81025 84.0065 5.88797 82.3805C5.33314 81.4023 5.34422 80.2041 5.90662 79.2302C18.6982 57.0794 31.4919 34.8415 44.3746 12.6907C44.9474 11.7058 46.0009 11.1 47.1402 11.1C49.0554 11.1 51.0005 11.1 52.9528 11.1Z" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linejoin="round"/>
            <path d="M28.2002 72.8H80.8002L45.8187 12.5494" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M71.4999 72.7L45.1999 27.2L10.6519 87.1991" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M49.8 35.3L23.5 80.8H93.9333" stroke="#f00" stroke-width="3.2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <pre><code>${message}</code></pre>
      </div>
    </div>
  </body>
</html>
`;
