import events from "./events.ts";

class Module {
  private _specifier: string;
  private _isAccepted: boolean = false;
  private _isLocked: boolean = false;
  private _acceptCallbacks: CallableFunction[] = [];

  get specifier() {
    return this._specifier;
  }

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

  lock(): void {
    this._isLocked = true;
  }

  async applyUpdate(specifier: string) {
    try {
      const module = await import(specifier.slice(1) + "?t=" + Date.now());
      this._acceptCallbacks.forEach((cb) => cb(module));
    } catch (e) {
      location.reload();
    }
  }
}

let modules: Map<string, Module> = new Map();
let messageQueue: string[] = [];
let conn: WebSocket | null = null;

function sendMessage(msg: any) {
  const json = JSON.stringify(msg);
  if (!conn || conn.readyState !== WebSocket.OPEN) {
    messageQueue.push(json);
  } else {
    conn.send(json);
  }
}

export function connect() {
  const { location } = window as any;
  const { protocol, host } = location;
  const wsUrl = (protocol === "https:" ? "wss" : "ws") + "://" + host + "/-/HMR";
  const ws = new WebSocket(wsUrl);
  const contact = (callback: () => void) => {
    setTimeout(() => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener("open", callback);
      ws.addEventListener("close", () => {
        contact(callback); // retry
      });
    }, 500);
  };

  ws.addEventListener("open", () => {
    conn = ws;
    messageQueue.splice(0, messageQueue.length).forEach((msg) => ws.send(msg));
    console.log("[HMR] listening for file changes...");
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
      contact(() => location.reload());
    }
  });

  ws.addEventListener("message", ({ data }: { data?: string }) => {
    if (data) {
      try {
        const { type, specifier, routePattern, refreshPage } = JSON.parse(data);
        if (refreshPage === true) {
          location.reload();
          return;
        }
        switch (type) {
          case "add":
            if (routePattern) {
              events.emit("add-route", { pattern: routePattern, specifier });
            }
            break;
          case "modify":
            const mod = modules.get(specifier);
            if (mod) {
              mod.applyUpdate(specifier);
            }
            break;
          case "remove":
            if (modules.has(specifier)) {
              modules.delete(specifier);
            }
            if (routePattern) {
              events.emit("remove-route", specifier);
            }
            break;
        }
        console.log(`[HMR] ${type} ${JSON.stringify(specifier)}`);
      } catch (err) {
        console.warn(err);
      }
    }
  });
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
