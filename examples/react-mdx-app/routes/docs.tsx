import { PropsWithChildren } from "react";
import { Head, NavLink } from "aleph/react";

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
          {props.children}
        </div>
      </div>
    </>
  );
}
