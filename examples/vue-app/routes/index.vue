<script setup>
import { Link, Head } from "aleph/vue"
</script>

<template>
  <div class="screen index">
    <Head>
      <title>Aleph.js</title>
      <meta name="description" content="The Fullstack Framework in Deno." />
    </Head>
    <p class="logo">
      <img src="/assets/logo.svg" width="70" height="70" title="Aleph.js" />
      <img src="/assets/vue.svg" width="70" height="70" title="Vue.js" />
    </p>
    <h1>
      The Fullstack Framework in Deno.
    </h1>
    <p>
      <strong>Aleph.js</strong>
      gives you the best developer experience for building web applications
      <br />
      with modern toolings. <label>Vue.js experimental version</label>.
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
      <Link role="button" to="/todos">
        Todos App Demo
      </Link>
    </nav>
  </div>
</template>

<style>
.index h1 {
  margin: 0;
  line-height: 1.4;
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  color: #000;
}

.index p {
  margin: 0;
  line-height: 1.2;
  font-size: 18px;
  text-align: center;
  color: #333;
}

.index p strong {
  font-weight: 600;
}

.index p label {
  display: inline-block;
  font-weight: 600;
  border-bottom: 4px #42b883 solid;
}

.index .external-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  margin-top: 12px;
}

.index .external-links a {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #666;
  text-decoration: none;
  transition: color 0.15s ease-in;
}

.index .external-links a:hover {
  color: #000;
}

.index .external-links a:after {
  display: block;
  width: 16px;
  height: 16px;
  background: url(../assets/external-link.svg) no-repeat center;
  background-size: contain;
  content: "";
}

.index nav {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 45px;
}

.index nav a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 240px;
  height: 50px;
  border: 1px solid #ddd;
  border-radius: 25px;
  color: #454545;
  transition: border-color 0.15s ease-in;
  cursor: pointer;
}

.index nav a:hover {
  color: #000;
  border-color: #aaa;
}
</style>
