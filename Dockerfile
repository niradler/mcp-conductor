FROM denoland/deno:2.1.4

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install --entrypoint deno.json

COPY src ./src

RUN mkdir -p /workspace && \
    chmod 755 /workspace

ENV MCP_CONDUCTOR_WORKSPACE=/workspace \
    MCP_CONDUCTOR_RUN_ARGS="allow-read=/workspace,allow-write=/workspace" \
    MCP_CONDUCTOR_DEFAULT_TIMEOUT=30000 \
    MCP_CONDUCTOR_MAX_TIMEOUT=300000

EXPOSE 3000

ENTRYPOINT ["deno", "run", "--no-prompt", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-run=deno", "src/cli/cli.ts"]
CMD ["stdio"]

