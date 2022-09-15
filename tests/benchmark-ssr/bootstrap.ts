const port = 3000;
const frameworks = ["react", "vue", "solid", "yew"];

const servers = frameworks.map((framework, i) => {
  return Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "-A",
      `examples/${framework}-app/server.ts`,
      "--port",
      `${port + i}`,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
});

await new Promise((resolve) => setTimeout(resolve, 1000));

for (let i = 0; i < frameworks.length; i++) {
  await fetch(`http://localhost:${port + i}/`);
}

await Deno.run({
  cmd: [
    Deno.execPath(),
    "bench",
    "-A",
    "--unstable",
    "--no-config",
    "tests/benchmark-ssr/ssr_bench.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).status();

for (const server of servers) {
  server.close();
}
