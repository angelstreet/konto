// investments.test.ts
import { test, expect, beforeEach } from 'vitest'
import { app } from '../../../backend/src/index.js' // adjust path
import request from 'supertest'

// Note: Requires DB setup with investments for full tests
// Run with: cd konto && npm test

test('GET /api/investments returns 200 and array', async () => {
  const res = await request(app).get('/api/investments')
  expect(res.status).toBe(200)
  expect(Array.isArray(res.body)).toBe(true)
})

test('GET /api/investments?company_id=1 filters by company', async () => {
  const res = await request(app).get('/api/investments?company_id=1')
  expect(res.status).toBe(200)
  expect(Array.isArray(res.body)).toBe(true)
})
