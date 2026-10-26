import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../assets/js/components/settings_modal.js', import.meta.url), 'utf8');
let instance = 0;
async function setup(origin, handler) {
  globalThis.window = {location:{origin,protocol:'http:'}};
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url,options});
    return handler(url,options);
  };
  const module = await import(`data:text/javascript;base64,${Buffer.from(source + `\nexport {apiFetch};\n// instance ${++instance}`).toString('base64')}`);
  return {apiFetch:module.apiFetch,requests};
}

// A provider's missing models endpoint stays on the discovered backend, so
// the caller can display its actual error instead of unrelated port failures.
{
  const notFound = {status:404,headers:{get:()=> 'application/json'}};
  const fixture = await setup('http://localhost:8000', url => url.endsWith('/api/settings') ? {status:200} : notFound);
  await fixture.apiFetch('/api/settings');
  assert.equal(await fixture.apiFetch('/api/settings/models',{method:'POST',body:'draft-secret'}),notFound);
  assert.equal(fixture.requests.length,2);
  assert.equal(fixture.requests[1].url,'http://localhost:8000/api/settings/models');
}

// Settings can initially locate the Python backend from a static preview;
// subsequent requests use that instance exclusively.
{
  const fixture = await setup('http://localhost:5500', url => ({status:url.startsWith('http://localhost:5500') || url.endsWith('/models') ? 404 : 200}));
  await fixture.apiFetch('/api/settings');
  assert.equal((await fixture.apiFetch('/api/settings/models',{method:'POST'})).status,404);
  assert.deepEqual(fixture.requests.map(request=>request.url),[
    'http://localhost:5500/api/settings',
    'http://127.0.0.1:8000/api/settings',
    'http://127.0.0.1:8000/api/settings/models',
  ]);
}

// A stopped backend must not cause a write containing credentials to be sent
// to other local services, and the error remains concise and localized.
{
  const fixture = await setup('http://localhost:8000', url => {
    if(url.endsWith('/api/settings')) return {status:200};
    throw new TypeError('Failed to fetch');
  });
  await fixture.apiFetch('/api/settings');
  await assert.rejects(fixture.apiFetch('/api/settings/models',{method:'POST',body:'private-key'}),error=>{
    assert.match(error.message,/无法连接/);
    assert.doesNotMatch(error.message,/Failed to fetch|Tried:|8010|8765/);
    return true;
  });
  assert.equal(fixture.requests.length,2);
}
