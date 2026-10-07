import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Runtime, loadFork } from './runtime.mjs';

const runtime = new Runtime(loadFork(process.env.PLAYWRIGHT_FORK_PATH));
const server = new Server({name:'jira-fork-playwright-mcp',version:'0.1.0'}, {capabilities:{tools:{}}});
let queue = Promise.resolve();
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:runtime.tools}));
server.setRequestHandler(CallToolRequestSchema, request => {
  const task = queue.then(async () => {
    try {
      const result = runtime.guard.object(await runtime.call(request.params.name, request.params.arguments || {}));
      return {isError:Boolean(result.isError), content:[{type:'text',text:JSON.stringify(result)}]};
    } catch {
      // Raw exceptions may contain secrets, DOM values or authentication URLs.
      return {isError:true, content:[{type:'text',text:JSON.stringify({isError:true,
        error:'Fork/MCP operation failed; check tool arguments, fork APIs and browser availability.'})}]};
    }
  });
  queue = task.catch(() => {});
  return task;
});
const shutdown = async () => { await runtime.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.stdin.on('end', shutdown);
try {
  await runtime.initialize();
  await server.connect(new StdioServerTransport());
} catch {
  await runtime.close();
  process.stderr.write('Fork MCP startup failed. Check built fork APIs and browser executable.\n');
  process.exitCode = 2;
}
