import util from "../../lib/util.ts";
import events from "./events.ts";

// ESM Hot Module Replacement (ESM-HMR) Specification
// https://github.com/withastro/esm-hmr

class Module {
  private _specifier: string;
  private _isAccepted = false;
  private _isDeclined = false;
  private _isLocked = false;
  private _acceptCallbacks: CallableFunction[] = [];
  private _declineDelay = 0;

  constructor(specifier: string) {
    this._specifier = specifier;
  }

  accept(callback?: CallableFunction): void {
    if (this._isLocked) {
      return;
    }
    if (!this._isAccepted) {
      sendMessage({ specifier: this._specifier, type: "hotAccept" });
      this._isAccepted = true;
    }
    if (callback) {
      this._acceptCallbacks.push(callback);
    }
  }

  decline(delay?: number): void {
    this._isDeclined = true;
    if (!Number.isNaN(Number(delay))) {
      this._declineDelay = Math.max(Number(delay), 0);
    }
    this.accept();
  }

  watchFile(filename: string, callback: () => void) {
    const specifier = "." + util.cleanPath(filename);
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
      if (this._declineDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this._declineDelay));
      }
      location.reload();
      return;
    }
    try {
      const url = this._specifier.slice(1) + (this._specifier.endsWith(".css") ? "?module&" : "?") + "t=" + Date.now();
      const module = await import(url);
      this._acceptCallbacks.forEach((cb) => cb(module));
    } catch (err) {
      console.error(err);
      // todo: ui feedback
    }
  }
}

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

const modules: Map<string, Module> = new Map();
const messageQueue: string[] = [];

let conn: WebSocket | null = null;
function sendMessage(msg: Record<string, unknown>) {
  const json = JSON.stringify(msg);
  if (!conn || conn.readyState !== WebSocket.OPEN) {
    messageQueue.push(json);
  } else {
    conn.send(json);
  }
}

function connect() {
  const { location, __hmrWebSocketUrl } = window as { location: Location; __hmrWebSocketUrl?: string };
  const { protocol, host } = location;
  const wsUrl = __hmrWebSocketUrl || `${protocol === "https:" ? "wss" : "ws"}://${host}/-/hmr`;
  const ws = new WebSocket(wsUrl);
  const ping = (callback: () => void) => {
    setTimeout(() => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("open", callback);
      ws.addEventListener("close", () => {
        ping(callback); // retry
      });
    }, 500);
  };

  ws.addEventListener("open", () => {
    conn = ws;
    messageQueue.splice(0, messageQueue.length).forEach((msg) => ws.send(msg));
    console.log("%c[HMR]", "color:#999", "listening for file changes...");
  });

  ws.addEventListener("close", () => {
    if (conn !== null) {
      conn = null;
      console.log("[HMR] closed.");
      // re-connect after 0.5s
      setTimeout(() => {
        connect();
      }, 500);
    } else {
      // reload the page when re-connected
      ping(() => location.reload());
    }
  });

  ws.addEventListener("message", ({ data }: { data?: string }) => {
    if (data) {
      try {
        const { type, specifier, routePattern } = JSON.parse(data);
        switch (type) {
          case "create": {
            events.emit("hmr:create", { specifier, routePattern });
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
          }
        }
        console.log("%c[HMR]", "color:#999", `${type} ${JSON.stringify(specifier)}`);
      } catch (err) {
        console.warn(err);
      }
    }
  });
}

addEventListener("load", connect);
