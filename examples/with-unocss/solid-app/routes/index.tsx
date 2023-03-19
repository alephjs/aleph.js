const externalLinks = [
  ["Get Started", "https://alephjs.org/docs/get-started"],
  ["Docs", "https://alephjs.org/docs"],
  ["Github", "https://github.com/alephjs/aleph.js"],
];

export default function App() {
  return (
    <div
      class="w-screen flex flex-col items-center justify-center"
      style="height: calc(100vh - 2 * 80px)"
    >
      <p class="flex gap-2">
        <img src="./assets/logo.svg" width="70" height="70" title="Aleph.js" />
        <img src="./assets/solid.svg" width="70" height="70" title="SolidJS" />
      </p>
      <h1 class="text-3xl font-bold mt-2">
        The Fullstack Framework in Deno.
      </h1>
      <p class="text-center text-md text-gray-800">
        <strong>Aleph.js</strong> gives you the best developer experience for building web applications<br />{" "}
        with modern toolings.{" "}
        <label class="border-b-4 border-[#4377bb] font-semibold">SolidJS experimental version</label>.
      </p>
      <div class="flex gap-4 mt-2">
        {externalLinks.map(([text, href]) => (
          <a
            href={href}
            target="_blank"
            class="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
          >
            {text}
          </a>
        ))}
      </div>
      <nav class="mt-8">
        <a
          role="button"
          href="/todos"
          class="inline-flex items-center justify-center w-60 h-12 border-1 border-gray-300 rounded-full hover:border-gray-400 transition-colors duration-300"
        >
          Todos App Demo
        </a>
      </nav>
    </div>
  );
}
