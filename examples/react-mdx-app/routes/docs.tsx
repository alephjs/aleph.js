import { PropsWithChildren } from "react";
import { MDXProvider } from "@mdx-js/react";
import { Head, NavLink } from "aleph/react";
import { components } from "../components/Heading.tsx";

const nav = [
  ["About", "/docs"],
  ["Get Started", "/docs/get-started"],
];

export default function Docs(props: PropsWithChildren) {
  return (
    <>
      <Head>
        <meta name="description" content="Documentation powered by MDX" />
      </Head>
      <div className="docs">
        <aside>
          <div className="search">
            <input placeholder="Search..." />
          </div>
          <nav>
            <ul>
              {nav.map(([title, href]) => (
                <li key={href}>
                  <NavLink to={href} activeClassName="active" exact>{title}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="markdown-body">
          <MDXProvider components={components}>
            {props.children}
          </MDXProvider>
        </div>
      </div>
    </>
  );
}
