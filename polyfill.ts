export const nomoduleJS = (isDev: boolean) => {
    const indent = isDev ? '     ' : ''
    const eol = isDev ? '\n' : ''
    let title = 'Your browser is out of date.'
    let desc = 'Update your browser for more security, speed and the best experience on this site.'
    if (isDev) {
        desc = 'Aleph.js requires <a href="https://caniuse.com/es6-module" style="font-weight:500;color:#000;">ES module</a> support during development.'
    }
    return [
        ``,
        `var el = document.querySelector("main");`,
        `var style = {`,
        `${indent}position: "fixed",`,
        `${indent}top: "50%",`,
        `${indent}left: "5%",`,
        `${indent}width: "90%",`,
        `${indent}height: "24px",`,
        `${indent}marginTop: "-12px",`,
        `${indent}lineHeight: "24px",`,
        `${indent}fontSize: "14px",`,
        `${indent}color: "#666",`,
        `${indent}textAlign: "center"`,
        '};',
        `el.innerHTML = '<p><strong style="font-size:24px;font-weight:700;color:#000;">${title}</strong><br>${desc}</p>';`,
        `for (var key in style) {`,
        `${indent}el.style[key] = style[key];`,
        `}`,
    ].join(eol + indent.repeat(2)) + eol + indent
}
