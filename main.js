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

const itemsDir = path.join(cacheDir, 'items');
if (!fs.existsSync(itemsDir)) fs.mkdirSync(itemsDir, { recursive: true });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function parseUrlEncoded(buf) {
  const s = buf.toString();
  const out = {};
  s.split('&').forEach((pair) => {
    if (!pair) return;
    const [k, v] = pair.split('=');
    const key = decodeURIComponent(k || '');
    const val = decodeURIComponent(v || '');
    out[key] = val;
  });
  return out;
}

function parseMultipart(buf, contentType) {
  const m = /boundary=([^;]+)/i.exec(contentType || '');
  if (!m) return {};
  const boundary = '--' + m[1];
  const parts = buf.toString('binary').split(boundary).slice(1, -1);
  const result = {};
  parts.forEach((p) => {
    const idx = p.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const head = p.slice(0, idx);
    const body = p.slice(idx + 4, p.endsWith('\r\n') ? -2 : undefined);
    const nameM = /name="([^"]+)"/i.exec(head);
    const fileM = /filename="([^"]*)"/i.exec(head);
    const contentTypeM = /Content-Type:\s*([^\r\n]+)/i.exec(head);
    if (!nameM) return;
    const name = nameM[1];
    if (fileM && fileM[1] !== '') {
      result[name] = {
        filename: fileM[1],
        contentType: contentTypeM ? contentTypeM[1].trim() : 'application/octet-stream',
        buffer: Buffer.from(body, 'binary'),
      };
    } else {
      result[name] = Buffer.from(body, 'binary').toString();
    }
  });
  return result;
}

function itemPath(id) {
  return path.join(itemsDir, `${id}.json`);
}
function photoPath(id) {
  return path.join(itemsDir, `${id}.jpg`);
}
function existsItem(id) {
  return fs.existsSync(itemPath(id));
}
function loadItem(id) {
  try {
    return JSON.parse(fs.readFileSync(itemPath(id), 'utf8'));
  } catch {
    return null;
  }
}
function saveItem(obj) {
  fs.writeFileSync(itemPath(obj.id), JSON.stringify(obj, null, 2));
}
function removeItem(id) {
  let existed = false;
  if (fs.existsSync(itemPath(id))) {
    fs.unlinkSync(itemPath(id));
    existed = true;
  }
  if (fs.existsSync(photoPath(id))) fs.unlinkSync(photoPath(id));
  return existed;
}
function listItems() {
  const files = fs.readdirSync(itemsDir).filter((f) => f.endsWith('.json'));
  const arr = [];
  files.forEach((f) => {
    try {
      const it = JSON.parse(fs.readFileSync(path.join(itemsDir, f), 'utf8'));
      arr.push(it);
    } catch {}
  });
  return arr;
}
function makePhotoUrl(id) {
  return `http://${host}:${port}/inventory/${id}/photo`;
}

const baseHandler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || host + ':' + port}`);
  const method = req.method || 'GET';

  if (url.pathname === '/RegisterForm.html') {
    if (method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const filePath = path.resolve('RegisterForm.html');
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (url.pathname === '/SearchForm.html') {
    if (method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const filePath = path.resolve('SearchForm.html');
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (url.pathname === '/register') {
    if (method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const body = await readBody(req);
    const ct = req.headers['content-type'] || '';
    const form = parseMultipart(body, ct);
    const name = typeof form.inventory_name === 'string' ? form.inventory_name.trim() : '';
    if (!name) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const description = typeof form.description === 'string' ? form.description : '';
    const item = { id, name, description, photo: makePhotoUrl(id) };
    saveItem(item);
    if (form.photo && form.photo.buffer) {
      fs.writeFileSync(photoPath(id), form.photo.buffer);
    }
    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(item));
    return;
  }

  if (url.pathname === '/inventory') {
    if (method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const items = listItems().map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      photo: makePhotoUrl(it.id),
    }));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(items));
    return;
  }

  if (/^\/inventory\/[^/]+$/.test(url.pathname)) {
    const id = url.pathname.split('/')[2];
    if (method === 'GET') {
      if (!existsItem(id)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const it = loadItem(id);
      const out = { id: it.id, name: it.name, description: it.description, photo: makePhotoUrl(id) };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(out));
      return;
    }
    if (method === 'PUT') {
      if (!existsItem(id)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const buf = await readBody(req);
      let data = {};
      try {
        data = JSON.parse(buf.toString() || '{}');
      } catch {}
      const it = loadItem(id);
      if (typeof data.name === 'string') it.name = data.name;
      if (typeof data.description === 'string') it.description = data.description;
      saveItem(it);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ id: it.id, name: it.name, description: it.description, photo: makePhotoUrl(id) }));
      return;
    }
    if (method === 'DELETE') {
      if (!existsItem(id)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      removeItem(id);
      res.statusCode = 200;
      res.end();
      return;
    }
    res.statusCode = 405;
    res.end();
    return;
  }

  if (/^\/inventory\/[^/]+\/photo$/.test(url.pathname)) {
    const id = url.pathname.split('/')[2];
    if (method === 'GET') {
      if (!existsItem(id) || !fs.existsSync(photoPath(id))) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      fs.createReadStream(photoPath(id)).pipe(res);
      return;
    }
    if (method === 'PUT') {
      if (!existsItem(id)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const body = await readBody(req);
      const ct = req.headers['content-type'] || '';
      if (ct.startsWith('multipart/form-data')) {
        const form = parseMultipart(body, ct);
        if (form.photo && form.photo.buffer) {
          fs.writeFileSync(photoPath(id), form.photo.buffer);
          res.statusCode = 200;
          res.end();
          return;
        }
        res.statusCode = 400;
        res.end();
        return;
      } else {
        fs.writeFileSync(photoPath(id), body);
        res.statusCode = 200;
        res.end();
        return;
      }
    }
    res.statusCode = 405;
    res.end();
    return;
  }

  if (url.pathname === '/search') {
    if (method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const body = await readBody(req);
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/x-www-form-urlencoded')) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const form = parseUrlEncoded(body);
    const id = (form.id || '').trim();
    if (!id || !existsItem(id)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const it = loadItem(id);
    const hasPhoto = !!(form.has_photo && form.has_photo !== 'false' && form.has_photo !== '0');
    const payload = {
      id: it.id,
      name: it.name,
      description: it.description,
      photo: makePhotoUrl(id),
    };
    if (hasPhoto) payload.description = `${payload.description} ${payload.photo}`.trim();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }

  baseHandler(req, res);
});

server.listen(port, host, () => {
  console.log(`Server listening at http://${host}:${port}`);
});