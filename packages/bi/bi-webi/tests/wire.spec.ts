import { describe, expect, it } from 'vitest'
import {
  chartQueryPath,
  contentPath,
  errorStatus,
  okResults,
  queryCancelPath,
  queryResultsPath,
  savedChartPath,
} from '@deepseek-ai/dsh-bi-webi/src/wire.ts'

describe('the routes', () => {
  it('address one project’s charts, one chart, and one run, escaping what it interpolates', () => {
    expect(contentPath('p/1', 500)).toBe('/api/v2/content?projectUuids=p%2F1&contentTypes=chart&page=1&pageSize=500')
    expect(savedChartPath('c/1')).toBe('/api/v1/saved/c%2F1')
    expect(chartQueryPath('p/1')).toBe('/api/v2/projects/p%2F1/query/chart')
    expect(queryResultsPath('p', 'q/1', 20)).toBe('/api/v2/projects/p/query/q%2F1?page=1&pageSize=20')
    expect(queryCancelPath('p', 'q')).toBe('/api/v2/projects/p/query/q/cancel')
  })
})

describe('the envelopes', () => {
  it('reads results only off a success envelope', () => {
    expect(okResults({ status: 'ok', results: [1] })).toEqual([1])
    expect(okResults({ status: 'error', results: [1] })).toBeUndefined()
    expect(okResults('ok')).toBeUndefined()
    expect(okResults(null)).toBeUndefined()
  })

  it('reads the status code off a failure envelope and nothing else', () => {
    expect(errorStatus({ status: 'error', error: { statusCode: 404, name: 'NotFound', message: 'x' } })).toBe(404)
    expect(errorStatus({ status: 'error', error: { statusCode: '404' } })).toBeUndefined()
    expect(errorStatus({ status: 'error', error: null })).toBeUndefined()
    expect(errorStatus({ status: 'error' })).toBeUndefined()
    expect(errorStatus(undefined)).toBeUndefined()
  })
})
