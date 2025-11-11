const http = require('http');
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const program = new Command();
program
  .name('inventory-service')
  .helpOption('-H, --help', 'show help')
  .addHelpCommand(false)
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port', (v) => parseInt(v, 10))
  .requiredOption('-c, --cache <dir>', 'cache directory')
  .parse(process.argv);

const { host, port, cache } = program.opts();

const cacheDir = path.resolve(cache);
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Inventory service is running\n');
});

server.listen(port, host, () => {
  console.log(`Server listening at http://${host}:${port}`);
});
