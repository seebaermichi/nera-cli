import { describe, it, expect, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { runPicker, runBlogPicker, runTargetPicker, recommendTarget, shouldPrompt, shouldAskBlog, EMPTY_CHOICE, BUSINESS_TARGET } from '../src/prompt.js'
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

    it('Ctrl-C on a terminal cancels: nothing was created', async () => {
        const { run, streams } = picker(['\u0003'], { skip: { starter: true } })
        streams.output.isTTY = true
        await expect(run()).rejects.toThrow('Cancelled — nothing was created.')
    })

    it('skips each question whose flag is given', async () => {
        const { run, streams, listStarters } = picker(['de'], { skip: { starter: true, name: true } })
        expect(await run()).toEqual({ lang: 'de' })
        expect(listStarters).not.toHaveBeenCalled()
        expect(streams.text()).not.toContain('What are you building?')
        expect(streams.text()).not.toContain('Site name')
    })
})

// runBlogPicker over fake streams answering `answers`.
const blogPicker = (answers, tty = false) => {
    const streams = fakeStreams(answers)
    if (tty) streams.output.isTTY = true
    return { streams, run: () => runBlogPicker({ input: streams.input, output: streams.output }) }
}

describe('runBlogPicker', () => {
    it('lists the four blogs, plain first, and takes it on Enter', async () => {
        const { run, streams } = blogPicker([''])
        expect(await run()).toBe('blog')
        const lines = streams.text().split('\n')
        expect(lines.slice(0, 6)).toEqual([
            'Which blog?',
            '  1) Blog (blog)',
            '  2) Blog for developers (stack)',
            '  3) Photo blog (ansitz)',
            '  4) Travel blog (umwege)',
            'Choose 1–4 [1]: ',
        ])
    })

    it('picks by number or by name, and asks again on a bad answer', async () => {
        expect(await blogPicker(['3']).run()).toBe('ansitz')
        expect(await blogPicker(['ansitz']).run()).toBe('ansitz')
        const { run, streams } = blogPicker(['7', 'umwege'])
        expect(await run()).toBe('umwege')
        expect(streams.text()).toContain('Please enter a number from 1 to 4.')
    })

    it('takes the plain blog when the input ends', async () => {
        expect(await blogPicker([]).run()).toBe('blog')
    })

    it('Ctrl-C on a terminal cancels: nothing was created', async () => {
        const { run } = blogPicker(['\u0003'], true)
        await expect(run()).rejects.toThrow('Cancelled — nothing was created.')
    })
})

const TARGETS = [{ id: 'github-pages', label: 'GitHub Pages' }, { id: 'netlify', label: 'Netlify' }]

// runTargetPicker over fake streams answering `answers`.
const targetPicker = (answers, targets = TARGETS, tty = false) => {
    const streams = fakeStreams(answers)
    if (tty) streams.output.isTTY = true
    return { streams, run: () => runTargetPicker({ input: streams.input, output: streams.output, targets }) }
}

describe('recommendTarget', () => {
    it('a business gets Netlify when it is registered; everything else the default', () => {
        expect(BUSINESS_TARGET).toBe('netlify')
        expect(recommendTarget(true, ['github-pages', 'netlify'])).toBe('netlify')
        expect(recommendTarget(false, ['github-pages', 'netlify'])).toBe('github-pages')
        expect(recommendTarget(true, ['github-pages', 'other'])).toBe('github-pages')
    })
})

describe('runTargetPicker', () => {
    it('a business ("y"): Netlify recommended and the default on Enter', async () => {
        const { run, streams } = targetPicker(['y', ''])
        expect(await run()).toBe('netlify')
        const text = streams.text()
        expect(text).toContain('Is this a site for a business? [y/N]: ')
        expect(text).toContain('Where should it be published?')
        expect(text).toContain('  1) GitHub Pages\n')
        expect(text).toContain('  2) Netlify (recommended)\n')
        expect(text).toContain('Choose 1–2 [2]: ')
    })

    it('Enter twice: no business, GitHub Pages recommended and picked', async () => {
        const { run, streams } = targetPicker(['', ''])
        expect(await run()).toBe('github-pages')
        expect(streams.text()).toContain('  1) GitHub Pages (recommended)\n')
        expect(streams.text()).toContain('  2) Netlify\n')
        expect(streams.text()).toContain('Choose 1–2 [1]: ')
    })

    it('either target can be picked against the recommendation, by number or id', async () => {
        expect(await targetPicker(['N', '2']).run()).toBe('netlify')
        expect(await targetPicker(['Yes', '1']).run()).toBe('github-pages')
        expect(await targetPicker(['no', 'netlify']).run()).toBe('netlify')
    })

    it('asks again on an answer it does not understand', async () => {
        const { run, streams } = targetPicker(['maybe', 'y', '3', 'Netlify', '0', '1'])
        expect(await run()).toBe('github-pages')
        expect(streams.text()).toContain('  Please answer y or n.')
        expect(streams.text().match(/Please enter a number from 1 to 2\./g)).toHaveLength(3)
    })

    it('takes the defaults when the input ends: GitHub Pages', async () => {
        expect(await targetPicker([]).run()).toBe('github-pages')
    })

    it('shows the summary of a target after its label and the recommendation', async () => {
        const targets = [
            { id: 'github-pages', label: 'GitHub Pages', summary: 'for a blog' },
            { id: 'netlify', label: 'Netlify', summary: 'for a business' },
        ]
        const { run, streams } = targetPicker(['y', ''], targets)
        expect(await run()).toBe('netlify')
        expect(streams.text()).toContain('  1) GitHub Pages — for a blog\n')
        expect(streams.text()).toContain('  2) Netlify (recommended) — for a business\n')
    })

    it('a recommended target that is not registered falls back to the default', async () => {
        const targets = [{ id: 'github-pages', label: 'GitHub Pages' }, { id: 'other', label: 'Other' }]
        const { run, streams } = targetPicker(['y', ''], targets)
        expect(await run()).toBe('github-pages')
        expect(streams.text()).toContain('  1) GitHub Pages (recommended)')
    })

    it('Ctrl-C cancels at either question: nothing was published', async () => {
        await expect(targetPicker(['\u0003'], TARGETS, true).run()).rejects.toThrow('Cancelled — nothing was published.')
        await expect(targetPicker(['y', '\u0003'], TARGETS, true).run()).rejects.toThrow('Cancelled — nothing was published.')
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
        expect(shouldPrompt({ starter: 'blog', stdin: tty, stdout: tty })).toBe(false)
    })
})

describe('shouldAskBlog', () => {
    const tty = { isTTY: true }
    it('only for --starter blog, on a terminal, without --yes', () => {
        expect(shouldAskBlog({ starter: 'blog', stdin: tty, stdout: tty })).toBe(true)
        expect(shouldAskBlog({ starter: 'blog', stdin: {}, stdout: tty })).toBe(false)
        expect(shouldAskBlog({ starter: 'blog', stdin: tty, stdout: {} })).toBe(false)
        expect(shouldAskBlog({ starter: 'blog', yes: true, stdin: tty, stdout: tty })).toBe(false)
        for (const starter of [undefined, 'stack', '@nera-static/starter-blog']) {
            expect(shouldAskBlog({ starter, stdin: tty, stdout: tty })).toBe(false)
        }
    })
})

describe('runNew', () => {
    const tty = { isTTY: true }
    const notTty = { isTTY: false }
    const deps = (stdin, stdout, answers = {}) => ({
        stdin,
        stdout,
        prompt: vi.fn(async () => answers),
        blogPrompt: vi.fn(async () => 'stack'),
        scaffold: vi.fn(async () => '/x'),
        npmVersion: vi.fn(() => '10.9.0'),
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

    it('refuses an npm that would crash on install before asking', async () => {
        const d = { ...deps(tty, tty), npmVersion: vi.fn(() => '10.8.2') }
        await expect(runNew(['site'], d)).rejects.toThrow(/npm 10\.8\.2 cannot install/)
        expect(d.prompt).not.toHaveBeenCalled()
        expect(d.scaffold).not.toHaveBeenCalled()
    })

    it('asks with npm 10.9.0, and does not check npm with --no-install', async () => {
        const ok = deps(tty, tty)
        await runNew(['site'], ok)
        expect(ok.npmVersion).toHaveBeenCalledOnce()
        expect(ok.prompt).toHaveBeenCalledOnce()

        const offline = { ...deps(tty, tty), npmVersion: vi.fn(() => '10.8.2') }
        await runNew(['site', '--no-install'], offline)
        expect(offline.npmVersion).not.toHaveBeenCalled()
        expect(offline.prompt).toHaveBeenCalledOnce()
    })

    it('refuses a bad project name or flag before asking', async () => {
        for (const args of [['a b'], ['site', '--lang', 'Deutsch'], ['site', '--theme', 'a b']]) {
            const d = deps(tty, tty)
            await expect(runNew(args, d)).rejects.toThrow(/Invalid/)
            expect(d.prompt).not.toHaveBeenCalled()
            expect(d.scaffold).not.toHaveBeenCalled()
        }
    })

    it('--starter blog on a TTY asks which blog and scaffolds the answer', async () => {
        const d = deps(tty, tty)
        await runNew(['site', '--starter', 'blog'], d)
        expect(d.prompt).not.toHaveBeenCalled()
        expect(d.blogPrompt).toHaveBeenCalledWith({ input: tty, output: tty })
        expect(d.scaffold).toHaveBeenCalledWith('site', { starter: 'stack', install: true })
    })

    it('--starter blog asks nothing without a TTY, with --yes or with --theme', async () => {
        const cases = [
            [notTty, ['site', '--starter', 'blog'], { starter: 'blog', install: true }],
            [tty, ['site', '--starter', 'blog', '--yes'], { starter: 'blog', install: true }],
            [tty, ['site', '--starter', 'blog', '--theme', 'blog'], { starter: 'blog', theme: 'blog', install: true }],
        ]
        for (const [stream, args, passed] of cases) {
            const d = deps(stream, stream)
            await runNew(args, d)
            expect(d.blogPrompt).not.toHaveBeenCalled()
            expect(d.prompt).not.toHaveBeenCalled()
            expect(d.scaffold).toHaveBeenCalledWith('site', passed)
        }
    })

    it('any other starter spec is used as given, even on a TTY', async () => {
        for (const starter of ['stack', 'ansitz', 'umwege', '@nera-static/starter-blog']) {
            const d = deps(tty, tty)
            await runNew(['site', '--starter', starter], d)
            expect(d.blogPrompt).not.toHaveBeenCalled()
            expect(d.scaffold).toHaveBeenCalledWith('site', { starter, install: true })
        }
    })

    it('--starter blog refuses a bad flag or npm before asking', async () => {
        const bad = deps(tty, tty)
        await expect(runNew(['site', '--starter', 'blog', '--lang', 'Deutsch'], bad)).rejects.toThrow(/Invalid/)
        const oldNpm = { ...deps(tty, tty), npmVersion: vi.fn(() => '10.8.2') }
        await expect(runNew(['site', '--starter', 'blog'], oldNpm)).rejects.toThrow(/npm 10\.8\.2 cannot install/)
        for (const d of [bad, oldNpm]) {
            expect(d.blogPrompt).not.toHaveBeenCalled()
            expect(d.scaffold).not.toHaveBeenCalled()
        }
    })
})
