import type { Router } from "../framework/core/router.ts";
import { importRouteModule } from "./routing.ts";

// the runtime script for client-side application
export const runtimeScript = `
const e=s=>new Error('module "'+s+'" not found');
const g=(s)=>{
  if(imports.has(s)){
    const m=imports.get(s);
    if(m instanceof Promise) throw e(s);
    return m;
  }
  throw e(s);
};
const i=async(s)=>{
  if(imports.has(s)){
    let m=imports.get(s);
    if(m instanceof Promise){
      m=await m;
      imports.set(s,m);
    }
   return m;
  }
  const v=document.body.getAttribute("data-deployment-id");
  const p=import(s.slice(1)+(v?"?v="+v:""));
  imports.set(s,p);
  return p.then(m=>{imports.set(s,m);return m}).catch(e=>{imports.delete(s);throw e})
};
window.__aleph={getRouteModule:g,importRouteModule:i};
`.split("\n").map((l) => l.trim()).join("");

// the _runtime_ for server-side rendering
Reflect.set(globalThis, "__aleph", {
  getRouteModule: () => {
    throw new Error("only available in client-side");
  },
  importRouteModule: async (filename: string) => {
    let router: Router | Promise<Router> | undefined = Reflect.get(globalThis, "__ALEPH_ROUTER");
    if (router) {
      if (router instanceof Promise) {
        router = await router;
      }
      const route = router.routes.find(([, meta]) => meta.filename === filename);
      if (route) {
        return importRouteModule(route[1]);
      }
    }
    return importRouteModule({ filename, pattern: { pathname: "" } });
  },
});
