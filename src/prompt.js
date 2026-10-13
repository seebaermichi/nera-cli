import readline from 'readline'

// The interactive part of `nera new` (ROADMAP-ai.md L5, principle 5). It only
// collects options; scaffoldProject does the work, the same as with flags.

// Questions are asked only on a terminal, never with --yes, and never once
// --starter is given.
export const shouldPrompt = ({ yes, starter, stdin = process.stdin, stdout = process.stdout }) =>
    Boolean(stdin.isTTY && stdout.isTTY) && !yes && starter === undefined

export const EMPTY_CHOICE = 'Empty — the base template, no starter'
const TEMPLATE_NAME = 'My Nera Site'
const TEMPLATE_LANG = 'en'

// One question; Enter (or the end of input) gives ''.
const ask = (rl, question) =>
    new Promise((resolve) => {
        const onClose = () => resolve('')
        rl.once('close', onClose)
        rl.question(question, (answer) => {
            rl.off('close', onClose)
            resolve(answer.trim())
        })
    })

// Ask until `parse` accepts the answer; it returns undefined for "ask again".
// At the end of input every question takes its default.
async function askUntil(rl, question, parse) {
    for (;;) {
        const answer = rl.ended ? '' : await ask(rl, question)
        const value = parse(answer)
        if (value !== undefined) return value
    }
}

// Ask "What are you building?", "Site name" and "Language", each skipped when
// its option is already set (`skip`). Enter keeps the default, which for name
// and language means "leave app.yaml as the template or the starter has it":
// the result then has no `name` / `lang`. `listStarters` and `validate*` are
// passed in so tests need no network and the rules stay in one place.
// Returns `{ starter?, name?, lang? }`.
export async function runPicker({
    input = process.stdin,
    output = process.stdout,
    listStarters,
    validateSiteName,
    validateLang,
    skip = {},
}) {
    const rl = readline.createInterface({ input, output, terminal: Boolean(output.isTTY) })
    let cancelled = false
    rl.once('close', () => {
        rl.ended = true
    })
    rl.on('SIGINT', () => {
        cancelled = true
        rl.close()
    })
    const check = () => {
        if (cancelled) throw new Error('Cancelled — nothing was created.')
    }
    const say = (text) => output.write(`${text}\n`)
    const invalid = (fn, value) => {
        try {
            fn(value)
            return false
        } catch (err) {
            say(`  ${err.message}`)
            return true
        }
    }

    try {
        const result = {}

        if (!skip.starter) {
            const starters = await listStarters()
            check()
            const choices = [
                { label: EMPTY_CHOICE },
                ...starters.map((s) => ({
                    label: s.description ? `${s.name} — ${s.description}` : s.name,
                    name: s.name,
                })),
            ]
            say('What are you building?')
            choices.forEach((c, i) => say(`  ${i + 1}) ${c.label}`))
            const picked = await askUntil(
                rl,
                `Choose 1–${choices.length} [1]: `,
                (answer) => {
                    if (answer === '') return choices[0]
                    const byNumber = /^\d+$/.test(answer) ? choices[Number(answer) - 1] : undefined
                    const found = byNumber ?? choices.find((c) => c.name && c.name === answer)
                    if (!found) say(`  Please enter a number from 1 to ${choices.length}.`)
                    return found
                }
            )
            check()
            if (picked.name) result.starter = picked.name
        }

        const fromStarter = result.starter !== undefined
        if (!skip.name) {
            const shown = fromStarter ? 'the starter\'s' : TEMPLATE_NAME
            const name = await askUntil(rl, `Site name [${shown}]: `, (answer) =>
                answer === '' ? '' : invalid(validateSiteName, answer) ? undefined : answer
            )
            check()
            if (name !== '') result.name = name
        }

        if (!skip.lang) {
            const shown = fromStarter ? 'the starter\'s' : TEMPLATE_LANG
            const lang = await askUntil(rl, `Language [${shown}]: `, (answer) =>
                answer === '' ? '' : invalid(validateLang, answer) ? undefined : answer
            )
            check()
            if (lang !== '') result.lang = lang
        }

        return result
    } finally {
        rl.close()
    }
}
