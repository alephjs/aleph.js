import { microtask } from "./snippets/leptos_reactive-81881a7e036355c6/inline0.js";

let wasm;

const heap = new Array(32).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) {
  return heap[idx];
}

let heap_next = heap.length;

function dropObject(idx) {
  if (idx < 36) return;
  heap[idx] = heap_next;
  heap_next = idx;
}

function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];

  heap[idx] = obj;
  return idx;
}

const cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

let cachedUint8Memory0 = new Uint8Array();

function getUint8Memory0() {
  if (cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8Memory0;
}

function getStringFromWasm0(ptr, len) {
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = new TextEncoder("utf-8");

const encodeString = typeof cachedTextEncoder.encodeInto === "function"
  ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
  }
  : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length,
    };
  };

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length);
    getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  let len = arg.length;
  let ptr = malloc(len);

  const mem = getUint8Memory0();

  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7F) break;
    mem[ptr + offset] = code;
  }

  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3);
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
    const ret = encodeString(arg, view);

    offset += ret.written;
  }

  WASM_VECTOR_LEN = offset;
  return ptr;
}

function isLikeNone(x) {
  return x === undefined || x === null;
}

let cachedInt32Memory0 = new Int32Array();

function getInt32Memory0() {
  if (cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
  }
  return cachedInt32Memory0;
}

let cachedFloat64Memory0 = new Float64Array();

function getFloat64Memory0() {
  if (cachedFloat64Memory0.byteLength === 0) {
    cachedFloat64Memory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64Memory0;
}

function debugString(val) {
  // primitive types
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  // objects
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  // Test for built-in
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val);
  }
  if (className == "Object") {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  // errors
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`;
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className;
}

function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor };
  const real = (...args) => {
    // First up with a closure we increment the internal reference
    // count. This ensures that the Rust closure environment won't
    // be deallocated while we're invoking it.
    state.cnt++;
    const a = state.a;
    state.a = 0;
    try {
      return f(a, state.b, ...args);
    } finally {
      if (--state.cnt === 0) {
        wasm.__wbindgen_export_2.get(state.dtor)(a, state.b);
      } else {
        state.a = a;
      }
    }
  };
  real.original = state;

  return real;
}
function __wbg_adapter_42(arg0, arg1, arg2) {
  wasm
    ._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h29da209ad8066b6e(
      arg0,
      arg1,
      addHeapObject(arg2),
    );
}

function __wbg_adapter_45(arg0, arg1, arg2) {
  wasm
    ._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h0fc9b87f4f4f080b(
      arg0,
      arg1,
      addHeapObject(arg2),
    );
}

function __wbg_adapter_48(arg0, arg1) {
  wasm
    ._dyn_core__ops__function__FnMut_____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h87da1e4d44d4c0f6(
      arg0,
      arg1,
    );
}

function __wbg_adapter_51(arg0, arg1, arg2) {
  wasm
    ._dyn_core__ops__function__FnMut__A____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h31b66f45526a1889(
      arg0,
      arg1,
      addHeapObject(arg2),
    );
}

/** */
export function hydrate() {
  wasm.hydrate();
}

function getCachedStringFromWasm0(ptr, len) {
  if (ptr === 0) {
    return getObject(len);
  } else {
    return getStringFromWasm0(ptr, len);
  }
}

function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}

async function load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        if (module.headers.get("Content-Type") != "application/wasm") {
          console.warn(
            "`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",
            e,
          );
        } else {
          throw e;
        }
      }
    }

    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}

function getImports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbindgen_object_drop_ref = function (arg0) {
    takeObject(arg0);
  };
  imports.wbg.__wbindgen_object_clone_ref = function (arg0) {
    const ret = getObject(arg0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_string_new = function (arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_new_abda76e883ba8a5f = function () {
    const ret = new Error();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_stack_658279fe44541cf6 = function (arg0, arg1) {
    const ret = getObject(arg1).stack;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_error_f851667af71bcfc6 = function (arg0, arg1) {
    var v0 = getCachedStringFromWasm0(arg0, arg1);
    if (arg0 !== 0) wasm.__wbindgen_free(arg0, arg1);
    console.error(v0);
  };
  imports.wbg.__wbindgen_string_get = function (arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof (obj) === "string" ? obj : undefined;
    var ptr0 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbindgen_number_get = function (arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof (obj) === "number" ? obj : undefined;
    getFloat64Memory0()[arg0 / 8 + 1] = isLikeNone(ret) ? 0 : ret;
    getInt32Memory0()[arg0 / 4 + 0] = !isLikeNone(ret);
  };
  imports.wbg.__wbindgen_cb_drop = function (arg0) {
    const obj = takeObject(arg0).original;
    if (obj.cnt-- == 1) {
      obj.a = 0;
      return true;
    }
    const ret = false;
    return ret;
  };
  imports.wbg.__wbindgen_jsval_eq = function (arg0, arg1) {
    const ret = getObject(arg0) === getObject(arg1);
    return ret;
  };
  imports.wbg.__wbindgen_is_string = function (arg0) {
    const ret = typeof (getObject(arg0)) === "string";
    return ret;
  };
  imports.wbg.__wbindgen_boolean_get = function (arg0) {
    const v = getObject(arg0);
    const ret = typeof (v) === "boolean" ? (v ? 1 : 0) : 2;
    return ret;
  };
  imports.wbg.__wbindgen_is_undefined = function (arg0) {
    const ret = getObject(arg0) === undefined;
    return ret;
  };
  imports.wbg.__wbindgen_is_null = function (arg0) {
    const ret = getObject(arg0) === null;
    return ret;
  };
  imports.wbg.__wbindgen_is_falsy = function (arg0) {
    const ret = !getObject(arg0);
    return ret;
  };
  imports.wbg.__wbg_microtask_e1a0d982210eec0c = function (arg0) {
    microtask(takeObject(arg0));
  };
  imports.wbg.__wbindgen_is_object = function (arg0) {
    const val = getObject(arg0);
    const ret = typeof (val) === "object" && val !== null;
    return ret;
  };
  imports.wbg.__wbindgen_in = function (arg0, arg1) {
    const ret = getObject(arg0) in getObject(arg1);
    return ret;
  };
  imports.wbg.__wbindgen_error_new = function (arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_jsval_loose_eq = function (arg0, arg1) {
    const ret = getObject(arg0) == getObject(arg1);
    return ret;
  };
  imports.wbg.__wbg_getwithrefkey_15c62c2b8546208d = function (arg0, arg1) {
    const ret = getObject(arg0)[getObject(arg1)];
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_instanceof_Window_acc97ff9f5d2c7b4 = function (arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof Window;
    } catch {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_document_3ead31dbcad65886 = function (arg0) {
    const ret = getObject(arg0).document;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_location_8cc8ccf27e342c0a = function (arg0) {
    const ret = getObject(arg0).location;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_history_2a104346a1208269 = function () {
    return handleError(function (arg0) {
      const ret = getObject(arg0).history;
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_scrollTo_24e7a0eef59d4eae = function (arg0, arg1, arg2) {
    getObject(arg0).scrollTo(arg1, arg2);
  };
  imports.wbg.__wbg_body_3cb4b4042b9a632b = function (arg0) {
    const ret = getObject(arg0).body;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_createComment_0df3a4d0d91032e7 = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).createComment(v0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_createDocumentFragment_5962b3834280cda6 = function (arg0) {
    const ret = getObject(arg0).createDocumentFragment();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_createElement_976dbb84fe1661b5 = function () {
    return handleError(function (arg0, arg1, arg2) {
      var v0 = getCachedStringFromWasm0(arg1, arg2);
      const ret = getObject(arg0).createElement(v0);
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_createTextNode_300f845fab76642f = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).createTextNode(v0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_createTreeWalker_bcc5b6f8b327b704 = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = getObject(arg0).createTreeWalker(getObject(arg1), arg2 >>> 0);
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_getElementById_3a708b83e4f034d7 = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).getElementById(v0);
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_querySelector_3628dc2c3319e7e0 = function () {
    return handleError(function (arg0, arg1, arg2) {
      var v0 = getCachedStringFromWasm0(arg1, arg2);
      const ret = getObject(arg0).querySelector(v0);
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_ctrlKey_4795fb55a59f026c = function (arg0) {
    const ret = getObject(arg0).ctrlKey;
    return ret;
  };
  imports.wbg.__wbg_shiftKey_81014521a7612e6a = function (arg0) {
    const ret = getObject(arg0).shiftKey;
    return ret;
  };
  imports.wbg.__wbg_altKey_2b8d6d80ead4bad7 = function (arg0) {
    const ret = getObject(arg0).altKey;
    return ret;
  };
  imports.wbg.__wbg_metaKey_49e49046d8402fb7 = function (arg0) {
    const ret = getObject(arg0).metaKey;
    return ret;
  };
  imports.wbg.__wbg_button_2bb5dc0116d6b89b = function (arg0) {
    const ret = getObject(arg0).button;
    return ret;
  };
  imports.wbg.__wbg_origin_a97d94952e7f5286 = function (arg0, arg1) {
    const ret = getObject(arg1).origin;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_pathname_78a642e573bf8169 = function (arg0, arg1) {
    const ret = getObject(arg1).pathname;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_search_afb25c63fe262036 = function (arg0, arg1) {
    const ret = getObject(arg1).search;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_searchParams_8f54380784e8678c = function (arg0) {
    const ret = getObject(arg0).searchParams;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_hash_5ca9e2d439e2b3e1 = function (arg0, arg1) {
    const ret = getObject(arg1).hash;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_newwithbase_41b4a8c94dd8c467 = function () {
    return handleError(function (arg0, arg1, arg2, arg3) {
      var v0 = getCachedStringFromWasm0(arg0, arg1);
      var v1 = getCachedStringFromWasm0(arg2, arg3);
      const ret = new URL(v0, v1);
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_append_76004a0382979f53 = function () {
    return handleError(function (arg0, arg1) {
      getObject(arg0).append(getObject(arg1));
    }, arguments);
  };
  imports.wbg.__wbg_target_bf704b7db7ad1387 = function (arg0) {
    const ret = getObject(arg0).target;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_defaultPrevented_a1e45724c362df78 = function (arg0) {
    const ret = getObject(arg0).defaultPrevented;
    return ret;
  };
  imports.wbg.__wbg_cancelBubble_8c0bdf21c08f1717 = function (arg0) {
    const ret = getObject(arg0).cancelBubble;
    return ret;
  };
  imports.wbg.__wbg_composedPath_160ed014dc4d787f = function (arg0) {
    const ret = getObject(arg0).composedPath();
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_preventDefault_3209279b490de583 = function (arg0) {
    getObject(arg0).preventDefault();
  };
  imports.wbg.__wbg_addEventListener_cbe4c6f619b032f3 = function () {
    return handleError(function (arg0, arg1, arg2, arg3) {
      var v0 = getCachedStringFromWasm0(arg1, arg2);
      getObject(arg0).addEventListener(v0, getObject(arg3));
    }, arguments);
  };
  imports.wbg.__wbg_instanceof_Node_b1195878cdeab85c = function (arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof Node;
    } catch {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_parentNode_e397bbbe28be7b28 = function (arg0) {
    const ret = getObject(arg0).parentNode;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_childNodes_7345d62ab4ea541a = function (arg0) {
    const ret = getObject(arg0).childNodes;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_previousSibling_e2836743927a00ac = function (arg0) {
    const ret = getObject(arg0).previousSibling;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_nextSibling_62338ec2a05607b4 = function (arg0) {
    const ret = getObject(arg0).nextSibling;
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_textContent_77bd294928962f93 = function (arg0, arg1) {
    const ret = getObject(arg1).textContent;
    var ptr0 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_appendChild_e513ef0e5098dfdd = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg0).appendChild(getObject(arg1));
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_cloneNode_b03caed5a5610386 = function () {
    return handleError(function (arg0) {
      const ret = getObject(arg0).cloneNode();
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_getAttribute_3a1f0fb396184372 = function (arg0, arg1, arg2, arg3) {
    var v0 = getCachedStringFromWasm0(arg2, arg3);
    const ret = getObject(arg1).getAttribute(v0);
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
  };
  imports.wbg.__wbg_hasAttribute_a9fb6bc740fe4146 = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).hasAttribute(v0);
    return ret;
  };
  imports.wbg.__wbg_removeAttribute_beaed7727852af78 = function () {
    return handleError(function (arg0, arg1, arg2) {
      var v0 = getCachedStringFromWasm0(arg1, arg2);
      getObject(arg0).removeAttribute(v0);
    }, arguments);
  };
  imports.wbg.__wbg_scrollIntoView_897fef39b36b90fb = function (arg0) {
    getObject(arg0).scrollIntoView();
  };
  imports.wbg.__wbg_before_0e00e39de571c250 = function () {
    return handleError(function (arg0, arg1) {
      getObject(arg0).before(getObject(arg1));
    }, arguments);
  };
  imports.wbg.__wbg_remove_a8fdc690909ea566 = function (arg0) {
    getObject(arg0).remove();
  };
  imports.wbg.__wbg_setdata_b8bf872bfb7d95ea = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    getObject(arg0).data = v0;
  };
  imports.wbg.__wbg_before_0209443acdd57603 = function () {
    return handleError(function (arg0, arg1) {
      getObject(arg0).before(getObject(arg1));
    }, arguments);
  };
  imports.wbg.__wbg_remove_b3e830ae5c0cd4d3 = function (arg0) {
    getObject(arg0).remove();
  };
  imports.wbg.__wbg_pushState_38917fb88b4add30 = function () {
    return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
      var v0 = getCachedStringFromWasm0(arg2, arg3);
      var v1 = getCachedStringFromWasm0(arg4, arg5);
      getObject(arg0).pushState(getObject(arg1), v0, v1);
    }, arguments);
  };
  imports.wbg.__wbg_replaceState_b6d5ce07beb296ed = function () {
    return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
      var v0 = getCachedStringFromWasm0(arg2, arg3);
      var v1 = getCachedStringFromWasm0(arg4, arg5);
      getObject(arg0).replaceState(getObject(arg1), v0, v1);
    }, arguments);
  };
  imports.wbg.__wbg_debug_f15cb542ea509609 = function (arg0) {
    console.debug(getObject(arg0));
  };
  imports.wbg.__wbg_error_ef9a0be47931175f = function (arg0) {
    console.error(getObject(arg0));
  };
  imports.wbg.__wbg_info_2874fdd5393f35ce = function (arg0) {
    console.info(getObject(arg0));
  };
  imports.wbg.__wbg_log_4b5638ad60bdc54a = function (arg0) {
    console.log(getObject(arg0));
  };
  imports.wbg.__wbg_warn_58110c4a199df084 = function (arg0) {
    console.warn(getObject(arg0));
  };
  imports.wbg.__wbg_origin_486b350035be1f11 = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg1).origin;
      const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      getInt32Memory0()[arg0 / 4 + 1] = len0;
      getInt32Memory0()[arg0 / 4 + 0] = ptr0;
    }, arguments);
  };
  imports.wbg.__wbg_pathname_4441d4d8fc4aba51 = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg1).pathname;
      const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      getInt32Memory0()[arg0 / 4 + 1] = len0;
      getInt32Memory0()[arg0 / 4 + 0] = ptr0;
    }, arguments);
  };
  imports.wbg.__wbg_search_4aac147f005678e5 = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg1).search;
      const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      getInt32Memory0()[arg0 / 4 + 1] = len0;
      getInt32Memory0()[arg0 / 4 + 0] = ptr0;
    }, arguments);
  };
  imports.wbg.__wbg_hash_8565e7b1ae1f2be4 = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg1).hash;
      const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len0 = WASM_VECTOR_LEN;
      getInt32Memory0()[arg0 / 4 + 1] = len0;
      getInt32Memory0()[arg0 / 4 + 0] = ptr0;
    }, arguments);
  };
  imports.wbg.__wbg_length_4b03cbe342879df8 = function (arg0) {
    const ret = getObject(arg0).length;
    return ret;
  };
  imports.wbg.__wbg_nextNode_7ae292530ae1d51e = function () {
    return handleError(function (arg0) {
      const ret = getObject(arg0).nextNode();
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_instanceof_HtmlAnchorElement_b43a9199096faf6f = function (arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof HTMLAnchorElement;
    } catch {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_target_a84cc2ab8af6d620 = function (arg0, arg1) {
    const ret = getObject(arg1).target;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_href_b3ed72d738c58414 = function (arg0, arg1) {
    const ret = getObject(arg1).href;
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbg_get_57245cc7d7c7619d = function (arg0, arg1) {
    const ret = getObject(arg0)[arg1 >>> 0];
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_length_6e3bbe7c8bd4dbd8 = function (arg0) {
    const ret = getObject(arg0).length;
    return ret;
  };
  imports.wbg.__wbindgen_is_function = function (arg0) {
    const ret = typeof (getObject(arg0)) === "function";
    return ret;
  };
  imports.wbg.__wbg_newnoargs_b5b063fc6c2f0376 = function (arg0, arg1) {
    var v0 = getCachedStringFromWasm0(arg0, arg1);
    const ret = new Function(v0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_next_579e583d33566a86 = function (arg0) {
    const ret = getObject(arg0).next;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_next_aaef7c8aa5e212ac = function () {
    return handleError(function (arg0) {
      const ret = getObject(arg0).next();
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_done_1b73b0672e15f234 = function (arg0) {
    const ret = getObject(arg0).done;
    return ret;
  };
  imports.wbg.__wbg_value_1ccc36bc03462d71 = function (arg0) {
    const ret = getObject(arg0).value;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_iterator_6f9d4f28845f426c = function () {
    const ret = Symbol.iterator;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_get_765201544a2b6869 = function () {
    return handleError(function (arg0, arg1) {
      const ret = Reflect.get(getObject(arg0), getObject(arg1));
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_call_97ae9d8645dc388b = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg0).call(getObject(arg1));
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_self_6d479506f72c6a71 = function () {
    return handleError(function () {
      const ret = self.self;
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_window_f2557cc78490aceb = function () {
    return handleError(function () {
      const ret = window.window;
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_globalThis_7f206bda628d5286 = function () {
    return handleError(function () {
      const ret = globalThis.globalThis;
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_global_ba75c50d1cf384f4 = function () {
    return handleError(function () {
      const ret = global.global;
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_decodeURI_159ad535a80ddd7b = function () {
    return handleError(function (arg0, arg1) {
      var v0 = getCachedStringFromWasm0(arg0, arg1);
      const ret = decodeURI(v0);
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_isArray_27c46c67f498e15d = function (arg0) {
    const ret = Array.isArray(getObject(arg0));
    return ret;
  };
  imports.wbg.__wbg_instanceof_ArrayBuffer_e5e48f4762c5610b = function (arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof ArrayBuffer;
    } catch {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_call_168da88779e35f61 = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
      return addHeapObject(ret);
    }, arguments);
  };
  imports.wbg.__wbg_isSafeInteger_dfa0593e8d7ac35a = function (arg0) {
    const ret = Number.isSafeInteger(getObject(arg0));
    return ret;
  };
  imports.wbg.__wbg_entries_65a76a413fc91037 = function (arg0) {
    const ret = Object.entries(getObject(arg0));
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_is_40a66842732708e7 = function (arg0, arg1) {
    const ret = Object.is(getObject(arg0), getObject(arg1));
    return ret;
  };
  imports.wbg.__wbg_exec_e9f97ba649607eb9 = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).exec(v0);
    return isLikeNone(ret) ? 0 : addHeapObject(ret);
  };
  imports.wbg.__wbg_new_fd2d6b3f72d175bc = function (arg0, arg1, arg2, arg3) {
    var v0 = getCachedStringFromWasm0(arg0, arg1);
    var v1 = getCachedStringFromWasm0(arg2, arg3);
    const ret = new RegExp(v0, v1);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_test_7345ae9cf0cf89dc = function (arg0, arg1, arg2) {
    var v0 = getCachedStringFromWasm0(arg1, arg2);
    const ret = getObject(arg0).test(v0);
    return ret;
  };
  imports.wbg.__wbg_replace_19d23e4b7e395b94 = function (arg0, arg1, arg2, arg3) {
    var v0 = getCachedStringFromWasm0(arg2, arg3);
    const ret = getObject(arg0).replace(getObject(arg1), v0);
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_buffer_3f3d764d4747d564 = function (arg0) {
    const ret = getObject(arg0).buffer;
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_new_8c3f0052272a457a = function (arg0) {
    const ret = new Uint8Array(getObject(arg0));
    return addHeapObject(ret);
  };
  imports.wbg.__wbg_set_83db9690f9353e79 = function (arg0, arg1, arg2) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0);
  };
  imports.wbg.__wbg_length_9e1ae1900cb0fbd5 = function (arg0) {
    const ret = getObject(arg0).length;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Uint8Array_971eeda69eb75003 = function (arg0) {
    let result;
    try {
      result = getObject(arg0) instanceof Uint8Array;
    } catch {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_set_bf3f89b92d5a34bf = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbindgen_debug_string = function (arg0, arg1) {
    const ret = debugString(getObject(arg1));
    const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len0;
    getInt32Memory0()[arg0 / 4 + 0] = ptr0;
  };
  imports.wbg.__wbindgen_throw = function (arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  imports.wbg.__wbindgen_memory = function () {
    const ret = wasm.memory;
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_closure_wrapper197 = function (arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 34, __wbg_adapter_42);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_closure_wrapper415 = function (arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 92, __wbg_adapter_45);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_closure_wrapper417 = function (arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 92, __wbg_adapter_48);
    return addHeapObject(ret);
  };
  imports.wbg.__wbindgen_closure_wrapper740 = function (arg0, arg1, arg2) {
    const ret = makeMutClosure(arg0, arg1, 207, __wbg_adapter_51);
    return addHeapObject(ret);
  };

  return imports;
}

function initMemory(imports, maybe_memory) {
}

function finalizeInit(instance, module) {
  wasm = instance.exports;
  init.__wbindgen_wasm_module = module;
  cachedFloat64Memory0 = new Float64Array();
  cachedInt32Memory0 = new Int32Array();
  cachedUint8Memory0 = new Uint8Array();

  return wasm;
}

function initSync(module) {
  const imports = getImports();

  initMemory(imports);

  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }

  const instance = new WebAssembly.Instance(module, imports);

  return finalizeInit(instance, module);
}

async function init(input) {
  if (typeof input === "undefined") {
    input = new URL("client_bg.wasm", import.meta.url);
  }
  const imports = getImports();

  if (
    typeof input === "string" || (typeof Request === "function" && input instanceof Request) ||
    (typeof URL === "function" && input instanceof URL)
  ) {
    input = fetch(input);
  }

  initMemory(imports);

  const { instance, module } = await load(await input, imports);

  return finalizeInit(instance, module);
}

export { initSync };
export default init;
