import { describe, it, expect, afterEach } from 'vitest'
import { OpenAiProvider } from '../src/server/ai/providers/openAiProvider'
import { MockAiProvider } from '../src/server/ai/providers/mockAiProvider'
import { getAiProvider } from '../src/server/ai/aiProviderFactory'
import { AiProviderError } from '../src/server/ai/provider'

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY
})

describe('OpenAiProvider configuration', () => {
  it('throws a controlled AI_CONFIGURATION_ERROR when OPENAI_API_KEY is unset — never a raw exception', () => {
    delete process.env.OPENAI_API_KEY
    let caught: unknown
    try {
      // eslint-disable-next-line no-new
      new OpenAiProvider()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AiProviderError)
    expect((caught as AiProviderError).code).toBe('AI_CONFIGURATION_ERROR')
  })

  it('constructs successfully once OPENAI_API_KEY is set, with no network call at construction time', () => {
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'
    expect(() => new OpenAiProvider()).not.toThrow()
  })
})

describe('aiProviderFactory — getAiProvider', () => {
  it('falls back to MockAiProvider when OPENAI_API_KEY is not configured (this environment has no real key)', () => {
    delete process.env.OPENAI_API_KEY
    expect(getAiProvider()).toBeInstanceOf(MockAiProvider)
  })

  it('selects OpenAiProvider once OPENAI_API_KEY is configured', () => {
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key'
    expect(getAiProvider()).toBeInstanceOf(OpenAiProvider)
  })
})
