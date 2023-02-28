// ESM Hot Module Replacement (ESM-HMR) Specification
// https://github.com/withastro/esm-hmr

import { cleanPath } from "../../shared/util.ts";
import events from "./events.ts";

const modules: Map<string, Module> = new Map();
const messageQueue: string[] = [];

class Module {
  private _specifier: string;
  private _isAccepted = false;
  private _isDeclined = false;
  private _isLocked = false;
  private _data: Record<string, unknown> = {};
  private _acceptCallbacks: CallableFunction[] = [];
  private _disposeCallbacks: CallableFunction[] = [];

  constructor(specifier: string) {
    this._specifier = specifier;
  }

  get data(): Record<string, unknown> {
    return this._data;
  }

  accept(callback?: CallableFunction): void {
    if (this._isLocked) {
      return;
    }
    if (!this._isAccepted) {
      sendMessage({ specifier: this._specifier, type: "hotAccept" });
      this._isAccepted = true;
    }
    if (typeof callback === "function") {
      this._acceptCallbacks.push(callback);
    }
  }

  decline(): void {
    this._isDeclined = true;
    this.accept();
  }

  dispose(callback: CallableFunction) {
    if (typeof callback === "function") {
      this._disposeCallbacks.push(callback);
    }
  }

  invalidate(): void {
    location.reload();
  }

  watchFile(filename: string, callback: () => void) {
    const specifier = "." + cleanPath(filename);
    const handler = (data: Record<string, unknown>) => {
      if (data.specifier === specifier) {
        callback();
      }
    };
    events.on("hmr:modify", handler);
    sendMessage({ specifier, type: "hotAccept" });
    return () => events.off("hmr:modify", handler);
  }

  // don't accept updates if the module is locked
  lock(): void {
    this._isLocked = true;
  }

  async applyUpdate() {
    if (this._isDeclined) {
      location.reload();
      return;
    }

    const disposeCallbacks = this._disposeCallbacks;
    const data = this._data;
    this._disposeCallbacks = [];
    this._data = {};
    disposeCallbacks.map((callback) => callback(data));

    try {
      const url = new URL(this._specifier.slice(1), location.href);
      url.searchParams.set("t", Date.now().toString(36));
      if (url.pathname.endsWith(".css")) {
        url.searchParams.set("module", "");
      }
      const module = await import(url.href);
      this._acceptCallbacks.forEach((cb) => cb(module));
    } catch (err) {
      console.error(err);
    }
  }
}

let ws: WebSocket | null = null;
function sendMessage(msg: Record<string, unknown>) {
  const json = JSON.stringify(msg);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    messageQueue.push(json);
  } else {
    ws.send(json);
  }
}

function connect() {
  const { location, __hmrWebSocketUrl } = window as { location: Location; __hmrWebSocketUrl?: string };
  const { protocol, host } = location;
  const wsUrl = __hmrWebSocketUrl || `${protocol === "https:" ? "wss" : "ws"}://${host}/-/hmr`;
  const socket = new WebSocket(wsUrl);
  const ping = (callback: () => void) => {
    setTimeout(() => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("open", callback);
      ws.addEventListener("error", () => {
        ping(callback); // retry
      });
    }, 500);
  };
  const colors = {
    modify: "#056CF0",
    create: "#20B44B",
    remove: "#F00C08",
  };

  socket.addEventListener("open", () => {
    ws = socket;
    messageQueue.splice(0, messageQueue.length).forEach((msg) => socket.send(msg));
    console.log("%c[HMR]", "color:#999", "listening for file changes...");
  });

  socket.addEventListener("close", () => {
    if (ws !== null) {
      ws = null;
      console.log("[HMR] closed.");
      // try to re-connect one time
      connect();
    } else {
      // ping to reload the page
      ping(() => location.reload());
    }
  });

  socket.addEventListener("message", ({ data }: { data?: string }) => {
    if (data) {
      try {
        const { type, specifier, ...rest } = JSON.parse(data);
        if (specifier) {
          for (const node of document.body.children) {
            if (
              node.classList.contains("transform-error") &&
              node.getAttribute("data-specifier") === specifier
            ) {
              node.remove();
              break;
            }
          }
        }
        switch (type) {
          case "create": {
            events.emit("hmr:create", { specifier, ...rest });
            break;
          }
          case "modify": {
            const mod = modules.get(specifier);
            if (mod) {
              mod.applyUpdate();
            }
            events.emit("hmr:modify", { specifier });
            break;
          }
          case "remove": {
            if (modules.has(specifier)) {
              modules.delete(specifier);
            }
            events.emit("hmr:remove", { specifier });
            break;
          }
          case "reload": {
            location.reload();
            break;
          }
        }
        console.log(
          `%c[HMR] %c${type}`,
          "color:#999",
          `color:${colors[type as keyof typeof colors]}`,
          `${JSON.stringify(specifier)}`,
        );
      } catch (err) {
        console.warn(err);
      }
    }
  });
}

globalThis.addEventListener("load", connect);

export default function createHotContext(specifier: string) {
  if (modules.has(specifier)) {
    const mod = modules.get(specifier)!;
    mod.lock();
    return mod;
  }
  const mod = new Module(specifier);
  modules.set(specifier, mod);
  return mod;
}
