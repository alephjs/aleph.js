(function (document) {
  var containerEl = document.createElement("div");
  var hEl = document.createElement("h2");
  var pEl = document.createElement("p");
  var contarinStyle: Partial<CSSStyleDeclaration> = {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "999",
    width: "100%",
    padding: "30px 0",
    margin: "0",
    backgroundColor: "#fff9cc",
    textAlign: "center",
    borderBottom: "1px solid #eee",
    boxShadow: "0 1px 5px rgba(0,0,0,0.1)",
  };
  var hStyle: Partial<CSSStyleDeclaration> = {
    padding: "0",
    margin: "0",
    lineHeight: "1.2",
    fontSize: "24px",
    fontWeight: "700",
    color: "#000",
  };
  var pStyle: Partial<CSSStyleDeclaration> = {
    padding: "6px 0 0 0",
    margin: "0",
    lineHeight: "1.2",
    fontSize: "15px",
    color: "#454545",
  };
  for (var key in contarinStyle) {
    (containerEl.style as any)[key] = contarinStyle[key];
  }
  for (var key in hStyle) {
    (hEl.style as any)[key] = hStyle[key];
  }
  for (var key in pStyle) {
    (pEl.style as any)[key] = pStyle[key];
  }
  // todo: i18n
  // todo: add browser info
  hEl.innerText = "Your browser is out of date!";
  pEl.innerHTML =
    'This site requires <a href="https://caniuse.com/es6-module" style="font-weight:500;color:#000;text-decoration:underline;">ES module</a>, please upgrade your browser.';
  containerEl.appendChild(hEl);
  containerEl.appendChild(pEl);
  document.body.appendChild(containerEl);
})(window.document);
