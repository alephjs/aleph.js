import { Head, Link } from "aleph/react";

export default function Index() {
  return (
    <div className="page y-center">
      <Head>
        <title>About Aleph.js</title>
      </Head>
      <p className="logo">
        <img src="/assets/logo.svg" height="75" title="Aleph.js" />
      </p>
      <h1>
        The Fullstack Framework in Deno.
      </h1>
      <p>
        <strong>Aleph.js</strong> gives you the best developer experience for building web applications<br />{" "}
        with modern toolings.
      </p>
      <div className="external-links">
        <a href="https://alephjs.org/docs/get-started" target="_blank">
          Get Started
        </a>
        <a href="https://alephjs.org/docs" target="_blank">
          Docs
        </a>
        <a href="https://github.com/alephjs/aleph.js" target="_blank">
          Github
        </a>
      </div>
      <nav>
        <Link to="/todos">
          <button>Todos App Demo</button>
        </Link>
      </nav>
    </div>
  );
}
