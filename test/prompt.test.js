import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'stream'
import { runPicker, shouldPrompt, EMPTY_CHOICE } from '../src/prompt.js'
import { runNew } from '../src/commands/new.js'
import { validateSiteName, validateLang } from '../src/scaffold.js'

const STARTERS = [
    { name: 'blank', package: '@nera-static/starter-blank', description: 'Blank: one page' },
    { name: '@acme/starter-shop', package: '@acme/starter-shop', description: 'A shop' },
]

// Fake terminal: answers are fed one line at a time, each after the question
// it answers has been written.
function fakeStreams(answers) {
    const input = new PassThrough()
    const output = new PassThrough()
    let written = ''
    let asked = 0
    output.on('data', (chunk) => {
        written += chunk
        const questions = (written.match(/\]: /g) ?? []).length
        while (asked < questions) {
            const answer = answers[asked++]
            if (answer === undefined) input.end()
            else input.write(`${answer}\n`)
        }
    })
    return { input, output, text: () => written }
}

const picker = (answers, extra = {}) => {
    const streams = fakeStreams(answers)
    const listStarters = vi.fn(async () => STARTERS)
    return {
        streams,
        listStarters,
        run: () =>
            runPicker({
                input: streams.input,
                output: streams.output,
                listStarters,
                validateSiteName,
                validateLang,
                ...extra,
            }),
    }
}

describe('runPicker', () => {
    it('turns "2", a name and a language into options', async () => {
        const { run, streams } = picker(['2', 'Brot & Zeit', 'de'])
        expect(await run()).toEqual({ starter: 'blank', name: 'Brot & Zeit', lang: 'de' })
        const text = streams.text()
        expect(text).toContain('What are you building?')
        expect(text).toContain(`  1) ${EMPTY_CHOICE}`)
        expect(text).toContain('  2) blank — Blank: one page')
        expect(text).toContain('  3) @acme/starter-shop — A shop')
        expect(text).toContain('Choose 1–3 [1]: ')
        expect(text).toContain('Site name [the starter\'s]: ')
    })

    it('takes the defaults on Enter: no starter, no name, no language', async () => {
        const { run, streams } = picker(['', '', ''])
        expect(await run()).toEqual({})
        expect(streams.text()).toContain('Site name [My Nera Site]: ')
        expect(streams.text()).toContain('Language [en]: ')
    })

    it('takes the defaults when the input ends', async () => {
        const { run } = picker([])
        expect(await run()).toEqual({})
    })

    it('accepts a starter by its shown name and asks again on a bad answer', async () => {
        const { run, streams } = picker(['9', '@acme/starter-shop', 'x\u0007y', 'Shop', 'German', 'de'])
        expect(await run()).toEqual({ starter: '@acme/starter-shop', name: 'Shop', lang: 'de' })
        expect(streams.text()).toContain('Please enter a number from 1 to 3.')
        expect(streams.text()).toContain('Invalid site name')
        expect(streams.text()).toContain('Invalid language "German"')
    })

    it('skips each question whose flag is given', async () => {
        const { run, streams, listStarters } = picker(['de'], { skip: { starter: true, name: true } })
        expect(await run()).toEqual({ lang: 'de' })
        expect(listStarters).not.toHaveBeenCalled()
        expect(streams.text()).not.toContain('What are you building?')
        expect(streams.text()).not.toContain('Site name')
    })
})

describe('shouldPrompt', () => {
    const tty = { isTTY: true }
    it('only on a terminal, without --yes and --starter', () => {
        expect(shouldPrompt({ stdin: tty, stdout: tty })).toBe(true)
        expect(shouldPrompt({ stdin: {}, stdout: tty })).toBe(false)
        expect(shouldPrompt({ stdin: tty, stdout: {} })).toBe(false)
        expect(shouldPrompt({ yes: true, stdin: tty, stdout: tty })).toBe(false)
        expect(shouldPrompt({ starter: 'blank', stdin: tty, stdout: tty })).toBe(false)
    })
})

describe('runNew', () => {
    const tty = { isTTY: true }
    const notTty = { isTTY: false }
    const deps = (stdin, stdout, answers = {}) => ({
        stdin,
        stdout,
        prompt: vi.fn(async () => answers),
        scaffold: vi.fn(async () => '/x'),
    })

    it('never prompts without a TTY', async () => {
        const d = deps(notTty, notTty)
        await runNew(['site', '--no-install'], d)
        expect(d.prompt).not.toHaveBeenCalled()
        expect(d.scaffold).toHaveBeenCalledWith('site', { install: false })
    })

    it('never prompts with --yes, even on a TTY', async () => {
        const d = deps(tty, tty)
        await runNew(['site', '--yes'], d)
        expect(d.prompt).not.toHaveBeenCalled()
        expect(d.scaffold).toHaveBeenCalledWith('site', { install: true })
    })

    it('never prompts with --starter', async () => {
        const d = deps(tty, tty)
        await runNew(['site', '--starter', 'blank'], d)
        expect(d.prompt).not.toHaveBeenCalled()
        expect(d.scaffold).toHaveBeenCalledWith('site', { starter: 'blank', install: true })
    })

    it('on a TTY, asks and passes the answers to scaffoldProject', async () => {
        const d = deps(tty, tty, { starter: 'blank', name: 'Brot & Zeit' })
        await runNew(['site', '--lang', 'de'], d)
        expect(d.prompt).toHaveBeenCalledWith({
            input: tty,
            output: tty,
            skip: { starter: false, name: false, lang: true },
        })
        expect(d.scaffold).toHaveBeenCalledWith('site', {
            lang: 'de',
            starter: 'blank',
            name: 'Brot & Zeit',
            install: true,
        })
    })

    it('does not ask for a starter when --theme is given', async () => {
        const d = deps(tty, tty)
        await runNew(['site', '--theme', 'example'], d)
        expect(d.prompt.mock.calls[0][0].skip.starter).toBe(true)
    })

    it('refuses a bad project name or flag before asking', async () => {
        for (const args of [['a b'], ['site', '--lang', 'Deutsch'], ['site', '--theme', 'a b']]) {
            const d = deps(tty, tty)
            await expect(runNew(args, d)).rejects.toThrow(/Invalid/)
            expect(d.prompt).not.toHaveBeenCalled()
            expect(d.scaffold).not.toHaveBeenCalled()
        }
    })
})
