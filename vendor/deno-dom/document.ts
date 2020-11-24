import { setLock } from "./constructor-lock.ts";
import { Element } from "./element.ts";
import { NodeList, nodeListMutatorSym } from "./node-list.ts";
import { Comment, Node, NodeType, Text } from "./node.ts";
import { DOM as NWAPI } from "./nwsapi-types.ts";

export function createHTMLDocument(titleStr?: string): Document {
  // TODO: Figure out a way to make `setLock` invocations less redundant
  setLock(false);
  const doc = new Document();

  setLock(false);
  const docType = new DocumentType("html", "", "");
  doc.appendChild(docType);

  const html = new Element("html", doc, []);
  html._setOwnerDocument(doc);

  const head = new Element("head", html, []);
  const body = new Element("body", html, []);

  const title = new Element("title", head, []);
  const titleText = new Text(titleStr || '');
  title.appendChild(titleText);

  doc.head = head;
  doc.body = body;

  setLock(true);
  return doc;
}

export class DocumentType extends Node {
  #qualifiedName = "";
  #publicId = "";
  #systemId = "";

  constructor(
    name: string,
    publicId: string,
    systemId: string,
  ) {
    super(
      "html",
      NodeType.DOCUMENT_TYPE_NODE,
      null
    );

    this.#qualifiedName = name;
    this.#publicId = publicId;
    this.#systemId = systemId;
  }

  get name() {
    return this.#qualifiedName;
  }

  get publicId() {
    return this.#publicId;
  }

  get systemId() {
    return this.#systemId;
  }
}

export interface ElementCreationOptions {
  is: string;
}

export type VisibilityState = "visible" | "hidden" | "prerender";
export type NamespaceURI = "http://www.w3.org/1999/xhtml" | "http://www.w3.org/2000/svg" | "http://www.w3.org/1998/Math/MathML";

export class Document extends Node {
  public head: Element = <Element><unknown>null;
  public body: Element = <Element><unknown>null;

  #documentURI = "about:blank"; // TODO
  #nwapi = NWAPI(this);

  constructor() {
    super(
      (setLock(false), "#document"),
      NodeType.DOCUMENT_NODE,
      null,
    );

    setLock(true);
  }

  // Expose the document's NWAPI for Element's access to
  // querySelector/querySelectorAll
  get _nwapi() {
    return this.#nwapi;
  }

  get documentURI() {
    return this.#documentURI;
  }

  get title() {
    return this.querySelector("title")?.textContent || "";
  }

  get scripts() {
    return [];
  }

  get cookie() {
    return ""; // TODO
  }

  set cookie(newCookie: string) {
    // TODO
  }

  get visibilityState(): VisibilityState {
    return "visible";
  }

  get hidden() {
    return false;
  }

  get compatMode(): string {
    return "CSS1Compat";
  }

  get documentElement(): Element | null {
    for (const node of this.childNodes) {
      if (node.nodeType === NodeType.ELEMENT_NODE) {
        return <Element>node;
      }
    }

    return null;
  }

  appendChild(child: Node): Node {
    super.appendChild(child);
    child._setOwnerDocument(this);
    return child;
  }

  createElement(tagName: string, options?: ElementCreationOptions): Element {
    tagName = tagName.toUpperCase();

    setLock(false);
    const elm = new Element(tagName, null, []);
    elm._setOwnerDocument(this);
    setLock(true);
    return elm;
  }

  createElementNS(
    namespace: NamespaceURI,
    qualifiedName: string,
    options?: ElementCreationOptions,
  ): Element {
    if (namespace === "http://www.w3.org/1999/xhtml") {
      return this.createElement(qualifiedName, options);
    } else {
      throw new Error(`createElementNS: "${namespace}" namespace unimplemented`); // TODO
    }
  }

  createTextNode(data?: string): Text {
    return new Text(data);
  }

  createComment(data?: string): Comment {
    return new Comment(data);
  }

  querySelector(selectors: string): Element | null {
    return this.#nwapi.first(selectors, this);
  }

  querySelectorAll(selectors: string): NodeList {
    const nodeList = new NodeList();
    const mutator = nodeList[nodeListMutatorSym]();
    mutator.push(...this.#nwapi.select(selectors, this))

    return nodeList;
  }

  // TODO: DRY!!!
  getElementById(id: string): Element | null {
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.ELEMENT_NODE) {
        if ((<Element>child).id === id) {
          return <Element>child;
        }

        const search = (<Element>child).getElementById(id);
        if (search) {
          return search;
        }
      }
    }

    return null;
  }

  getElementsByTagName(tagName: string): Element[] {
    if (tagName === "*") {
      return this.documentElement
        ? <Element[]>this._getElementsByTagNameWildcard(this.documentElement, [])
        : [];
    } else {
      return <Element[]>this._getElementsByTagName(tagName.toUpperCase(), []);
    }
  }

  private _getElementsByTagNameWildcard(node: Node, search: Node[]): Node[] {
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.ELEMENT_NODE) {
        search.push(child);
        (<any>child)._getElementsByTagNameWildcard(search);
      }
    }

    return search;
  }

  private _getElementsByTagName(tagName: string, search: Node[]): Node[] {
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.ELEMENT_NODE) {
        if ((<Element>child).tagName === tagName) {
          search.push(child);
        }

        (<any>child)._getElementsByTagName(tagName, search);
      }
    }

    return search;
  }

  getElementsByTagNameNS(_namespace: string, localName: string): Element[] {
    return this.getElementsByTagName(localName);
  }

  getElementsByClassName(className: string): Element[] {
    return <Element[]>this._getElementsByClassName(className, []);
  }

  private _getElementsByClassName(className: string, search: Node[]): Node[] {
    for (const child of this.childNodes) {
      if (child.nodeType === NodeType.ELEMENT_NODE) {
        if ((<Element>child).classList.contains(className)) {
          search.push(child);
        }

        (<any>child)._getElementsByClassName(className, search);
      }
    }

    return search;
  }

  hasFocus(): boolean {
    return true;
  }
}
