import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, searchDocs, ARTICLES } from '../src/lib/docs.js';

test('tokenize drops common stop words and short tokens', () => {
  assert.deepEqual(tokenize('how do I clock in'), ['clock']);
  assert.deepEqual(tokenize('what is the invoice'), ['invoice']);
});

test('search ranks the most relevant article first', () => {
  assert.equal(searchDocs('clock in')[0].article.id, 'field-actions-time');
  assert.equal(searchDocs('overdue invoice payment')[0].article.id, 'invoices');
  assert.equal(searchDocs("can't sign in")[0].article.id, 'getting-started');
});

test('search returns nothing for an all-stop-word query', () => {
  assert.equal(searchDocs('how do I').length, 0);
});

test('every article has a stable id and category', () => {
  const ids = new Set();
  for (const a of ARTICLES) {
    assert.ok(a.id && a.title && a.category, 'article well-formed');
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
  }
});
