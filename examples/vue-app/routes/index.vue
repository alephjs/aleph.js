<script setup>
import { Link, Head } from "aleph/vue"
</script>

<template>
  <div class="page y-center">
    <Head>
      <title>Aleph.js</title>
      <meta name="description" content="The Fullstack Framework in Deno." />
    </Head>
    <p class="logo">
      <img src="/assets/logo.svg" width="75" height="75" title="Aleph.js" />
    </p>
    <h1>
      The Fullstack Framework in Deno.
    </h1>
    <p>
      <strong>Aleph.js</strong>
      gives you the best developer experience for building web applications
      <br />
      with modern toolings.
    </p>
    <div class="external-links">
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
</template>
