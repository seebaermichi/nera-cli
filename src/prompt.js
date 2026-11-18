import readline from 'readline'

// The interactive parts of `nera new` (ROADMAP-ai.md L5, principle 5) and of
// `nera publish` (L6, "Choosing the target"). They only collect options;
// scaffoldProject and the publish pipeline do the work, the same as with flags.

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

// The choice of a numbered list that `answer` names: `fallback` on Enter,
// else the one with that number, else the first `named(choice, answer)`
// accepts. Undefined, after saying so, when none matches: ask again.
function choose(say, choices, answer, fallback, named) {
    if (answer === '') return fallback
    const byNumber = /^\d+$/.test(answer) ? choices[Number(answer) - 1] : undefined
    const found = byNumber ?? choices.find((choice) => named(choice, answer))
    if (!found) say(`  Please enter a number from 1 to ${choices.length}.`)
    return found
}

// A readline session over `input`/`output` for `body(session)`, closed when
// it settles. Ctrl-C ends the session: the question being asked returns its
// default, and the next `session.check()` throws `Cancelled — <cancelled>`,
// so the caller stops before it does anything. `session` is `{ ask(question,
// parse), check(), say(text) }`; `ask` asks until `parse` accepts the answer
// (askUntil), and at the end of input every question takes its default.
async function withSession({ input, output, cancelled }, body) {
    const rl = readline.createInterface({ input, output, terminal: Boolean(output.isTTY) })
    let interrupted = false
    rl.once('close', () => {
        rl.ended = true
    })
    rl.on('SIGINT', () => {
        output.write('\n')
        interrupted = true
        rl.close()
    })
    const session = {
        ask: (question, parse) => askUntil(rl, question, parse),
        check: () => {
            if (interrupted) throw new Error(`Cancelled — ${cancelled}`)
        },
        say: (text) => output.write(`${text}\n`),
    }
    try {
        return await body(session)
    } finally {
        rl.close()
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
    return withSession({ input, output, cancelled: 'nothing was created.' }, async ({ ask, check, say }) => {
        const invalid = (fn, value) => {
            try {
                fn(value)
                return false
            } catch (err) {
                say(`  ${err.message}`)
                return true
            }
        }
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
            const picked = await ask(`Choose 1–${choices.length} [1]: `, (answer) =>
                choose(say, choices, answer, choices[0], (c) => c.name && c.name === answer)
            )
            check()
            if (picked.name) result.starter = picked.name
        }

        const fromStarter = result.starter !== undefined
        if (!skip.name) {
            const shown = fromStarter ? 'the starter\'s' : TEMPLATE_NAME
            const name = await ask(`Site name [${shown}]: `, (answer) =>
                answer === '' ? '' : invalid(validateSiteName, answer) ? undefined : answer
            )
            check()
            if (name !== '') result.name = name
        }

        if (!skip.lang) {
            const shown = fromStarter ? 'the starter\'s' : TEMPLATE_LANG
            const lang = await ask(`Language [${shown}]: `, (answer) =>
                answer === '' ? '' : invalid(validateLang, answer) ? undefined : answer
            )
            check()
            if (lang !== '') result.lang = lang
        }

        return result
    })
}

// The target a business site is recommended (ROADMAP-ai.md L6: Netlify's
// terms allow commercial sites on the free plan, GitHub's do not).
export const BUSINESS_TARGET = 'netlify'

// The recommended target id among `ids` (registration order, the first is
// the default): BUSINESS_TARGET for a business when it is registered, the
// default otherwise.
export const recommendTarget = (business, ids) =>
    business && ids.includes(BUSINESS_TARGET) ? BUSINESS_TARGET : ids[0]

// `nera publish` without a target: ask "Is this a site for a business?"
// (Enter: no), then which of `targets` (`[{ id, label }]`, registration
// order) to publish to, the recommended one marked and the default on Enter.
// A target can be picked by its number or its id. Returns the picked id.
export async function runTargetPicker({ input = process.stdin, output = process.stdout, targets }) {
    return withSession({ input, output, cancelled: 'nothing was published.' }, async ({ ask, check, say }) => {
        const business = await ask('Is this a site for a business? [y/N]: ', (answer) => {
            const yesNo = answer.toLowerCase()
            if (yesNo === '' || yesNo === 'n' || yesNo === 'no') return false
            if (yesNo === 'y' || yesNo === 'yes') return true
            say('  Please answer y or n.')
            return undefined
        })
        check()

        const recommended = recommendTarget(business, targets.map((t) => t.id))
        const fallback = targets.findIndex((t) => t.id === recommended)
        say('Where should it be published?')
        targets.forEach((t, i) => say(`  ${i + 1}) ${t.label}${i === fallback ? ' (recommended)' : ''}`))
        const picked = await ask(`Choose 1–${targets.length} [${fallback + 1}]: `, (answer) =>
            choose(say, targets, answer, targets[fallback], (t) => t.id === answer)
        )
        check()
        return picked.id
    })
}
