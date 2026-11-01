// @ts-nocheck: a trial script.
/**
 * GitHub's release downloads, for a release not yet published, in a clean container only.
 *
 *     stand-in <key.pem> <cert.pem> <folder of release files> <log file>
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const [key, cert, folder, logFile] = process.argv.slice(2);

https
  .createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
    fs.appendFileSync(logFile, `${request.method} ${request.url}\n`);
    const found = /^\/nizlas\/DSpatch\/releases\/download\/[^/]+\/([^/]+)$/.exec(request.url);
    const file = found === null ? '' : path.join(folder, path.basename(found[1]));
    if (file === '' || !fs.existsSync(file)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(response);
  })
  .listen(443, '127.0.0.1');
