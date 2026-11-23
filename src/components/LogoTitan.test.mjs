import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, unlink } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

test('the brand uses the supplied image, contained without cropping or reconstruction', async () => {
  const outfile = new URL('./.logo-test.mjs', import.meta.url).pathname;
  try {
    await build({ entryPoints: [new URL('./LogoTitan.tsx', import.meta.url).pathname], outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
    const { default: Logo } = await import(outfile);
    const markup = renderToStaticMarkup(React.createElement(Logo, { size: 160 }));
    assert.match(markup, /^<img /);
    assert.match(markup, /src="\/prime-logo.png"/);
    assert.match(markup, /alt="PRIME — LA TOUR PRIME"/);
    assert.match(markup, /object-contain/);
    const image = await readFile(new URL('../../public/prime-logo.png', import.meta.url));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /rel="icon" type="image\/png" href="\/prime-logo.png"/);
  } finally { await unlink(outfile).catch(() => {}); }
});
