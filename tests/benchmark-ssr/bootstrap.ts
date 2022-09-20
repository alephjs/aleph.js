const frameworks = ["react", "vue", "solid", "yew"];
const startPort = 3001;

const servers = frameworks.map((framework, i) => {
  return Deno.run({
    cmd: [
      Deno.execPath(),
      "run",
      "-A",
      `examples/${framework}-app/server.ts`,
      "--port",
      `${startPort + i}`,
    ],
    stdout: "null",
    stderr: "null",
  });
});

await Promise.all(frameworks.map(async (framework, i) => {
  const url = `http://localhost:${startPort + i}`;
  let status = 0;
  while (status !== 200) {
    try {
      const res = await fetch(url);
      status = res.status;
    } catch (_e) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  console.log(`Server for ${framework} is ready at ${url}`);
}));

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
