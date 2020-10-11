var el = document.createElement('div')
var style = {
    position: 'fixed',
    top: '0',
    left: '0',
    zIndex: '999',
    width: '100%',
    margin: '0',
    padding: '30px 0',
    lineHeight: '1.5',
    fontSize: '14px',
    color: '#666',
    backgroundColor: '#fff9cc',
    textAlign: 'center',
    boxShadow: '0 1px 5px rgba(0,0,0,0.1)'
}
for (var key in style) {
    el.style[key] = style[key]
}
var scripts = document.getElementsByTagName('script')
var isDev = false
for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]
    if (/nomodule\.js\?dev$/.test(s.src)) {
        isDev = true
    }
}
el.innerHTML = '<h2 style="margin:0;paddding:0;line-height:1;font-size:24px;font-weight:700;color:#000;">Your browser is out of date.</h2>'
if (!isDev) {
    el.innerHTML += '<p>Aleph.js requires <a href="https://caniuse.com/es6-module" style="font-weight:500;color:#000;">ES module</a> support during development.</p>'
} else {
    el.innerHTML += '<p>Update your browser for more security, speed and the best experience on this site.</p>'
}
document.body.appendChild(el)
