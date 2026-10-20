import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const [source, phone, nacl, manifest] = await Promise.all([
  readFile(path.join(root, 'worker/index.js'), 'utf8'), readFile(path.join(root, 'worker/phone.html'), 'utf8'),
  readFile(path.join(root, 'worker/nacl-fast.min.js'), 'utf8'), readFile(path.join(root, '.openai/hosting.json'), 'utf8')
]);
await mkdir(path.join(root, 'dist/server'), { recursive: true });
await mkdir(path.join(root, 'dist/.openai'), { recursive: true });
await writeFile(path.join(root, 'dist/server/index.js'), source.replace("'__PHONE_PAGE__'", () => JSON.stringify(phone)).replace("'__NACL_SOURCE__'", () => JSON.stringify(nacl)));
await writeFile(path.join(root, 'dist/.openai/hosting.json'), manifest);
console.log('Built encrypted phone pairing service');
