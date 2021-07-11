ARG DENO_VERSION=latest

FROM denoland/deno:${DENO_VERSION}

RUN deno install --unstable -A -f -r -n aleph https://deno.land/x/aleph/cli.ts

WORKDIR /app

VOLUME ["/app"]

ENTRYPOINT [ "aleph" ]
